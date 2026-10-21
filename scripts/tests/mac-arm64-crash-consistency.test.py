import ast, runpy, unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
M = runpy.run_path(str(HERE / "mac-arm64-crash-consistency-probe.py"))
BASE = (HERE / "macos-clock-probe.py").read_text()


class CrashContracts(unittest.TestCase):
    def test_actual_derived_scope_is_explicit_first_five_then_real_crash_observation(
        self,
    ):
        source = M["deriveCrashProbe"](BASE)
        compile(source, "derived", "exec")
        self.assertEqual(source.count("checks.append('original-"), 4)
        self.assertIn("latest-original-signed-package-renderer", source)
        self.assertNotIn(
            "f.command('stopNative', 25)\n        bridge.kill()", M["CRASH_SLICE"]
        )
        self.assertIn("'signal':'SIGKILL'", source)
        self.assertIn("facts['originalSevenAccepted']=False", source)
        self.assertNotIn("f.command('memberSeat', value=False)", source)
        self.assertIn("scopeOmissions", source)
        self.assertIn("cleanup does not change this FAILED", source)

    def test_missing_or_duplicate_source_anchor_rejects(self):
        with self.assertRaises(AssertionError):
            M["deriveCrashProbe"](
                BASE
                + "\n        checks.append('original-packaged-cli-real-backend-supplier-and-member-accounting')\n"
            )

    def test_original_profile_guards_run_without_app_or_network(self):
        M["validate_original_profile"](M["PROFILE"])
        with self.assertRaises(AssertionError):
            M["validate_original_profile"](M["PROFILE"].replace("v4", "v3"))

    def test_observer_does_not_resume_or_send_runtime(self):
        for forbidden in [
            "resumeTask",
            "sendMessage",
            "setState",
            "Input.insertText",
            "f.send({'op':'launch'}",
            "f.command('openWorkspace'",
        ]:
            self.assertNotIn(forbidden, M["CRASH_SLICE"])


if __name__ == "__main__":
    unittest.main()
