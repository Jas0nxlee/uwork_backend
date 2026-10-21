"""Pure contracts only: never invoke main(), systemctl, a VM, or an HTTP listener."""

import ast
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest
import urllib.parse

REPO = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "registered_update_builder",
    Path(__file__).with_name("build-linux-user-service-update.py"),
)
BUILDER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILDER)
VM, SDK, HELPERS = BUILDER.derive()
PURE = {"Path": Path, "re": re, "json": json, "urllib": urllib}
exec(compile(ast.parse(HELPERS), "<pure-catalog-path-parser>", "exec"), PURE)


class RegisteredUpdateBuild(unittest.TestCase):
    def test_catalog_exact_loopback_and_original_fields(self):
        item = {
            "version": "3.16.0",
            "target": "linux-arm64",
            "bytes": 78212232,
            "sha256": "f55dbc60c412a735a05fb3be4c10beb5d8f858a16eef0127a51e2371744eae89",
        }
        doc = PURE["registered_catalog_document"]("http://127.0.0.1:12345", item)
        self.assertEqual(
            doc,
            {
                "schemaVersion": 1,
                "releases": [
                    {
                        "version": "3.16.0",
                        "target": "linux-arm64",
                        "archiveUrl": "http://127.0.0.1:12345/new.tar.gz",
                        "archiveSha256": item["sha256"],
                        "archiveSizeBytes": 78212232,
                    }
                ],
            },
        )
        for bad in [
            "https://127.0.0.1:12345",
            "http://localhost:12345",
            "http://evil@127.0.0.1:12345",
            "http://127.0.0.1:12345/path",
            "http://127.0.0.1:12345?x=1",
        ]:
            with self.subTest(bad=bad), self.assertRaises(AssertionError):
                PURE["registered_catalog_document"](bad, item)
        for key, value in [
            ("target", "darwin-arm64"),
            ("sha256", "bad"),
            ("bytes", True),
            ("bytes", 0),
            ("version", "0.0.0-dev"),
        ]:
            with self.subTest(key=key), self.assertRaises(AssertionError):
                PURE["registered_catalog_document"](
                    "http://127.0.0.1:12345", {**item, key: value}
                )

    def test_exact_unit_paths_reject_foreign_name(self):
        unit = "com.zhipu.zcode.server.1234abcd.service"
        self.assertEqual(
            PURE["registered_unit_links"]("/home/owner", None, unit),
            [
                Path("/home/owner/.config/systemd/user") / unit,
                Path("/home/owner/.config/systemd/user/default.target.wants") / unit,
            ],
        )
        self.assertEqual(
            PURE["registered_unit_links"]("/home/owner", "/owned/config", unit)[0],
            Path("/owned/config/systemd/user") / unit,
        )
        for bad in [
            "other.service",
            "com.zhipu.zcode.server.1234abcd.service/../other",
            "com.zhipu.zcode.server.ABCD1234.service",
        ]:
            with self.assertRaises(AssertionError):
                PURE["registered_unit_links"]("/home/owner", None, bad)
        with self.assertRaises(AssertionError):
            PURE["registered_unit_links"]("/home/owner", "relative", unit)

    def test_dangling_link_is_not_misclassified_as_absent(self):
        with tempfile.TemporaryDirectory(
            prefix="uwork-unit-link-contract-"
        ) as directory:
            paths = PURE["registered_unit_links"](
                directory, None, "com.zhipu.zcode.server.1234abcd.service"
            )
            paths[0].parent.mkdir(parents=True)
            paths[0].symlink_to(Path(directory) / "missing-owned-descriptor")
            self.assertFalse(paths[0].exists())
            self.assertTrue(os.path.lexists(paths[0]))
        self.assertIn("not any(os.path.lexists(path) for path in unit_links)", VM)

    def test_original_cli_json_parser_and_anchor_guard(self):
        parse = PURE["registered_cli_json"]
        self.assertEqual(
            parse('noise\n{"state":"starting"}\n{"state":"ready"}\n'),
            {"state": "ready"},
        )
        self.assertIsNone(parse("Type DELETE twice: no JSON status line"))
        with self.assertRaises(json.JSONDecodeError):
            parse("{bad}\n")
        with self.assertRaises(AssertionError):
            BUILDER.patch_once("aa", "a", "b")
        with self.assertRaises(AssertionError):
            BUILDER.patch_once("bb", "a", "b")

    def test_registered_runtime_guards_before_writes_and_update_only(self):
        ast.parse(VM)
        self.assertNotIn("ZCODE_SERVER_SKIP_SERVICE_REGISTRATION", VM)
        self.assertIn(
            "assert cli('update') == {'applied': True, 'version': '3.16.0'}", VM
        )
        self.assertNotIn('cli("restart")', VM)
        self.assertNotIn("--force", VM)
        self.assertIn('"ZCODE_SERVER_ROOT": str(root)', VM)
        self.assertLess(VM.index('metadata["driverFiles"]'), VM.index('tar", "-xzf'))
        self.assertIn("['pid', 'birth', 'exe', 'cgroup']", VM)
        self.assertIn("assert int(core['fields']['PPid']) == main['pid']", VM)
        self.assertIn("time.sleep(12)", VM)
        original = (REPO / "scripts/tests/linux-user-service-probe.py").read_text()
        block = original[
            original.index("        child = subprocess.Popen") : original.index(
                '        facts["checks"].append("original-two-confirmation-uninstall-removes-unit-and-descriptor")'
            )
        ]
        self.assertIn(block.rstrip(), VM)

    def test_sdk_uid501_pattern_and_original_public_stty_contract(self):
        node = "/Users/ljp/.cache/uwork-client-toolchain/node-v24.14.0-darwin-arm64/bin/node"
        line = next(
            line.strip().removesuffix(",")
            for line in SDK.splitlines()
            if 'new RegExp("^Uid:' in line
        )
        code = (
            'import assert from "node:assert/strict";const expectedUid="501";const pattern='
            + line
            + ';assert.match("Uid:\\t501\\t501\\t501\\t501",pattern);assert.ok(!pattern.test("Uid:\\t1000\\t1000\\t1000\\t1000"));'
        )
        run = subprocess.run(
            [node, "--input-type=module", "-e", code],
            capture_output=True,
            text=True,
            timeout=5,
            env={"PATH": "/usr/bin:/bin"},
        )
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertIn("systemService.info()", SDK)
        self.assertLess(
            SDK.index("assert.deepEqual(system"),
            SDK.index("ensureConversationWorkspace"),
        )
        self.assertIn("stty size", SDK)
        self.assertIn('[37, 91, "A"]', SDK)
        self.assertIn('[44, 113, "B"]', SDK)
        self.assertIn("terminalEvidence:facts.terminals", SDK)
        self.assertIn("watchedOriginalClose:true", SDK)
        self.assertIn("const close=await bounded(originalClosed,15000", SDK)


if __name__ == "__main__":
    unittest.main()
