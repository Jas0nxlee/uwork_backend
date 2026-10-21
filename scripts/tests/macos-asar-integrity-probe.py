"""Exact new ASAR-metadata artifacts; original seven UI checks and deadlines unchanged."""

import argparse, hashlib, json, runpy, subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OLD = runpy.run_path(str(ROOT / "scripts/tests/macos-secondary-exit-probe.py"))
LOG = runpy.run_path(str(ROOT / "scripts/tests/macos-secondary-exit-log.py"))
BASE = OLD["BASE"]
NODE = OLD["NODE"]
APPS = {
    "arm64": "/Users/ljp/Library/Caches/uwork-backend/client-macos-package-20261021-v13-arm64-asar-integrity/mac-arm64/UWork Preview.app",
    "x64": "/Users/ljp/Library/Caches/uwork-backend/client-macos-package-20261021-v14-x64-asar-integrity/mac/UWork Preview.app",
}
PROFILE_REGEX = (
    "r'client-native-packaged-macos-clock-(?:x64|arm64)-asar-integrity-v1-20261021'"
)


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def deriveAsarIntegrityLog(source):
    derived = LOG["deriveSecondaryExitLog"](source)
    assert derived.count(LOG["AFTER"]) == 1
    return derived.replace(LOG["AFTER"], PROFILE_REGEX)


_reader = {"__file__": str(LOG["BASE"]), "__name__": "owned_asar_integrity_log"}
exec(
    compile(deriveAsarIntegrityLog(LOG["BASE"].read_text()), str(LOG["BASE"]), "exec"),
    _reader,
)
read_owned_single_instance_phases = _reader["read_owned_single_instance_phases"]


def validate_asar_integrity_guards(profile, arch):
    assert (
        arch in APPS
        and profile
        == "client-native-packaged-macos-clock-" + arch + "-asar-integrity-v1-20261021"
    )
    runpy.run_path(str(ROOT / "scripts/tests/macos-x64-clock-startup-probe.py"))[
        "validate_original_clock_profile"
    ](profile)
    assert _reader["PROFILE"].fullmatch(profile)
    code = "import {validateAsarIntegrityProfile} from './scripts/fixtures/macos-asar-integrity-derived.mjs';validateAsarIntegrityProfile(process.argv[1],process.argv[2]);"
    subprocess.run(
        [NODE, "--input-type=module", "-e", code, profile, arch],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
        timeout=10,
    )
    return profile


def deriveAsarIntegrityProbe(source, arch):
    assert arch in APPS
    derived = OLD["deriveSecondaryExitProbe"](source, arch)
    changes = [
        (OLD["APPS"][arch], APPS[arch]),
        (
            "'scripts/tests/macos-secondary-exit-log.py'",
            "'scripts/tests/macos-asar-integrity-probe.py'",
        ),
        (
            "['scripts/fixtures/macos-secondary-exit-derived.mjs']",
            "['scripts/fixtures/macos-asar-integrity-derived.mjs']",
        ),
    ]
    for before, after in changes:
        assert derived.count(before) == 1, before
        derived = derived.replace(before, after)
    return derived


def run(args):
    plan = json.loads(args.preparation.read_text())
    arch = plan["target"].removeprefix("darwin-")
    assert (
        args.preparation.resolve()
        == ROOT / "data/sandbox-verification" / plan["profile"] / "preparation.json"
    )
    for path, expected in plan["sources"].items():
        assert digest(ROOT / path) == expected, path
    assert digest(plan["manifestPath"]) == plan["manifestSha256"]
    validate_asar_integrity_guards(plan["profile"], arch)
    source = deriveAsarIntegrityProbe(BASE.read_text(), arch)
    compile(source, str(BASE), "exec")
    assert hashlib.sha256(source.encode()).hexdigest() == plan["derivedProbeSha256"]
    namespace = {
        "__file__": str(BASE),
        "__name__": "owned_asar_integrity_original_seven",
    }
    exec(compile(source, str(BASE), "exec"), namespace)
    return namespace["run"](args)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--preparation", type=Path, required=True)
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--reviewed-plan-sha256")
    raise SystemExit(0 if run(parser.parse_args()) else 1)
