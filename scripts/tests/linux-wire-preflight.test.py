"""Pure bounded preflight and phase guards; no Docker, socket or GUI is started."""
import argparse
import json
from pathlib import Path
import runpy
import subprocess
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).parent
HELPER = runpy.run_path(str(HERE / 'linux-wire-preflight.py'))
WRAPPER = runpy.run_path(str(HERE / 'linux-wire-probe.py'))
IMAGE = 'uwork-linux-desktop-appimage:20261020-wire-v1'
NAME = 'uwork-wire-v2-preflight'
SHA = 'a' * 64
DOCKER = ['docker', '--context', 'colima-uwork-backend']


class Guards(unittest.TestCase):
    def call(self, inspect, run):
        directory = tempfile.TemporaryDirectory(prefix='uwork-preflight-pure-')
        self.addCleanup(directory.cleanup)
        receipt = Path(directory.name) / 'receipt.json'
        function = HELPER['run_preflight']
        return receipt, patch.dict(function.__globals__, {'inspect_container': inspect}), patch.object(subprocess, 'run', side_effect=run)

    def test_command_is_named_readonly_and_finite_scope(self):
        value = HELPER['preflight_command'](DOCKER, IMAGE, NAME)
        self.assertEqual(value, DOCKER + ['run', '--rm', '--name', NAME, '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--entrypoint', 'sha256sum', IMAGE, '/opt/artifacts/uwork-preview.AppImage'])
        for name in ['foreign', '../uwork-wire-v2', NAME + ';echo']:
            with self.assertRaises(AssertionError): HELPER['preflight_command'](DOCKER, IMAGE, name)

    def test_natural_hash_exit_and_absence_is_preflight_only(self):
        calls = []
        def run(argv, **kwargs):
            calls.append((argv, kwargs))
            return subprocess.CompletedProcess(argv, 0, SHA + '  /owned.AppImage\n', '')
        receipt, inspect_patch, run_patch = self.call(lambda *_: None, run)
        with inspect_patch, run_patch:
            value = HELPER['run_preflight'](DOCKER, IMAGE, NAME, SHA, receipt)
        self.assertTrue(value.startswith(SHA))
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][1]['timeout'], 30)
        facts = json.loads(receipt.read_text())
        self.assertEqual(facts['status'], 'passed-readonly-preflight-only')
        self.assertTrue(facts['ownedContainerAbsent'])
        self.assertFalse(facts['guiStarted'])

    def test_wrong_hash_cannot_enter_a_gui(self):
        receipt, a, b = self.call(lambda *_: None, lambda argv, **_: subprocess.CompletedProcess(argv, 0, 'b' * 64, ''))
        with a, b, self.assertRaises(AssertionError): HELPER['run_preflight'](DOCKER, IMAGE, NAME, SHA, receipt)
        self.assertEqual(json.loads(receipt.read_text())['status'], 'failed')

    def test_timeout_removes_only_its_exact_owned_hash_container_and_stays_failed(self):
        state = [None]
        calls = []
        def run(argv, **kwargs):
            calls.append(argv)
            if 'run' in argv:
                state[0] = {'Config': {'Image': IMAGE, 'Entrypoint': ['sha256sum'], 'Cmd': ['/opt/artifacts/uwork-preview.AppImage']}}
                raise subprocess.TimeoutExpired(argv, 30)
            self.assertEqual(argv, DOCKER + ['rm', '-f', NAME])
            state[0] = None
            return subprocess.CompletedProcess(argv, 0, '', '')
        receipt, a, b = self.call(lambda *_: state[0], run)
        with a, b, self.assertRaises(AssertionError): HELPER['run_preflight'](DOCKER, IMAGE, NAME, SHA, receipt)
        facts = json.loads(receipt.read_text())
        self.assertEqual(facts['failure']['type'], 'TimeoutExpired')
        self.assertTrue(facts['ownedContainerAbsent'])
        self.assertEqual(len(calls), 2)

    def test_preexisting_name_is_not_claimed_or_removed(self):
        receipt, a, b = self.call(lambda *_: {'Config': {'Image': 'foreign'}}, lambda *_args, **_kwargs: self.fail('No Docker mutation allowed'))
        with a, b, self.assertRaises(AssertionError): HELPER['run_preflight'](DOCKER, IMAGE, NAME, SHA, receipt)
        self.assertNotIn('ownedPreflightRemoval', json.loads(receipt.read_text()))

    def test_default_validation_never_calls_preflight_or_gui(self):
        args = argparse.Namespace(prepare=None, preparation=Path('/owned/plan.json'), preflight=False, run=False)
        fn = WRAPPER['main']
        with patch.dict(fn.__globals__, {'load_plan': lambda _: ({'name': 'owned'}, {}),
             'gui_run': lambda *_: self.fail('No GUI in default phase')}):
            self.assertTrue(fn(args))

    def test_preflight_phase_exits_without_entering_gui(self):
        args = argparse.Namespace(prepare=None, preparation=Path('/owned/plan.json'), preflight=True, run=False, reviewed_plan_sha256=SHA)
        fn = WRAPPER['main']; calls = []
        with patch.dict(fn.__globals__, {'load_plan': lambda _: ({'name': 'owned', 'preflightContainer': NAME}, {}),
             'PREFLIGHT': {'run_preflight': lambda *a: calls.append(a)}, 'sha': lambda _: SHA,
             'gui_run': lambda *_: self.fail('No GUI after preflight')}):
            self.assertTrue(fn(args))
        self.assertEqual(len(calls), 1)

    def test_wrong_reviewed_plan_cannot_run_gui(self):
        args = argparse.Namespace(prepare=None, preparation=Path('/owned/plan.json'), preflight=False, run=True, reviewed_plan_sha256='wrong')
        fn = WRAPPER['main']
        with patch.dict(fn.__globals__, {'load_plan': lambda _: ({'name': 'owned'}, {}), 'sha': lambda _: SHA,
             'gui_run': lambda *_: self.fail('No GUI with wrong approval hash')}):
            with self.assertRaises(AssertionError): fn(args)


if __name__ == '__main__':
    unittest.main()
