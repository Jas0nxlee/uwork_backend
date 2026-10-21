"""Owned loopback document with bounded browser receipts and self-close verification."""
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
import secrets
import socket
import threading
import time


class OwnedExternalPage:
    def __init__(self, evidence):
        self.evidence = Path(evidence)
        self.nonce = secrets.token_hex(16)
        self.document_path = '/probe/' + self.nonce
        self.title = 'UWork external-link ' + self.nonce[:12]
        self.event_path = '/event/' + self.nonce
        self.phase = 'embedded'
        self.events, self.documents = [], []
        self.lock = threading.Lock()
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def reply(self, status, body=b'', content_type='text/plain'):
                self.send_response(status)
                self.send_header('Content-Type', content_type)
                self.send_header('Content-Length', str(len(body)))
                self.send_header('Cache-Control', 'no-store')
                self.send_header('Referrer-Policy', 'no-referrer')
                self.send_header('Content-Security-Policy', "default-src 'none'; script-src 'nonce-" + owner.nonce + "'; connect-src 'self'")
                self.end_headers()
                self.wfile.write(body)

            def agent(self):
                # Never read or persist Cookie/Authorization or unrelated request headers.
                ua = self.headers.get('User-Agent', '')
                match = re.search(r'Chrome/(\d+)', ua)
                return {'electron': 'Electron/' in ua, 'chromeMajor': int(match[1]) if match else None}

            def do_GET(self):
                if self.path == '/favicon.ico':
                    self.reply(204)
                    return
                if self.path != owner.document_path:
                    self.reply(404)
                    return
                with owner.lock:
                    role = owner.phase
                    owner.documents.append({'role': role, **self.agent()})
                self.reply(200, owner.html(role).encode(), 'text/html; charset=utf-8')

            def do_POST(self):
                if self.path != owner.event_path:
                    self.reply(404)
                    return
                try:
                    size = int(self.headers.get('Content-Length', '0'))
                    assert 0 < size <= 4096
                    value = json.loads(self.rfile.read(size))
                    assert value['role'] in ('embedded', 'external')
                    assert value['kind'] in ('ready', 'close-attempt', 'close-accepted', 'pagehide', 'close-blocked')
                    fields = {key: value[key] for key in ['role', 'kind', 'historyLength', 'closed', 'trusted', 'closeRequested'] if key in value}
                    assert all(isinstance(v, (str, bool, int)) for v in fields.values())
                    with owner.lock:
                        assert len(owner.events) < 40
                        owner.events.append({**fields, 'serverAgent': self.agent()})
                    self.reply(204)
                except (AssertionError, ValueError, KeyError, TypeError):
                    self.reply(400)

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.server.daemon_threads = True
        self.port = self.server.server_address[1]
        self.url = f'http://127.0.0.1:{self.port}' + self.document_path
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def html(self, role):
        return '''<!doctype html><meta charset="utf-8"><title>%s</title>
<h1>UWork external-link verification</h1><p>This local test page closes itself.</p>
<script nonce="%s">
const role=%s, endpoint=%s;
let closeRequested=false;
const send=(kind,extra={})=>navigator.sendBeacon(endpoint,JSON.stringify({role,kind,historyLength:history.length,...extra}));
addEventListener('pagehide',event=>send('pagehide',{trusted:event.isTrusted,closeRequested}));
send('ready');
if(role==='external')setTimeout(()=>{
  if(history.length!==1){send('close-blocked');return;}
  closeRequested=true;send('close-attempt');
  window.close();send('close-accepted',{closed:window.closed});
  setTimeout(()=>send('close-blocked'),1000);
},10000);
</script>''' % (self.title, self.nonce, json.dumps(role), json.dumps(self.event_path))

    def arm_external(self, require_embedded=True):
        with self.lock:
            if require_embedded:
                assert any(e['role'] == 'embedded' and e['kind'] == 'ready' and e['serverAgent']['electron'] for e in self.events)
            self.phase = 'external'

    def wait(self, role, kind, seconds=20):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            with self.lock:
                matches = [e for e in self.events if e['role'] == role and e['kind'] == kind]
                if matches:
                    return matches[0]
                if any(e['role'] == role and e['kind'] == 'close-blocked' for e in self.events):
                    raise AssertionError('Owned external page could not close itself')
            time.sleep(.05)
        raise AssertionError('Missing owned browser receipt: ' + role + '/' + kind)

    def verify_external(self, chrome_major):
        ready = self.wait('external', 'ready')
        assert ready['historyLength'] == 1
        assert ready['serverAgent'] == {'electron': False, 'chromeMajor': chrome_major}
        accepted = self.wait('external', 'close-accepted')
        assert accepted['closed'] is True
        return {'externalPageLoaded': True, 'chromeMajor': chrome_major,
                'windowCloseAccepted': True}

    def close(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join(timeout=5)
        with socket.socket() as probe:
            probe.settimeout(.5)
            closed = probe.connect_ex(('127.0.0.1', self.port)) != 0
        with self.lock:
            proof = {'urlSha256': hashlib.sha256(self.url.encode()).hexdigest(), 'port': self.port,
                     'documents': self.documents, 'events': self.events, 'portClosed': closed,
                     'serverThreadClosed': not self.thread.is_alive()}
        (self.evidence / 'external-page-receipts.json').write_text(json.dumps(proof, indent=2) + '\n')
        assert closed and not self.thread.is_alive()
