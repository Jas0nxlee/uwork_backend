"""Run inside browser-harness. Retain private UI evidence locally; never save headers or values from JSON responses."""
import json
import os
import re
import time
from pathlib import Path
from urllib.parse import urlsplit, parse_qs

OUTPUT = Path(os.environ.get('UWORK_EVIDENCE_DIR', str(Path.cwd() / 'evidence/workbuddy')))
OUTPUT.mkdir(parents=True, exist_ok=True)

def shape(value, depth=0):
    if depth > 7:
        return {'type': type(value).__name__, 'truncated': True}
    if isinstance(value, dict):
        return {k: shape(v, depth + 1) for k, v in value.items()}
    if isinstance(value, list):
        variants = []
        for v in value[:20]:
            s = shape(v, depth + 1)
            if s not in variants:
                variants.append(s)
        return {'type': 'array', 'item_shapes': variants, 'sampled': len(value[:20]), 'length': len(value)}
    if value is None:
        return 'null'
    return {str: 'string', bool: 'boolean', int: 'number', float: 'number'}.get(type(value), 'unknown')

def normalized_url(url):
    u = urlsplit(url)
    path = re.sub(r'/enterprises/[^/]+', '/enterprises/{enterpriseId}', u.path)
    return {'origin': u.scheme + '://' + u.netloc, 'path': path, 'query_keys': sorted(parse_qs(u.query))}

def network_evidence():
    events = drain_events()
    requests = {}
    result = []
    for e in events:
        p = e.get('params', {})
        rid = p.get('requestId')
        if e.get('method') == 'Network.requestWillBeSent':
            r = p.get('request', {})
            requests[rid] = {'method': r.get('method'), **normalized_url(r.get('url', ''))}
            if r.get('postData'):
                try:
                    requests[rid]['request_shape'] = shape(json.loads(r['postData']))
                except (ValueError, TypeError):
                    requests[rid]['request_shape'] = 'non-json'
        elif e.get('method') == 'Network.responseReceived' and p.get('type') in ['XHR', 'Fetch']:
            r = p.get('response', {})
            record = {**requests.get(rid, normalized_url(r.get('url', ''))), 'status': r.get('status')}
            if record['origin'] not in ['https://www.workbuddy.cn', 'https://workspace.tencent.com']:
                continue
            if 'json' in r.get('mimeType', ''):
                try:
                    body = cdp('Network.getResponseBody', requestId=rid)
                    if not body.get('base64Encoded'):
                        record['response_shape'] = shape(json.loads(body['body']))
                except Exception:
                    record['response_shape'] = 'unavailable'
            result.append(record)
    return result

def click_label(label, selector):
    # The navigation uses generic divs with no actionable AX role. Inspect their DOM geometry.
    expression = """(() => { const e=Array.from(document.querySelectorAll(SELECTOR)).find(e=>e.innerText.trim()===LABEL); if(!e) return null; e.scrollIntoView({block:'nearest'}); const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()"""
    box = js(expression.replace('SELECTOR', json.dumps(selector)).replace('LABEL', json.dumps(label)))
    if not box:
        raise RuntimeError('Missing navigation label: ' + label)
    click_at_xy(box['x'], box['y'])

def click_button(name):
    nodes = cdp('Accessibility.getFullAXTree')['nodes']
    matches = [n for n in nodes if n.get('role', {}).get('value') == 'button' and n.get('name', {}).get('value') == name]
    node = (matches[-1] if name == '取消' else matches[0]) if matches else None
    if not node:
        raise RuntimeError('Missing accessible button: ' + name)
    backend = node['backendDOMNodeId']
    cdp('DOM.scrollIntoViewIfNeeded', backendNodeId=backend)
    q = cdp('DOM.getBoxModel', backendNodeId=backend)['model']['content']
    click_at_xy(sum(q[0::2]) / 4, sum(q[1::2]) / 4)
    time.sleep(2)

def open_nav(group, label=None):
    cdp('Network.enable')
    drain_events()
    if label:
        opened = js("""(() => {const e=Array.from(document.querySelectorAll('.wb-upnav-label')).find(e=>e.innerText.trim()===LABEL); const s=e?.parentElement.nextElementSibling;return s?.classList.contains('wb-upnav-sub')&&s.getBoundingClientRect().height>1;})()""".replace('LABEL', json.dumps(group)))
        if not opened:
            click_label(group, '.wb-upnav-label')
            time.sleep(.35)
        click_label(label, '.wb-upnav-subitem-label')
    else:
        click_label(group, '.wb-upnav-label')
    time.sleep(3)

def capture_page(key, group, label=None):
    open_nav(group, label)
    return capture_current(key, group, label)

def capture_current(key, group, label=None):
    result = js("""({path:location.pathname,text:document.body.innerText,headings:Array.from(document.querySelectorAll('h1,h2,h3,[role=heading]')).map(e=>e.innerText),buttons:Array.from(document.querySelectorAll('button')).map(e=>({text:e.innerText,disabled:e.disabled})),tabs:Array.from(document.querySelectorAll('[role=tab],.t-tabs__nav-item-text-wrapper')).map(e=>e.innerText),columns:Array.from(document.querySelectorAll('th')).map(e=>e.innerText),fields:Array.from(document.querySelectorAll('input,textarea,select')).map(e=>({tag:e.tagName,type:e.type,placeholder:e.placeholder,name:e.name,disabled:e.disabled})),formLabels:Array.from(document.querySelectorAll('label,.t-form__label')).map(e=>e.innerText),frames:Array.from(document.querySelectorAll('iframe')).map(e=>({title:e.title,origin:(()=>{try{return new URL(e.src).origin}catch{return null}})()}))})""")
    result.update({'key': key, 'group': group, 'label': label or group, 'network': network_evidence(), 'captured_at': time.strftime('%Y-%m-%dT%H:%M:%S%z')})
    result['embeddedDocuments'] = js("""Array.from(document.querySelectorAll('iframe')).map(f=>({path:(()=>{try{return new URL(f.src).pathname}catch{return null}})(),text:(()=>{try{return f.contentDocument?.body?.innerText??null}catch{return null}})()}))""")
    (OUTPUT / (key + '.json')).write_text(json.dumps(result, ensure_ascii=False, indent=2))
    capture_screenshot(str(OUTPUT / (key + '.png')))
    print(json.dumps({'key': key, 'path': result['path'], 'buttons': [b['text'] for b in result['buttons']], 'columns': result['columns'], 'endpoints': len(result['network']), 'tabs': result['tabs'], 'fields': len(result['fields'])}, ensure_ascii=False))
    return result
