"""Fresh v12 counterfactual message sub-budget; original operation/business unchanged."""

import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
V10_DRIVER = ROOT / "scripts/tests/mac-native-active-quit-v16-native-domain-probe.py"


def derive_v12_driver(source):
    def once(old, new):
        nonlocal source
        assert source.count(old) == 1, old
        source = source.replace(old, new)

    once(
        "client-native-packaged-macos-clock-arm64-active-quit-v10-20261021",
        "client-native-packaged-macos-clock-arm64-active-quit-v12-20261021",
    )
    once(
        "scripts/fixtures/mac-native-active-quit-v16-native-domain-derived.mjs",
        "scripts/fixtures/mac-native-active-quit-v16-message-budget-derived.mjs",
    )
    once(
        'AX_DERIVED = CANDIDATE["derive_quit_domain_ax_module"](AX_SOURCE.read_text())',
        'MESSAGE_BUDGET = runpy.run_path(str(ROOT / "scripts/tests/quit-ax-message-budget-counterfactual.py"))\nAX_DERIVED = MESSAGE_BUDGET["derive_ax_module"](CANDIDATE["derive_quit_domain_ax_module"](AX_SOURCE.read_text()))',
    )
    once(
        '"capture_candidate_bound": capture_candidate_bound,',
        '"capture_candidate_bound": capture_candidate_bound,\\n        "capture_before_cleanup": capture_before_cleanup,',
    )
    return source


V = {"__file__": str(Path(__file__).resolve()), "__name__": "private_v12_controller"}
exec(compile(derive_v12_driver(V10_DRIVER.read_text()), str(V10_DRIVER), "exec"), V)
H = V["MESSAGE_BUDGET"]
OLD_CAPTURE = V["capture_candidate_bound"]
OLD_DERIVE = V["deriveActiveQuitProbe"]


def capture_candidate_bound(error, evidence, facts):
    try:
        OLD_CAPTURE(error, evidence, facts)
        H["RAW_ERROR"]["capture_raw_error"](error, evidence, facts)
        H["capture_timings"](error, evidence, facts)
    except BaseException:
        pass


def deriveActiveQuitProbe(source):
    result = OLD_DERIVE(source)
    anchor = "        facts['failure'] = type(error).__name__ + ': ' + str(error)\n"
    assert result.count(anchor) == 1
    return result.replace(
        anchor,
        anchor
        + "        capture_before_cleanup(f,evidence,facts,work_deadline,QUIT_V15_BUDGET)\n",
    )


capture_before_cleanup = H["capture_before_cleanup"]
for name, value in {
    "deriveActiveQuitProbe": deriveActiveQuitProbe,
    "capture_candidate_bound": capture_candidate_bound,
    "capture_before_cleanup": capture_before_cleanup,
}.items():
    V[name] = value
    V["M"][name] = value
for exported in (
    "PROFILE",
    "PREVIOUS",
    "BASE",
    "M",
    "AX_SOURCE",
    "AX_DERIVED",
    "AX_NAMESPACE",
    "deriveV15Controller",
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
