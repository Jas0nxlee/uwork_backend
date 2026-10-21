"""Pure observer contracts; no Docker, X server, sockets, GUI or product process."""
from pathlib import Path
import ast
import json
import runpy
import subprocess
import tempfile
import unittest

API = runpy.run_path(str(Path(__file__).with_name('linux-native-error-diagnostic.py')))
CONTAINER = 'uwork-client-linux-desktop-pty-wire-appimage-v4-20261020'
APP = '/work/appimage-runtime/appimage_extracted_owned'
BINDING = {'pid': 56, 'exe': APP + '/zcode-preview', 'startTime': '1234'}
PNG = b'\x89PNG\r\n\x1a\n' + b'owned screenshot'


class Capture(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='uwork-error-observer-pure-')
        self.addCleanup(self.directory.cleanup)
        self.work = Path(self.directory.name) / 'work'; self.work.mkdir()
        self.evidence = Path(self.directory.name) / 'evidence'; self.evidence.mkdir()
        self.calls = []; self.window_pid = 56; self.birth = '1234'; self.windows = ['6291459']
        self.help = '--autoselect, -a X,Y,W,H'; self.after_capture_pid = None; self.captured = False

    def docker(self, *argv, **kwargs):
        self.calls.append(argv)
        self.assertEqual(argv[:2], ('exec', CONTAINER))
        args = argv[2:]
        if args == ('readlink', '/proc/56/exe'): value = BINDING['exe'] + '\n'
        elif args == ('cat', '/proc/56/stat'): value = '56 (Main title) S ' + ' '.join(['1'] * 18 + [self.birth] + ['0'] * 5)
        elif args == ('xdotool', 'search', '--onlyvisible', '--name', '.'): value = '\n'.join(self.windows)
        elif args[0] == 'xprop':
            pid = self.after_capture_pid if self.captured and self.after_capture_pid else self.window_pid
            value = '_NET_WM_PID(CARDINAL) = ' + str(pid) + '\n_NET_WM_WINDOW_TYPE(ATOM) = _NET_WM_WINDOW_TYPE_DIALOG\n_NET_WM_STATE(ATOM) = _NET_WM_STATE_MODAL, _NET_WM_STATE_SKIP_TASKBAR\n'
        elif args[:2] == ('xdotool', 'getwindowname'): value = 'Error\n'
        elif args[:2] == ('xdotool', 'getwindowgeometry'): value = 'WINDOW=6291459\nX=20\nY=40\nWIDTH=640\nHEIGHT=200\nSCREEN=0\n'
        elif args == ('xdotool', 'getdisplaygeometry'): value = '1600 1000\n'
        elif args[0] == 'xwininfo': value = 'Owned Error native X tree (no action)\n'
        elif args == ('scrot', '--help'): value = self.help
        elif args[0] == 'scrot':
            self.assertEqual(args, ('scrot', '-a', '20,40,640,200', '-o', '/work/native-error-6291459.png'))
            self.captured = True; (self.work / 'native-error-6291459.png').write_bytes(PNG); value = ''
        else: self.fail('Unexpected or mutating command: ' + repr(args))
        self.assertLessEqual(kwargs['timeout'], 3)
        return subprocess.CompletedProcess(args, 0, value, '')

    def capture(self):
        return API['capture_owned_error'](self.docker, CONTAINER, BINDING, self.work, self.evidence)

    def test_owned_unique_modal_is_passively_cropped_with_continuous_binding(self):
        facts = self.capture()
        self.assertEqual(facts['status'], 'captured-owned-native-error')
        self.assertEqual((self.evidence / 'native-error-6291459.png').read_bytes(), PNG)
        self.assertEqual((self.evidence / 'native-error-6291459.png').stat().st_mode & 0o777, 0o600)
        self.assertGreaterEqual(sum(row[2:] == ('cat', '/proc/56/stat') for row in self.calls), 3)
        self.assertTrue(facts['beforeAfterBindingAndGeometryEqual'])
        self.assertEqual(facts['buttonActions'], [])

    def test_unknown_pid_never_captures_or_targets_a_dialog(self):
        self.window_pid = 999
        facts = self.capture()
        self.assertEqual(facts['status'], 'no-unique-owned-error-dialog')
        self.assertFalse(self.captured)

    def test_main_generation_change_never_captures(self):
        self.birth = '9999'
        facts = self.capture()
        self.assertEqual(facts['status'], 'diagnostic-failed')
        self.assertFalse(self.captured)

    def test_multiple_owned_dialogs_do_not_guess(self):
        self.windows.append('6291460')
        facts = self.capture()
        self.assertEqual(facts['status'], 'no-unique-owned-error-dialog')
        self.assertFalse(self.captured)

    def test_post_capture_pid_change_does_not_publish_image(self):
        self.after_capture_pid = 999
        facts = self.capture()
        self.assertEqual(facts['status'], 'diagnostic-failed')
        self.assertFalse((self.evidence / 'native-error-6291459.png').exists())

    def test_unverified_scrot_option_cannot_capture(self):
        self.help = 'unknown implementation'
        facts = self.capture()
        self.assertEqual(facts['status'], 'diagnostic-failed')
        self.assertFalse(self.captured)

    def test_observer_cannot_replace_original_success_or_exception(self):
        value = object(); original = RuntimeError('owned original')
        def observer(): raise TimeoutError('observer timeout')
        self.assertIs(API['observe_failure'](lambda: value, observer), value)
        def fail(): raise original
        try: API['observe_failure'](fail, observer)
        except BaseException as error: self.assertIs(error, original)
        else: self.fail('Original failure must remain')

    def test_actual_capture_save_failure_cannot_replace_original_exception(self):
        original = RuntimeError('owned original')
        def fail(): raise original
        invalid = self.work / 'is-a-file'; invalid.write_text('owned')
        def observer(): API['capture_owned_error'](self.docker, CONTAINER, BINDING, self.work, invalid)
        try: API['observe_failure'](fail, observer)
        except BaseException as error: self.assertIs(error, original)
        else: self.fail('Original failure must remain')

    def test_actual_capture_timeout_cannot_replace_original_exception(self):
        original = RuntimeError('owned original')
        def fail(): raise original
        def timeout(*args, **kwargs): raise subprocess.TimeoutExpired(args, 3)
        def observer(): API['capture_owned_error'](timeout, CONTAINER, BINDING, self.work, self.evidence)
        try: API['observe_failure'](fail, observer)
        except BaseException as error: self.assertIs(error, original)
        else: self.fail('Original failure must remain')
        self.assertEqual(json.loads((self.evidence / 'owned-native-error-diagnostic.json').read_text())['failure']['type'], 'TimeoutExpired')

    def test_actual_wrapper_only_observes_first_failure_after_original_reload(self):
        source = ast.parse(Path(__file__).with_name('linux-pty-wire-probe.py').read_text())
        cls = next(node for node in ast.walk(source) if isinstance(node, ast.ClassDef) and node.name == 'VerifiedBridge')
        method = next(node for node in cls.body if isinstance(node, ast.FunctionDef) and node.name == 'raw_cdp')
        tree = ast.Module(body=[ast.ClassDef(name='VerifiedBridge', bases=[ast.Name(id='Base', ctx=ast.Load())], keywords=[], body=[method], decorator_list=[])], type_ignores=[])
        observed = []; result = object(); original = RuntimeError('original bridge error')
        class Base:
            error = None
            def raw_cdp(self, *args, **kwargs):
                if self.error is not None: raise self.error
                return result
        def capture(*args):
            observed.append(args)
            raise TimeoutError('observer failure must not replace original')
        namespace = {'Base': Base, 'diagnostic': {**API, 'capture_owned_error': capture}, 'docker': self.docker, 'name': CONTAINER.removeprefix('uwork-'), 'REPO': self.work, 'evidence': self.evidence}
        exec(compile(ast.fix_missing_locations(tree), 'actual-wrapper-raw-cdp', 'exec'), namespace)
        bridge = namespace['VerifiedBridge'](); bridge._owned_main_binding = BINDING
        bridge.error = original
        for method in ['Runtime.evaluate']:
            with self.assertRaises(RuntimeError) as context: bridge.raw_cdp(method)
            self.assertIs(context.exception, original)
        self.assertEqual(observed, [])
        bridge.error = None
        self.assertIs(bridge.raw_cdp('Page.reload'), result)
        self.assertEqual(observed, [])
        bridge.error = original
        for _ in range(2):
            with self.assertRaises(RuntimeError) as context: bridge.raw_cdp('Runtime.evaluate')
            self.assertIs(context.exception, original)
        self.assertEqual(len(observed), 1)
        self.assertEqual(observed[0][1:3], (CONTAINER, BINDING))


if __name__ == '__main__': unittest.main()
