import re, runpy, unittest, json, hashlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
M = runpy.run_path(str(HERE / "mac-arm64-crash-recovery-probe.py"))
BASE = (HERE / "macos-clock-probe.py").read_text()


class RecoveryContracts(unittest.TestCase):
    def test_all_original_seven_checks_and_seat_logout_cold_contracts_remain(self):
        source = M["deriveCrashRecoveryProbe"](BASE)
        compile(source, "actual-recovery-probe", "exec")
        original = re.findall(r"checks.append\('([^']+)'\)", BASE)
        self.assertEqual(len(original), 7)
        for marker in original:
            self.assertEqual(source.count("checks.append('" + marker + "')"), 1)
        self.assertEqual(len(re.findall(r"checks.append\('([^']+)'\)", source)), 9)
        self.assertIn("delivered=updated", source)
        self.assertIn("'amount':88", source)
        self.assertIn("f.command('memberSeat', value=False)", source)
        self.assertNotIn("row.get('pid') != launched['pid']", source)
        self.assertIn("not in recovery_prior_mains", source)

    def test_residual_crash_failure_stops_before_any_recovery_or_new_task(self):
        source = M["deriveCrashRecoveryProbe"](BASE)
        self.assertLess(
            source.index("assert not residual,"),
            source.index("f.send({'op':'launch'})"),
        )
        self.assertIn("crashResidualExactCleanup", source)
        self.assertNotIn("passed-crash-observation-only", source)

    def test_sidebar_new_task_does_not_open_independent_identity_dropdown(self):
        source = M["RECOVERY_SLICE"]
        self.assertIn("enterprise-menu-chat", source)
        self.assertNotIn("enterprise-identity-name", source)
        self.assertNotIn("post-crash-original-identity-menu", source)

    def test_new_prompt_is_only_original_composer_and_distinct_session(self):
        source = M["RECOVERY_SLICE"]
        self.assertIn("task_b['taskId']!=before_ui['taskId']", source)
        self.assertIn("enterprise-menu-chat", source)
        self.assertIn("bridge.raw_cdp('Input.insertText'", source)
        for invalid in ["resumeTask", "sendMessage", "setState", "localStorage"]:
            self.assertNotIn(invalid, source)
        self.assertIn("final_a['semantic']==before_local['semantic']", source)

    def test_profile_and_all_v4_seven_sources_are_frozen(self):
        M["validate_original_profile"](M["PROFILE"])
        with self.assertRaises(AssertionError):
            M["validate_original_profile"](M["PROFILE"].replace("v5", "v4"))
        root = HERE.parents[1]
        p = (
            root
            / "data/sandbox-verification/client-native-packaged-macos-clock-arm64-consistency-v4-20261021/preparation.json"
        )
        m = json.loads(p.read_text())
        names = [
            n
            for n in m["sources"]
            if n.startswith("scripts/fixtures/mac-arm64-crash-consistency")
            or n.startswith("scripts/tests/mac-arm64-crash-consistency")
        ]
        self.assertEqual(len(names), 7)
        for name in names:
            self.assertEqual(
                hashlib.sha256((root / name).read_bytes()).hexdigest(),
                m["sources"][name],
            )


if __name__ == "__main__":
    unittest.main()
