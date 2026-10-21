"""Prepare R05 registered-user-unit update inputs only; never contacts a VM or starts a service."""

import argparse
import hashlib
import importlib.util
import os
import subprocess
import json
from pathlib import Path
import shutil
import tarfile

REPO = Path(__file__).resolve().parents[2]
TARGET = "linux-arm64"
ARCHIVES = {
    "old": (
        REPO
        / "data/sandbox-verification/client-linux-systemd-user-v2-20261020/input/release.tar.gz",
        "3b50dc19d24183435fa02fcb379f264642920172fe5276b675eb3c96b2843361",
    ),
    "new": (
        Path(
            "/Users/ljp/Library/Caches/uwork-backend/client-server-node-pty-release-a1a924fc-20261020/linux-arm64/zcode-server-linux-arm64.tar.gz"
        ),
        "f55dbc60c412a735a05fb3be4c10beb5d8f858a16eef0127a51e2371744eae89",
    ),
}


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def prepare(name):
    assert (
        name.startswith("client-linux-systemd-update-")
        and name.replace("-", "").isalnum()
    )
    base = REPO / "data/sandbox-verification" / name
    evidence = REPO / "evidence" / name
    source = base / "input"
    source.mkdir(parents=True, mode=0o700)
    evidence.mkdir(mode=0o700)
    archives = {}
    for key, (original, expected) in ARCHIVES.items():
        assert digest(original) == expected
        destination = source / (key + ".tar.gz")
        shutil.copyfile(original, destination)
        assert digest(destination) == expected
        with tarfile.open(destination) as archive:
            prefix = "zcode-server-" + TARGET + "/"
            manifest = json.load(archive.extractfile(prefix + "manifest.json"))
            assert manifest["target"] == TARGET and manifest["appVersion"] == "3.16.0"
            members = [
                "manifest.json",
                "bin/zcode",
                "runtime/node",
                "runtime/server-cli.js",
                "runtime/server-core.js",
                "runtime/zcode.cjs",
                "runtime/node_modules/node-pty/prebuilds/linux-arm64/pty.node",
            ]
            hashes = {
                member: hashlib.sha256(
                    archive.extractfile(prefix + member).read()
                ).hexdigest()
                for member in members
            }
        archives[key] = {
            "source": str(original),
            "archive": str(destination),
            "sha256": expected,
            "bytes": destination.stat().st_size,
            "target": TARGET,
            "version": manifest["appVersion"],
            "members": hashes,
        }
    assert (
        archives["old"]["members"]["runtime/zcode.cjs"]
        == archives["new"]["members"]["runtime/zcode.cjs"]
    )
    sources = [
        "scripts/tests/linux-user-service-probe.py",
        "scripts/tests/linux-user-service-sdk.mjs",
        "scripts/tests/linux-server-release-probe.mjs",
        "scripts/tests/run-linux-server-release.py",
        "scripts/tests/server-local-pty-update-slice.mjs.tpl",
        "clients/uwork/packages/zcode-server-cli/src/platform/serviceManager.ts",
        "clients/uwork/packages/zcode-server-cli/src/cli.ts",
        "clients/uwork/packages/zcode-server-cli/src/supervisor/supervisor.ts",
        "clients/uwork/packages/zcode-server-cli/src/runtime/stableLauncher.ts",
        "clients/uwork/packages/zcode-server-cli/src/runtime/updatePreparation.ts",
    ]
    frozen = {}
    for relative in sources:
        path = REPO / relative
        target = source / "source-snapshot" / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, target)
        frozen[relative] = {"sha256": digest(path), "snapshot": str(target)}
    baseline = (REPO / sources[0]).read_text()
    anchors = [
        '        assert cli("restart") == {"restarting": True}',
        '        sdk(restarted, "read")',
        "    def sdk(status, phase):",
        "    def owned_descriptor():",
        '        cli("stop")',
        "        time.sleep(12)",
    ]
    assert all(baseline.splitlines().count(anchor) == 1 for anchor in anchors)
    facts = {
        "status": "prepared-readonly-design-not-executable-service-driver",
        "vmContacted": False,
        "serviceStarted": False,
        "containerStarted": False,
        "archives": archives,
        "frozenSources": frozen,
        "baselineSingleAnchors": anchors,
        "serviceBaseline": "evidence/client-linux-systemd-user-v2-20261020/result.json",
        "baselinePeer": "evidence/client-linux-systemd-user-v2-20261020/peer-verdict.json",
        "knownGap": "registered original systemd user unit update has not been executed; restart-only and skip-registration SDK tests do not cover it",
        "neededDriverExtension": "derive original user-service controller + existing public SDK; original local HTTP catalog/update replaces restart stage, with new native PTY slice; no product changes",
        "catalog": {
            "listen": "127.0.0.1:ephemeral inside dedicated VM",
            "routes": ["GET /catalog.json", "GET /new.tar.gz"],
            "schemaVersion": 1,
            "target": TARGET,
            "version": "3.16.0",
            "archiveSha256": archives["new"]["sha256"],
            "archiveSizeBytes": archives["new"]["bytes"],
            "onlyUpdateCliEnvironment": "ZCODE_SERVER_RELEASE_MANIFEST_URL",
            "userManagerEnvironmentChanged": False,
        },
        "requiresOriginalEnvironment": {
            "vmProfile": "uwork-backend",
            "pid1Comm": "systemd",
            "uid": 501,
            "userManagerState": "running",
            "transport": "original normal-user VM session, never Docker/systemctl shim",
            "dataRoot": "fresh VM /tmp/uwsysd-* native filesystem; canonical path and mode0700 before registration",
            "doNotSet": [
                "ZCODE_SERVER_SKIP_SERVICE_REGISTRATION",
                "global user-manager env",
                "extra capabilities",
                "new unit sandbox/cgroup restrictions",
            ],
            "freshReadOnlyObservations": [
                "PID1/uid/user manager",
                "exact unit FragmentPath symlink realpath + ExecStart",
                "MainPID/Supervisor/Core PID birth+exe+PPid",
                "Uid/Gid/CapInh/CapPrm/CapEff/CapBnd/CapAmb/NoNewPrivs/Seccomp of owned processes only",
                "owned /proc/<pid>/cgroup and unit ControlGroup/Slice/MemoryMax/CPUQuota/NoNewPrivileges",
                "before/after exact new label absence; old labels untouched",
            ],
            "historicalCaveat": "v2 did not record process capabilities or cgroup limits; do not inherit cap0/NNP claims from Docker SDK cases",
        },
        "steps": [
            "Read PID1/user-manager/UID and owned-process policy conditions; fail closed before registration if unavailable. Preserve VM lifecycle and other units.",
            "Extract original old3b50 in own native VM scratch, derive root-hash label, prove absent; original serve --daemon (no opt-out), ready + serviceRegistered=true, exact descriptor/normal user symlink/ExecStart/MainPID ownership guards.",
            "Guard actual Core seven profile fields + SDK systemService.info homedir before File/Setting writes; seed original private workspace ignore/settings via original public SDK. Do not run old native resize as a new claimed positive.",
            "Serve own original manifest/full new archive via loopback catalog; only update CLI has manifest URL. Original CLI update with no force; preserve original HTTP receipts/size/SHA/installer validation and JSON response.",
            "Observe old socket natural close + new Core PID/generation, registered=true and same systemd Supervisor MainPID/birth. Recheck exact descriptor/FragmentPath/ExecStart/ControlGroup and active/running; inspect current and actual mapped new native SHA without writing state.",
            "Original SDK reconnect reads identical File/Setting, then NEW terminal public create/resize/write/onDynamicData/dispose proves two shell stty dimensions 37x91 and44x113, stable PID/TTY/cwd and actual UID501. Dispose before shutdown; no live PTY migration claim.",
            "Original stop, actual 12second observation, unit inactive/MainPID0 + no Core/Supervisor respawn. Original double-confirm uninstall. Exact label/descriptor/control socket and both direct+wants user-unit symlinks absent (including dangling links), all owned PID births/ports/catalog/shell closed.",
            "Record original .uwork preserved + setting digest before any separate owned scratch cleanup. Preserve failure and all receipts. Only exact owned root/unit may be cleaned after guards; no broad systemd or VM actions.",
        ],
        "notClaimed": [
            "current registered update passed",
            "cross-version upgrade",
            "production/physical Linux host",
            "login/reboot autostart",
            "models/providers/tasks/remote authority",
            "existing service live PTY migration",
            "all distributions",
        ],
        "preparerSha256": digest(Path(__file__).resolve()),
    }
    spec = importlib.util.spec_from_file_location(
        "registered_update_builder",
        REPO / "scripts/tests/build-linux-user-service-update.py",
    )
    builder = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(builder)
    vm_source, sdk_source, _ = builder.derive()
    (source / "vm.py").write_text(vm_source)
    (source / "sdk-source.mjs").write_text(sdk_source)
    compile(vm_source, str(source / "vm.py"), "exec")
    temporary = REPO / "scripts/tests" / ("." + name + "-sdk.mjs")
    temporary.write_text(sdk_source)
    node = (
        "/Users/ljp/.cache/uwork-client-toolchain/node-v24.14.0-darwin-arm64/bin/node"
    )
    build_env = {
        key: os.environ[key] for key in ["HOME", "TMPDIR", "LANG"] if key in os.environ
    }
    build_env["PATH"] = str(Path(node).parent) + ":/usr/bin:/bin"
    try:
        with (evidence / "sdk-bundle.log").open("w") as log:
            subprocess.run(
                [
                    str(REPO / "clients/uwork/node_modules/.bin/esbuild"),
                    str(temporary),
                    "--bundle",
                    "--platform=node",
                    "--format=esm",
                    "--target=node22",
                    '--banner:js=import {createRequire as _serviceRequire} from "node:module"; const require=_serviceRequire(import.meta.url);',
                    "--outfile=" + str(source / "sdk.mjs"),
                ],
                env=build_env,
                stdout=log,
                stderr=subprocess.STDOUT,
                check=True,
                timeout=40,
            )
    finally:
        temporary.unlink()
    subprocess.run(
        [node, "--check", str(source / "sdk.mjs")],
        check=True,
        capture_output=True,
        timeout=10,
    )
    extra_sources = [
        "scripts/tests/prepare-linux-user-service-update.py",
        "scripts/tests/build-linux-user-service-update.py",
        "scripts/tests/linux-user-service-update-helpers.py.tpl",
        "scripts/tests/linux-user-service-update-main.py.tpl",
        "scripts/tests/linux-user-service-update-step.py.tpl",
        "scripts/tests/test_linux_user_service_update_build.py",
    ]
    for relative in extra_sources:
        path = REPO / relative
        target = source / "source-snapshot" / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, target)
        frozen[relative] = {"sha256": digest(path), "snapshot": str(target)}
    facts.update(
        status="prepared-driver-not-run",
        driverFiles={name: digest(source / name) for name in ["vm.py", "sdk.mjs"]},
        sdkSourceSha256=digest(source / "sdk-source.mjs"),
        vmRunPreview=["python3", str(source / "vm.py"), "--input", str(source)],
        requiresFreshOriginalVmPreflight=True,
        runtimeSourceCompiled=True,
        sdkBundledNodeSyntaxPassed=True,
    )
    facts["neededDriverExtension"] = (
        "implemented as exact-anchor thin derivation; VM service execution still forbidden until Root reviews this frozen driver"
    )
    (source / "metadata.json").write_text(json.dumps(facts, indent=2) + "\n")
    (evidence / "preparation.json").write_text(json.dumps(facts, indent=2) + "\n")
    print(
        json.dumps(
            {
                "status": facts["status"],
                "evidence": str(evidence),
                "vmContacted": False,
                "archiveShas": {key: row["sha256"] for key, row in archives.items()},
            }
        )
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--name", required=True)
    prepare(parser.parse_args().name)
