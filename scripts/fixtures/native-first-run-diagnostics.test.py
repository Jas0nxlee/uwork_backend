"""Safe cause taxonomy only; no browser, network, identity or external process."""
from pathlib import Path
import json
import runpy
import unittest

original = runpy.run_path(str(Path(__file__).with_name('native-first-run-ui.test.py')))
Fixture = original['Fixture']
ui = original['ui']


class Diagnostics(unittest.TestCase):
    def failure(self, actor, step):
        with self.assertRaises(ui.FirstRunUiError) as caught:
            actor.phase(step)
        self.assertEqual(str(caught.exception), 'FIRST_RUN_PHASE_FAILED_RAW_DETAILS_WITHHELD')
        return caught.exception.diagnostic

    def test_original_precondition_code_and_phase_survive_without_raw_details(self):
        f = Fixture('file-restored')
        details = self.failure(f.actor(), 'finish')
        self.assertEqual(details, dict(phase='finish', mode='file-restored', stage='validate',
                                      causeCode='WRONG_ONBOARDING_STEP', causeType='FirstRunUiError'))
        self.assertFalse(f.clicks())

    def test_timeout_during_input_is_different_and_cannot_replay(self):
        f = Fixture()
        def timeout(*args, **kwargs):
            raise TimeoutError('token=private https://private.invalid/path')
        actor = ui.FirstRunUi(f.mode, f.js, timeout, f.guard, f.budget, f.claim, lambda: f.locked)
        details = self.failure(actor, 'skip_login')
        self.assertEqual(details['stage'], 'input')
        self.assertEqual(details['causeType'], 'TimeoutError')
        self.assertEqual(details['causeCode'], 'UNCLASSIFIED')
        self.assertEqual(self.failure(actor, 'skip_login')['causeCode'], 'EARLIER_FAILURE')
        self.assertEqual(f.used, {'first_run_skip_login'})
        self.assertNotIn('private', json.dumps(details))

    def test_arbitrary_step_exception_text_and_exception_class_name_are_withheld(self):
        f = Fixture()
        details = self.failure(f.actor(), 'PRIVATE_TOKEN_VALUE')
        self.assertEqual(details['phase'], 'unknown')
        class PRIVATE_EXCEPTION_CLASS(Exception):
            pass
        def unsafe(_):
            raise PRIVATE_EXCEPTION_CLASS('PRIVATE_TOKEN_VALUE')
        actor = ui.FirstRunUi(f.mode, unsafe, f.cdp, f.guard, f.budget, f.claim, lambda: f.locked)
        details = self.failure(actor, 'observe')
        self.assertEqual(details['causeType'], 'Exception')
        self.assertNotIn('PRIVATE', json.dumps(details))


if __name__ == '__main__':
    unittest.main()
