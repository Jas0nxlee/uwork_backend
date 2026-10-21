"""One topic-description policy negative, natural original Native extraction only."""

import argparse, hashlib, json, runpy, subprocess, select, time, shlex, base64
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PROFILE = "client-native-packaged-macos-clock-arm64-memory-manifest-fixed-denied-v2-20261021"
D = runpy.run_path(
    str(ROOT / "scripts/tests/mac-arm64-memory-filesystem-denied-probe.py")
)
M = D["M"]
A = D["A"]
BASE = D["BASE"]
MemoryCaseBudget = D["MemoryCaseBudget"]
verify_globals = D["verify_globals"]
S = runpy.run_path(str(ROOT / "scripts/tests/native-safe-cleanup.py"))
MANIFEST_PROMPT = (
    "UWORK_NATIVE_MEMORY_MANIFEST_QUERY_20261021 retain project preference"
)
MANIFEST_MARKER = "UWORK_NATIVE_MEMORY_MANIFEST_DESCRIPTION_20261021"
TOPIC_NAME = "owned-manifest-topic.md"
TOPIC_TEXT = (
    "---\nname: owned-manifest-topic\ndescription: "
    + MANIFEST_MARKER
    + "\nmetadata:\n  type: project\n---\nOwned local acceptance topic.\n"
)


def manifest_seed_command(root, file):
    code = """import fs from'node:fs';import p from'node:path';const root=process.argv[1],file=process.argv[2],text=Buffer.from(process.argv[3],'base64').toString('utf8');if(fs.realpathSync(root)!==root||p.resolve(file)!==file||!file.startsWith(root+p.sep)||!file.endsWith('/memory/owned-manifest-topic.md'))throw Error('owned topic');let cur=root;for(const part of p.relative(root,p.dirname(file)).split(p.sep)){cur=p.join(cur,part);try{fs.mkdirSync(cur,{mode:448})}catch(e){if(e.code!=='EEXIST')throw e}const s=fs.lstatSync(cur);if(!s.isDirectory()||s.isSymbolicLink()||fs.realpathSync(cur)!==cur)throw Error('plain path')}if(fs.existsSync(p.join(p.dirname(file),'MEMORY.md')))throw Error('index must be absent');const fd=fs.openSync(file,'wx',384);try{fs.writeFileSync(fd,text)}finally{fs.closeSync(fd)}"""
    return shlex.join(
        [
            "/Users/ljp/.cache/uwork-client-toolchain/node-v24.14.0-darwin-arm64/bin/node",
            "--input-type=module",
            "-e",
            code,
            str(root),
            str(file),
            base64.b64encode(TOPIC_TEXT.encode()).decode("ascii"),
        ]
    )


def deriveManifestProbe(original):
    source = D["deriveDeniedMemoryProbe"](original)
    old = "        memory_file=Path(warm['file']['filePath']);assert str(memory_file).startswith(str(root/'data/.uwork/cli/memories/projects')+'/')"
    assert source.count(old) == 1
    source = source.replace(
        old,
        "        memory_index=Path(warm['file']['filePath']);assert str(memory_index).startswith(str(root/'data/.uwork/cli/memories/projects')+'/');assert not memory_index.exists()\n        memory_file=memory_index.parent/TOPIC_NAME",
    )
    source = source.replace(
        "pty_memory_command(root,memory_file)",
        "manifest_seed_command(root,memory_file)",
    )
    old = "memory_file.read_bytes()==(BODY+'\\n').encode()"
    assert source.count(old) == 1
    source = source.replace(
        old,
        "memory_file.read_bytes()==TOPIC_TEXT.encode() and not memory_index.exists()",
    )
    source = (
        source.replace("'memoryFilesystemStatus'", "'manifestMemoryStatus'")
        .replace("'memoryFilesystemComplete'", "'manifestMemoryComplete'")
        .replace("current['bodyEscaped']", "current['metadataEscaped']")
        .replace(
            "MEMORY_INDEX_BODY_ESCAPED_FILESYSTEM_FALSE",
            "MEMORY_MANIFEST_METADATA_ESCAPED_FILESYSTEM_FALSE",
        )
        .replace(
            "accepted['session']['originalSchedulerWouldExecute']==0",
            "accepted['session']['gateOracleWouldExecute']==1",
        )
    )
    source = source.replace(
        "'explicit-filesystem-false-native-memory-body-withheld-and-normal-text-accounting'",
        "'explicit-filesystem-false-native-memory-manifest-withheld-no-extract-normal-text-accounting'",
    )
    source = source.replace(
        "            deny_status()\n            value=bridge.evaluate",
        "            deny_status();memory_budget_left(end)\n            value=bridge.evaluate",
    )
    source = source.replace(
        "deny_status();updated=proof();assert",
        "deny_status();memory_budget_left(end);updated=proof();memory_budget_left(end);assert",
    )
    anchor = "        rows=OLD['owned_processes'](launched['pid'],meta['packagedRuntime']['appPath']+'/Contents/Resources/glm/zcode.cjs');known.update(row['pid']for row in rows)"
    assert source.count(anchor) == 1
    source = source.replace(
        anchor,
        "        quiet_until=time.monotonic()+3;assert quiet_until<memory_work_end\n        while time.monotonic()<quiet_until:\n            deny_status();assert proof()==updated;memory_budget_left(memory_work_end);time.sleep(.1)\n"
        + anchor,
    )

    old = "scripts/fixtures/mac-arm64-memory-filesystem-denied-derived.mjs"
    assert source.count(old) == 1
    source = source.replace(
        old, "scripts/fixtures/mac-memory-manifest-v16-denied-derived.mjs"
    )
    return S["derive_safe_native_cleanup"](source, "MEMORY_BUDGET")


def create_manifest_namespace(source, budget):
    ns = D["create_denied_namespace"](source, budget)
    ns.update(
        DENIED_LABEL=MANIFEST_PROMPT,
        TOPIC_NAME=TOPIC_NAME,
        TOPIC_TEXT=TOPIC_TEXT,
        manifest_seed_command=manifest_seed_command,
        safe_native_cleanup=S["safe_native_cleanup"],
    )
    return ns


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
    source = deriveManifestProbe(BASE.read_text())
    compile(source, "actual-manifest-negative", "exec")
    assert hashlib.sha256(source.encode()).hexdigest() == plan["derivedProbeSha256"]
    if not args.run:
        print(json.dumps({"status": "prepared-not-run", "profile": PROFILE}))
        return True
    assert args.reviewed_plan_sha256 == digest(args.preparation)
    budget = MemoryCaseBudget()
    ns = create_manifest_namespace(source, budget)
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
