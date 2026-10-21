"""Actual fit fixture algorithm against a controlled transient DOM and same-shell outputs; no OS/GUI."""
from pathlib import Path
import ast
import json
import re
import runpy
import subprocess
import shutil
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

IMPLEMENTATION = Path(__file__).with_name('linux-terminal-fit.py')
if '--implementation' in sys.argv:
    index = sys.argv.index('--implementation'); IMPLEMENTATION = Path(sys.argv[index + 1]); del sys.argv[index:index + 2]
FIT = runpy.run_path(str(IMPLEMENTATION))
APP = '/work/appimage-runtime/appimage_extracted_owned'
SHA = 'c192e560428e778842fdbbe72f14032824b03373ed49ad3efcdbcf9eb249b75b'


class Readiness(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory(prefix='uwork-fit-ready-pure-'); self.addCleanup(directory.cleanup)
        self.evidence = Path(directory.name); self.now = 0; self.width = 1200; self.height = 800
        self.reads = 0; self.native_resizes = []; self.proofs = {}; self.was_resized = False
        self.never_stable = False; self.restore_dpr_change = False; self.foreign_shell = False
        self.preview_open = True; self.mouse_releases = []
        self.preview_unknown = False
        self.clock = SimpleNamespace(monotonic=self.monotonic, sleep=self.sleep)

    def monotonic(self): self.now += .01; return self.now
    def sleep(self, duration): self.now += duration

    def viewport(self):
        self.reads += 1
        width = 744 if self.width == 1020 else 924
        if self.reads == 1: width = 462
        if self.never_stable: width += self.reads % 2
        return {'ok': True, 'width': width, 'height': 152 if self.width == 1020 else 171,
                'clientWidth': width, 'clientHeight': 152 if self.width == 1020 else 171,
                'containerWidth': self.width - 270, 'containerHeight': 200 if self.width == 1020 else 235,
                'fontFamily': 'owned monospace', 'fontSize': '13px', 'fontReady': True,
                'devicePixelRatio': 2 if self.restore_dpr_change and self.was_resized and self.width == 1200 else 1,
                'activeAnimations': 0}

    def cdp(self, method, **params):
        if method == 'Runtime.evaluate':
            if 'side-pane-toggle' in params['expression']:
                mode = json.loads(re.search(r'const mode=("[a-z]+")', params['expression']).group(1))
                label = '收起侧边面板' if self.preview_open else '展开侧边面板'
                ok = self.preview_open if mode == 'collapse' else not self.preview_open
                if self.preview_unknown: ok = False
                return {'result': {'value': {'ok':ok, 'label':label, 'previewWidth':420 if self.preview_open else 0, 'x':100 if mode=='collapse' else 500,'y':20 if mode=='collapse' else 600}}}
            return {'result': {'value': self.viewport()}}
        if method == 'Input.dispatchMouseEvent':
            if params['type'] == 'mouseReleased':
                self.mouse_releases.append((params['x'], params['y']))
                if (params['x'], params['y']) == (100,20): self.preview_open = False
            return {}
        if method == 'Input.insertText':
            match = re.search(r'stty size > (/work/project/terminal-fit-[a-z0-9-]+\.txt)', params['text']); self.assertIsNotNone(match)
            pid = 287 if self.foreign_shell else 286
            self.proofs[match.group(1)] = ('8 114' if self.width == 1020 else '9 142') + '\n/work/project\n/dev/pts/0\n' + str(pid) + '\n'
            return {}
        self.assertEqual(method, 'Input.dispatchKeyEvent'); return {}

    def docker(self, *args, **kwargs):
        self.assertEqual(args[:2], ('exec', 'uwork-client-linux-desktop-pty-wire-appimage-v6-20261020'))
        argv = args[2:]
        if argv == ('readlink', '/proc/56/exe'): text = APP + '/zcode-preview\n'
        elif argv == ('cat', '/proc/56/stat'): text = '56 (Main title) S ' + ' '.join(['1'] * 18 + ['1234'] + ['0'] * 5)
        elif argv == ('cat', '/work/project/terminal-proof.txt'): text = 'LINUX_PTY_WRITE_OK\n/work/project\n/dev/pts/0\n286\n'
        elif argv[0] == 'cat': text = self.proofs.get(argv[1], '')
        elif argv[:2] == ('node', '-e'): text = json.dumps({'sha256': SHA, 'rows': [{'pid':148, 'ancestorMain':56, 'addon': APP + '/resources/app.asar.unpacked/node_modules/node-pty/prebuilds/linux-arm64/pty.node'}]})
        elif argv[:2] == ('xdotool', 'search'): text = '4194307\n'
        elif argv[0] == 'xprop': text = '_NET_WM_WINDOW_TYPE(ATOM) = _NET_WM_WINDOW_TYPE_NORMAL\n'
        elif argv[:2] == ('xdotool', 'getwindowpid'): text = '56\n'
        elif argv[:2] == ('xdotool', 'getwindowgeometry'): text = f'WIDTH={self.width}\nHEIGHT={self.height}\n'
        elif argv[:2] == ('xdotool', 'windowsize'):
            self.width, self.height = map(int, argv[-2:]); self.native_resizes.append((self.width, self.height)); self.was_resized = True; text = ''
        else: self.fail('Unexpected command: ' + repr(argv))
        return subprocess.CompletedProcess(argv, 0, text, '')

    def run_fit(self):
        function = FIT['run_terminal_fit']
        with patch.dict(function.__globals__, {'time': self.clock}):
            return function(self.docker, 'uwork-client-linux-desktop-pty-wire-appimage-v6-20261020', self.cdp, 56, APP, self.evidence)

    def test_transient_first_dom_is_not_locked_as_the_restoration_baseline(self):
        value = self.run_fit()
        self.assertEqual(value['status'], 'passed-original-UI-fit-and-same-shell-stty')
        self.assertEqual(value['viewportBefore']['width'], 924)
        self.assertEqual(value['before'], value['restored'])
        self.assertEqual(value['viewportRestored'], value['viewportBefore'])
        self.assertEqual(self.native_resizes, [(1020, 720), (1200, 800)])
        self.assertEqual(self.mouse_releases, [(100,20),(500,600)])
        self.assertFalse(self.preview_open)

    def test_continuously_drifting_dom_cannot_authorize_native_resize(self):
        self.never_stable = True
        with self.assertRaises(AssertionError): self.run_fit()
        self.assertEqual(self.native_resizes, [])
        self.assertLess(self.now, 35)

    def test_different_original_shell_is_still_a_failure(self):
        self.foreign_shell = True
        with self.assertRaises(AssertionError): self.run_fit()
        self.assertEqual(self.native_resizes, [])

    def test_restored_width_without_restored_dpr_is_not_success(self):
        self.restore_dpr_change = True
        with self.assertRaises(AssertionError): self.run_fit()
        facts = json.loads((self.evidence / 'terminal-fit-actual.json').read_text())
        self.assertEqual(facts['status'], 'failed')

    def test_already_collapsed_preview_is_only_asserted_and_terminal_refocused(self):
        self.preview_open = False
        value = self.run_fit()
        self.assertFalse(self.preview_open)
        self.assertEqual(value['status'], 'passed-original-UI-fit-and-same-shell-stty')
        self.assertTrue(value['previewAlreadyCollapsed'])
        self.assertEqual(self.mouse_releases, [(500,600)])

    def test_unknown_preview_control_never_clicks_or_resizes(self):
        self.preview_unknown = True
        with self.assertRaises(AssertionError): self.run_fit()
        self.assertEqual(self.mouse_releases, [])
        self.assertEqual(self.native_resizes, [])

    def test_actual_projection_accepts_retained_hidden_preview_and_rejects_unknown_or_multiple(self):
        if 'layout_projection_expression' in FIT:
            expression = FIT['layout_projection_expression']('collapsed')
        else:
            tree = ast.parse(IMPLEMENTATION.read_text())
            function = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == 'layout_projection')
            assignment = next(n for n in function.body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'expression' for t in n.targets))
            expression = eval(compile(ast.Expression(assignment.value), 'actual-old-projection', 'eval'), {'json':json,'target':'collapsed'})
        script = '''import vm from 'node:vm';import assert from 'node:assert/strict';let input='';for await(const chunk of process.stdin)input+=chunk;const expression=JSON.parse(input);
for(const config of [{hidden:'true',expected:true},{hidden:'false',expected:false},{hidden:null,expected:false},{hidden:'true',multiple:true,expected:false}]){
 const frame={getAttribute:key=>key==='aria-hidden'?config.hidden:null};
 const buttons=[{x:100,label:'展开侧边面板'},...(config.multiple?[{x:200,label:'展开侧边面板'}]:[])];
 const hidden={x:300,label:'收起侧边面板'};
 for(const b of [...buttons,hidden])Object.assign(b,{getClientRects:()=>[{}],getBoundingClientRect:()=>({x:b.x,y:10,width:20,height:20}),getAttribute:key=>key==='aria-label'?b.label:null,contains:e=>e===b});
 const preview={getBoundingClientRect:()=>({width:413.8}),closest:()=>frame};
 const document={querySelectorAll:s=>s.includes('side-pane-toggle')?[...buttons,hidden]:s.includes('data-workspace-side-frame')?[frame]:[],querySelector:()=>preview,elementFromPoint:x=>buttons.find(b=>b.x+10===x)??{}};
 const value=vm.runInNewContext(expression,{document});assert.equal(value.ok,config.expected,'Retained preview width is not visibility; hidden='+config.hidden+' multiple='+!!config.multiple);
}'''
        result = subprocess.run([shutil.which('node'), '--input-type=module', '-e', script], input=json.dumps(expression), capture_output=True, text=True, timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == '__main__': unittest.main()
