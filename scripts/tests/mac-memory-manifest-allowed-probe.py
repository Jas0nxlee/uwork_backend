"""Single allowed topic-description Native stage; no denied mode or private sender."""

import argparse, hashlib, json, runpy, subprocess, select, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
N = runpy.run_path(str(ROOT / "scripts/tests/mac-memory-manifest-v16-denied-probe.py"))
PROFILE = "client-native-packaged-macos-clock-arm64-memory-manifest-allowed-v1-20261021"
BASE = N["BASE"]
MemoryCaseBudget = N["MemoryCaseBudget"]
verify_globals = N["verify_globals"]


def deriveAllowedManifestProbe(original):
    source = N["deriveManifestProbe"](original)

    def once(a, b):
        nonlocal source
        assert source.count(a) == 1, a
        source = source.replace(a, b)

    source = source.replace(
        "'manifestMemoryStatus'", "'allowedManifestStatus'"
    ).replace("'manifestMemoryComplete'", "'allowedManifestComplete'")
    once(
        "scripts/fixtures/mac-memory-manifest-v16-denied-derived.mjs",
        "scripts/fixtures/mac-memory-manifest-allowed-derived.mjs",
    )
    once("assert updated['modelCalls']<=6", "assert updated['modelCalls']<=7")
    once(
        "if updated['own']['settled']==4:break", "if updated['own']['settled']==5:break"
    )
    once(
        "{'count':4,'settled':4,'amount':88,'inputTokens':48,'outputTokens':40}",
        "{'count':5,'settled':5,'amount':110,'inputTokens':60,'outputTokens':50}",
    )
    once("updated['modelCalls']==6", "updated['modelCalls']==7")
    once(
        "'explicit-filesystem-false-native-memory-manifest-withheld-no-extract-normal-text-accounting'",
        "'explicit-filesystem-true-existing-topic-natural-extraction-accounting'",
    )
    once("'negativeTasks':1", "'allowedTopicTasks':1")
    once(
        "        accepted=f.command('allowedManifestComplete'",
        "        sdk_end=min(memory_work_end,time.monotonic()+5)\n        while time.monotonic()<sdk_end:\n            ready=f.command('allowedManifestReady',min(3,memory_budget_left(sdk_end)),sessionId=task['taskId'])['facts'];memory_budget_left(sdk_end)\n            if ready['sdk'] is not None:break\n            time.sleep(.05)\n        assert ready['sdk'] is not None\n        accepted=f.command('allowedManifestComplete'",
    )

    return source


def create_allowed_namespace(source, budget):
    return N["create_manifest_namespace"](source, budget)


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def run(args):
    plan = json.loads(args.preparation.read_text())
    assert (
        plan["profile"] == PROFILE
        and args.preparation.resolve()
        == ROOT / "data/sandbox-verification" / PROFILE / "preparation.json"
    )
    for path, h in plan["sources"].items():
        assert digest(ROOT / path) == h, path
    assert (
        digest(plan["manifestPath"]) == plan["manifestSha256"]
        and digest(__file__) == plan["driverSha256"]
    )
    source = deriveAllowedManifestProbe(BASE.read_text())
    assert hashlib.sha256(source.encode()).hexdigest() == plan["derivedProbeSha256"]
    compile(source, "actual-single-allowed-manifest", "exec")
    if not args.run:
        print(json.dumps({"status": "prepared-not-run", "profile": PROFILE}))
        return True
    assert args.reviewed_plan_sha256 == digest(args.preparation)
    budget = MemoryCaseBudget()
    ns = create_allowed_namespace(source, budget)
    verify_globals(ns)
    old_run, old_select = subprocess.run, select.select
    subprocess.run = lambda *a, **k: budget.subprocess(old_run, *a, **k)
    select.select = lambda *a, **k: budget.select(old_select, *a, **k)
    try:
        return ns["run"](PROFILE, Path(plan["manifestPath"]))
    finally:
        subprocess.run = old_run
        select.select = old_select


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--preparation", type=Path, required=True)
    p.add_argument("--run", action="store_true")
    p.add_argument("--reviewed-plan-sha256")
    raise SystemExit(0 if run(p.parse_args()) else 1)
