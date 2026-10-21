import runpy, unittest, subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
M = runpy.run_path(str(ROOT / "scripts/tests/macos-asar-integrity-probe.py"))


class Contracts(unittest.TestCase):
    def test_two_arch_actual_guard_and_original_probe_has_only_three_narrow_deltas(
        self,
    ):
        for arch in ["arm64", "x64"]:
            profile = (
                "client-native-packaged-macos-clock-"
                + arch
                + "-asar-integrity-v1-20261021"
            )
            M["validate_asar_integrity_guards"](profile, arch)
            source = M["deriveAsarIntegrityProbe"](M["BASE"].read_text(), arch)
            compile(source, "actual-asar-original-seven", "exec")
            restored = (
                source.replace(M["APPS"][arch], M["OLD"]["APPS"][arch])
                .replace(
                    "'scripts/tests/macos-asar-integrity-probe.py'",
                    "'scripts/tests/macos-secondary-exit-log.py'",
                )
                .replace(
                    "['scripts/fixtures/macos-asar-integrity-derived.mjs']",
                    "['scripts/fixtures/macos-secondary-exit-derived.mjs']",
                )
            )
            self.assertEqual(
                restored,
                M["OLD"]["deriveSecondaryExitProbe"](M["BASE"].read_text(), arch),
            )
            self.assertIn("seconds=30", source)
            self.assertNotIn("seconds=60", source)
            with self.assertRaises(AssertionError):
                M["validate_asar_integrity_guards"](
                    profile.replace("-v1-", "-v2-"), arch
                )

    def test_original_reader_body_exact_after_single_profile_expression_delta(self):
        old = M["LOG"]["BASE"].read_text()
        new = M["deriveAsarIntegrityLog"](old)
        self.assertEqual(new.replace(M["PROFILE_REGEX"], M["LOG"]["BEFORE"]), old)
        self.assertTrue(callable(M["read_owned_single_instance_phases"]))

    def test_actual_entry_has_only_profile_and_strict_loader_path_deltas(self):
        code = """import assert from'node:assert/strict';import{readFileSync}from'node:fs';import{deriveAsarIntegrityEntry,validateAsarIntegrityProfile}from'./scripts/fixtures/macos-asar-integrity-derived.mjs';import{deriveSecondaryExitEntry}from'./scripts/fixtures/macos-secondary-exit-derived.mjs';const old=readFileSync('scripts/fixtures/macos-x64-startup-derived.mjs','utf8');for(const arch of ['arm64','x64']){const value=deriveAsarIntegrityEntry(old,arch);const restored=value.replace('/^client-native-packaged-macos-clock-'+arch+'-asar-integrity-v1-20261021$/','/^client-native-packaged-macos-clock-'+arch+'-secondary-exit-v[0-9]+-20261021$/').replace('./native-packaged-macos-'+arch+'-asar-integrity-runtime.mjs','./native-packaged-macos-'+arch+'-secondary-exit-runtime.mjs');assert.equal(restored,deriveSecondaryExitEntry(old,arch));assert.ok(value.includes('1c013ad74812e1556e287aecefd56dff9a7326ac008aa4cb4aa84248a4c7aae6'));}assert.throws(()=>deriveAsarIntegrityEntry(old,'win32'));"""
        subprocess.run(
            [M["NODE"], "--input-type=module", "-e", code],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
            timeout=10,
        )


if __name__ == "__main__":
    unittest.main()
