"""Fresh v11: unchanged v10 business, observe the original private _raw failure only."""

import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
V10_DRIVER = ROOT / "scripts/tests/mac-native-active-quit-v16-native-domain-probe.py"


def derive_v11_driver(source):
    def once(old, new):
        nonlocal source
        assert source.count(old) == 1, old
        source = source.replace(old, new)

    once(
        "client-native-packaged-macos-clock-arm64-active-quit-v10-20261021",
        "client-native-packaged-macos-clock-arm64-active-quit-v11-20261021",
    )
    once(
        "scripts/fixtures/mac-native-active-quit-v16-native-domain-derived.mjs",
        "scripts/fixtures/mac-native-active-quit-v16-raw-error-derived.mjs",
    )
    once(
        'AX_DERIVED = CANDIDATE["derive_quit_domain_ax_module"](AX_SOURCE.read_text())',
        'RAW_ERROR = runpy.run_path(str(ROOT / "scripts/tests/quit-ax-attribute-error-observer.py"))\nAX_DERIVED = RAW_ERROR["derive_raw_error_ax_module"](CANDIDATE["derive_quit_domain_ax_module"](AX_SOURCE.read_text()))',
    )
    return source


V = {"__file__": str(Path(__file__).resolve()), "__name__": "private_v11_controller"}
exec(compile(derive_v11_driver(V10_DRIVER.read_text()), str(V10_DRIVER), "exec"), V)
OLD_CAPTURE = V["capture_candidate_bound"]


def capture_candidate_bound(error, evidence, facts):
    try:
        OLD_CAPTURE(error, evidence, facts)
        V["RAW_ERROR"]["capture_raw_error"](error, evidence, facts)
    except BaseException as observer_error:
        try:
            facts["axAttributeErrorObservation"] = {
                "status": "unavailable",
                "observerErrorType": type(observer_error).__name__[:80],
            }
        except BaseException:
            pass


V["capture_candidate_bound"] = capture_candidate_bound
V["M"]["capture_candidate_bound"] = capture_candidate_bound
for exported in (
    "PROFILE",
    "PREVIOUS",
    "BASE",
    "M",
    "AX_SOURCE",
    "AX_DERIVED",
    "AX_NAMESPACE",
    "deriveV15Controller",
    "deriveActiveQuitProbe",
    "verify_globals",
    "actual_clock_namespace",
    "validate_profile",
    "digest",
    "install_budget",
    "BUDGETS",
):
    globals()[exported] = V[exported]


def run(args):
    return V["run"](args)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--preparation", type=Path, required=True)
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--reviewed-plan-sha256")
    raise SystemExit(0 if run(parser.parse_args()) else 1)
