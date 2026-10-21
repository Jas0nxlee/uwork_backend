import unittest
from native_workspace_evidence import validate_explicit_workspace


class WorkspaceEvidenceTests(unittest.TestCase):
    def test_rejects_default_model_cwd_even_if_the_requested_cli_exists(self):
        with self.assertRaises(AssertionError):
            validate_explicit_workspace('/requested', ['/default'], ['/default', '/requested'])

    def test_accepts_requested_execution_with_an_unused_default_warmup(self):
        proof = validate_explicit_workspace('/requested', ['/requested'], ['/default', '/requested'])
        self.assertEqual(proof['matchingCliCount'], 1)
        self.assertEqual(proof['otherPrewarmedCliCount'], 1)

    def test_rejects_missing_matching_live_cli(self):
        with self.assertRaises(AssertionError):
            validate_explicit_workspace('/requested', ['/requested'], ['/default'])

    def test_rejects_missing_or_mixed_model_context(self):
        for directories in ([], ['/requested', '/default']):
            with self.subTest(directories=directories), self.assertRaises(AssertionError):
                validate_explicit_workspace('/requested', directories, ['/requested'])


if __name__ == '__main__':
    unittest.main()
