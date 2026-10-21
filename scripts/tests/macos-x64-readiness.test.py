"""Pure negative/late-page readiness contracts; no browser or socket is opened."""
from pathlib import Path
import runpy
import unittest
import urllib.error
import urllib.request

R = runpy.run_path(str(Path(__file__).with_name('macos-x64-readiness.py')))
PREFIX = 'file:///owned/UWork%20Preview.app/Contents/Resources/app.asar/'
PORT = 12345

def page():
    return {'id': 'owned', 'type': 'page', 'url': PREFIX + 'out/renderer/index.html',
            'webSocketDebuggerUrl': 'ws://127.0.0.1:12345/devtools/page/owned'}

class Readiness(unittest.TestCase):
    def test_empty_and_blank_targets_never_admit_a_renderer(self):
        self.assertIsNone(R['select_owned_renderer']([], PREFIX, PORT))
        self.assertIsNone(R['select_owned_renderer']([{'type':'page','url':'about:blank'}], PREFIX, PORT))
    def test_exact_owned_target_is_admitted(self):
        value = page(); self.assertIs(R['select_owned_renderer']([value], PREFIX, PORT), value)
    def test_duplicate_or_mixed_pages_are_rejected(self):
        for rows in [[page(), page()], [page(), {'type':'page','url':'https://foreign/'}]]:
            with self.assertRaises(AssertionError): R['select_owned_renderer'](rows, PREFIX, PORT)
    def test_foreign_ws_host_port_scheme_or_id_is_rejected(self):
        for address in ['ws://localhost:12345/devtools/page/owned','ws://127.0.0.1:54321/devtools/page/owned','wss://127.0.0.1:12345/devtools/page/owned','ws://127.0.0.1:12345/devtools/page/other']:
            value = page(); value['webSocketDebuggerUrl'] = address
            with self.assertRaises(AssertionError): R['select_owned_renderer']([value], PREFIX, PORT)
    def test_redirect_handler_refuses_to_follow(self):
        with self.assertRaises(urllib.error.HTTPError) as error: R['NoRedirect']().redirect_request(urllib.request.Request('http://127.0.0.1:12345/json/list'),None,302,'Found',{},'https://foreign/')
        error.exception.close()
    def test_late_renderer_waits_without_ever_creating_a_target(self):
        clock=[0.]; persisted=[]; calls=[]
        def sleep(value):clock[0]+=value
        def fetch(port, remaining):calls.append(port);return [] if len(calls)<4 else [page()]
        value=R['wait_owned_renderer'](PORT,PREFIX,lambda:True,persisted.append,fetch=fetch,now=lambda:clock[0],sleep=sleep)
        self.assertEqual(value['id'],'owned'); self.assertEqual(len(calls),4)
        self.assertEqual(len(persisted[-1]['firstLatest']),2)
        self.assertIsNone(persisted[-1]['firstLatest'][0]['selectedId']);self.assertEqual(persisted[-1]['firstLatest'][1]['selectedId'],'owned')
    def test_absent_listener_never_fetches_and_has_finite_timeout(self):
        clock=[0.]; calls=[]
        def sleep(value):clock[0]+=value
        with self.assertRaises(TimeoutError):R['wait_owned_renderer'](PORT,PREFIX,lambda:False,lambda _:None,seconds=.3,fetch=lambda *_:calls.append(1),now=lambda:clock[0],sleep=sleep)
        self.assertEqual(calls,[]);self.assertLessEqual(clock[0],.31)
    def test_failed_pid_guard_prevents_network_read(self):
        calls=[]
        def guard():raise AssertionError('PID birth changed')
        with self.assertRaises(AssertionError):R['wait_owned_renderer'](PORT,PREFIX,guard,lambda _:None,fetch=lambda *_:calls.append(1))
        self.assertEqual(calls,[])

if __name__=='__main__':unittest.main()
