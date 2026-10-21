"""Thin derivation of the existing real Server update + SDK controller; no GUI/remote/model."""

import argparse, hashlib, json, os, shutil, subprocess, tarfile, re, importlib.util
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SLICE = REPO / "scripts/tests/server-local-pty-update-slice.mjs.tpl"
NODE = "/Users/ljp/.cache/uwork-client-toolchain/node-v24.14.0-darwin-arm64/bin/node"
DOCKER = ["docker", "--context", "colima-uwork-backend"]
_preflight_spec = importlib.util.spec_from_file_location(
    "owned_preflight", REPO / "scripts/tests/linux-wire-preflight.py"
)
_preflight = importlib.util.module_from_spec(_preflight_spec)
_preflight_spec.loader.exec_module(_preflight)
inspect_container = _preflight.inspect_container
IMAGE = "sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8"


def sha(p):
    with Path(p).open("rb") as f:
        return hashlib.file_digest(f, "sha256").hexdigest()


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--target", choices=["darwin-arm64", "linux-arm64"], required=True)
    ap.add_argument("--name", required=True)
    ap.add_argument("--run", action="store_true")
    ap.add_argument("--execute-prepared", action="store_true")
    ap.add_argument("--linux-native-volume", action="store_true")
    a = ap.parse_args()
    assert (
        a.name.startswith("client-server-local-pty-")
        and a.name.replace("-", "").isalnum()
    )
    design = json.loads(
        (
            REPO
            / "data/sandbox-verification/client-server-local-pty-update-plan-20261020/plan.json"
        ).read_text()
    )["targets"][a.target]
    evidence = REPO / "evidence" / a.name
    if a.execute_prepared:
        plan = json.loads((evidence / "preparation.json").read_text())
        assert plan["target"] == a.target
        assert (
            sha(REPO / "scripts/tests/server-update-stateful-probe.mjs")
            == plan["originalControllerSha256"]
        )
        assert sha(SLICE) == plan["sliceSha256"]
        return execute(a, evidence, plan)
    evidence.mkdir(mode=0o700)
    base = (
        (Path.home() / "Library/Caches/uwork-backend" / a.name)
        if a.target.startswith("darwin")
        else REPO / "data/sandbox-verification" / a.name
    )
    source = base / "input"
    work = base / "work"
    bootstrap = source / "bootstrap"
    source.mkdir(parents=True, mode=0o755)
    work.mkdir(mode=0o777)
    work.chmod(0o777)
    metadata = {}
    for key in ["old", "new"]:
        original = Path(design[key + "Archive"])
        target = source / (key + ".tar.gz")
        shutil.copyfile(original, target)
        assert sha(target) == design[key + "ArchiveSha256"]
        with tarfile.open(target) as t:
            top = "zcode-server-" + a.target + "/"
            manifest = json.load(t.extractfile(top + "manifest.json"))
            native = (
                top
                + "runtime/node_modules/node-pty/prebuilds/"
                + a.target
                + "/pty.node"
            )
            metadata[key] = {
                "sha256": sha(target),
                "size": target.stat().st_size,
                "appVersion": manifest["appVersion"],
                "target": manifest["target"],
                "nativeSha256": hashlib.sha256(
                    t.extractfile(native).read()
                ).hexdigest(),
            }
    shutil.copytree(design["newReleaseDir"], bootstrap)
    (source / "metadata.json").write_text(json.dumps(metadata, indent=2) + "\n")
    original = REPO / "scripts/tests/server-update-stateful-probe.mjs"
    raw = original.read_text()
    assert (
        raw.count("\nlet workspacePath;") == 1
        and raw.count("\nasync function endpointClosed(") == 1
    )
    prefix = raw[: raw.index("\nlet workspacePath;")]
    endpoint = raw[
        raw.index("\nasync function endpointClosed(") : raw.index(
            "\nconst deadline = setTimeout"
        )
    ]
    cleanup = raw[
        raw.index("} catch (error) {\n  facts.failure = String(error);\n} finally {") :
    ]
    start = cleanup.index("  if (metadata.clockRollback) {")
    end = cleanup.index("  facts.finishedAt = Date.now();", start)
    cleanup = cleanup[:start] + cleanup[end:]
    prefix = prefix.replace(
        'if (metadata.clockRollback)\n  env.NODE_OPTIONS = "--import /input/clock-preload.mjs";',
        "",
    )
    prefix = prefix.replace(
        "import { spawn }", "import { spawn, execFileSync }"
    ).replace(
        "import { mkdir, readFile, writeFile }",
        "import { mkdir, readFile, writeFile, readlink }",
    )
    prefix = 'import {createHash} from "node:crypto";\n' + prefix
    prefix = prefix.replace(
        'stdio: ["ignore", "pipe", "pipe"],',
        'stdio: [args[0] === "uninstall" ? "pipe" : "ignore", "pipe", "pipe"],',
    )
    prefix = prefix.replace(
        '  child.stdout.on("data", (chunk) => {\n    stdout += chunk;\n  });',
        """  let confirmations=0;
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    if(args[0]==='uninstall') {
      const count=(stdout.match(/Type DELETE/g)||[]).length;
      if(count>confirmations) {assert.equal(count,confirmations+1);assert.ok(count<=2);child.stdin.write('DELETE\\n');confirmations=count;}
    }
  });""",
    )
    prefix = prefix.replace(
        "  const value = stdout",
        '  const value = (args[0] === "uninstall" ? stdout.slice(stdout.indexOf(\'{"uninstalled":\')) : stdout)',
    )
    prefix = prefix.replace(
        "  assert.equal(timedOut, false);",
        '  if(args[0] === "uninstall") {assert.equal(confirmations,2);facts.uninstallConfirmations=confirmations;}\n  assert.equal(timedOut, false);',
    )
    # Exercise the actual derived parser before starting any product process.
    parser_code = prefix[
        prefix.index("  const value = ") : prefix.index("  facts.commands.push(")
    ]
    parser_test = 'import assert from "node:assert/strict";\n' + "".join(
        " { const args="
        + json.dumps(args)
        + "; const stdout="
        + json.dumps(stdout)
        + ";"
        + parser_code
        + "assert.equal(value."
        + field
        + ", true); }\n"
        for args, stdout, field in [
            (
                ["uninstall"],
                'Type DELETE to uninstall UWork Server: Type DELETE again: {"uninstalled":true,"preservedPaths":[]}\n',
                "uninstalled",
            ),
            (["update"], '{"applied":true}\n', "applied"),
        ]
    )
    subprocess.run(
        [NODE, "--input-type=module", "-e", parser_test],
        check=True,
        capture_output=True,
    )
    slice_path = SLICE
    derived = prefix + endpoint + "\n" + slice_path.read_text() + cleanup
    # Only controller paths are mapped; original SDK/module imports stay authoritative.
    if a.target.startswith("darwin"):
        derived = re.sub(
            r"(?<=[\"'])/(bootstrap|input|work)(?=[/\"'])",
            lambda m: {
                "bootstrap": str(bootstrap),
                "input": str(source),
                "work": str(work),
            }[m.group(1)],
            derived,
        )
        derived = derived.replace(
            'TMPDIR: "/tmp"', "TMPDIR: " + json.dumps(str(work / "tmp"))
        )
    else:
        derived = derived.replace('TMPDIR: "/tmp"', 'TMPDIR: "/work/tmp"')
    path_checks = {}
    for key, path in {
        "launcher": bootstrap / "bin/zcode",
        "runtime": bootstrap / "runtime/node",
        "native": bootstrap
        / "runtime/node_modules/node-pty/prebuilds"
        / a.target
        / "pty.node",
        "metadata": source / "metadata.json",
    }.items():
        st = path.lstat()
        assert path.is_file()
        path_checks[key] = {
            "path": str(path),
            "size": st.st_size,
            "mode": oct(st.st_mode & 0o777),
        }
    assert os.access(bootstrap / "bin/zcode", os.X_OK) and os.access(
        bootstrap / "runtime/node", os.X_OK
    )
    if a.target.startswith("darwin"):
        assert (
            "let launcher = " + json.dumps(str(bootstrap / "bin/zcode")) + ";"
        ) in derived
        assert ("const root = " + json.dumps(str(work / "server")) + ";") in derived
        assert (
            '"/input/' not in derived
            and '"/bootstrap/' not in derived
            and '"/work/' not in derived
        )
    derived_path = REPO / "scripts/tests" / ("." + a.name + ".mjs")
    derived_path.write_text(derived)
    env = {k: os.environ[k] for k in ["HOME", "TMPDIR", "LANG"] if k in os.environ}
    env["PATH"] = str(Path(NODE).parent) + ":/opt/homebrew/bin:/usr/bin:/bin"
    try:
        with (evidence / "bundle.log").open("w") as log:
            subprocess.run(
                [
                    str(REPO / "clients/uwork/node_modules/.bin/esbuild"),
                    str(derived_path),
                    "--bundle",
                    "--platform=node",
                    "--format=esm",
                    "--target=node22",
                    '--banner:js=import {createRequire as _statefulRequire} from "node:module"; const require=_statefulRequire(import.meta.url);',
                    "--outfile=" + str(source / "driver.mjs"),
                ],
                env=env,
                check=True,
                stdout=log,
                stderr=subprocess.STDOUT,
                timeout=40,
            )
    finally:
        derived_path.unlink()
    subprocess.run(
        [NODE, "--check", str(source / "driver.mjs")], check=True, capture_output=True
    )
    plan = {
        "linuxWorkVolume": a.linux_native_volume,
        "status": "prepared",
        "name": a.name,
        "target": a.target,
        "archives": metadata,
        "base": str(base),
        "originalControllerSha256": sha(original),
        "sliceSha256": sha(slice_path),
        "driverSha256": sha(source / "driver.mjs"),
        "preparerSha256": sha(__file__),
        "scope": "original local SDK File/Setting/Terminal only, no Provider/model/Task/remote; same-version build replacement; dispose before update",
        "guards": [
            "7 Core environment fields + SDK homedir before writes",
            "actual mapped native SHA",
            "original double DELETE",
            "exact owned stop +12s no respawn",
        ],
        "preflightPathChecks": path_checks,
        "originalPrefixSha256": hashlib.sha256(
            raw[: raw.index("\nlet workspacePath;")].encode()
        ).hexdigest(),
    }
    (evidence / "preparation.json").write_text(json.dumps(plan, indent=2) + "\n")
    if not a.run:
        print(json.dumps(plan))
        return
    return execute(a, evidence, plan)


def execute(a, evidence, plan):
    base = Path(plan["base"])
    source = base / "input"
    work = base / "work"
    bootstrap = source / "bootstrap"
    metadata = plan["archives"]
    assert not (
        evidence / "controller-result.json"
    ).exists(), "Never rerun an already executed case"
    assert sha(source / "driver.mjs") == plan["driverSha256"]
    assert all(
        sha(source / (k + ".tar.gz")) == metadata[k]["sha256"] for k in ["old", "new"]
    )
    env = {k: os.environ[k] for k in ["HOME", "TMPDIR", "LANG"] if k in os.environ}
    env["PATH"] = str(Path(NODE).parent) + ":/opt/homebrew/bin:/usr/bin:/bin"
    name = a.name
    container = name + "-run"
    volume = name + "-data"
    launched = False
    volume_created = False
    result = {"status": "failed", "planSha256": sha(evidence / "preparation.json")}
    try:
        if plan.get("linuxWorkVolume"):
            assert (
                a.target == "linux-arm64" and inspect_container(DOCKER, volume) is None
            )
            subprocess.run(
                DOCKER
                + [
                    "volume",
                    "create",
                    "--label",
                    "uwork.owner=server-local-pty",
                    "--label",
                    "uwork.case=" + name,
                    volume,
                ],
                check=True,
                capture_output=True,
                timeout=15,
            )
            volume_created = True
            v = inspect_container(DOCKER, volume)
            assert v["Driver"] == "local" and v["Labels"] == {
                "uwork.owner": "server-local-pty",
                "uwork.case": name,
            }
            result["volumeCreated"] = {
                "name": volume,
                "driver": v["Driver"],
                "labels": v["Labels"],
            }
            common = [
                "--network",
                "none",
                "--read-only",
                "--cap-drop",
                "ALL",
                "--security-opt",
                "no-new-privileges",
                "--memory",
                "128m",
                "--cpus",
                "1",
                "--mount",
                f"type=volume,src={volume},dst=/work,volume-nocopy",
            ]
            for suffix, user, entry, tail, extra in [
                ("init", "0:0", "/bin/chmod", ["0777", "/work"], []),
                (
                    "fscheck",
                    "1000:1000",
                    "/bootstrap/runtime/node",
                    [
                        "--input-type=module",
                        "-e",
                        "import {mkdir,utimes,rm} from 'node:fs/promises'; import assert from 'node:assert/strict'; assert.equal(process.getuid(),1000); const p='/work/owned-utime-probe'; await mkdir(p); await utimes(p,123,456); await rm(p,{recursive:true}); console.log('owned UID1000 mkdir+utime OK')",
                    ],
                    ["--mount", f"type=bind,src={bootstrap},dst=/bootstrap,readonly"],
                ),
            ]:
                aux = name + "-" + suffix
                assert inspect_container(DOCKER, aux) is None
                try:
                    r = subprocess.run(
                        DOCKER
                        + ["run", "--name", aux, "--user", user]
                        + common
                        + extra
                        + ["--entrypoint", entry, IMAGE]
                        + tail,
                        capture_output=True,
                        text=True,
                        timeout=30,
                    )
                    result[suffix] = {
                        "exitCode": r.returncode,
                        "stdout": r.stdout,
                        "stderr": r.stderr,
                    }
                    assert r.returncode == 0
                finally:
                    own = inspect_container(DOCKER, aux)
                    if own is not None:
                        assert (
                            own["Name"] == "/" + aux
                            and own["Config"]["Image"] == IMAGE
                            and own["Config"]["Entrypoint"] == [entry]
                            and own["Config"]["Cmd"] == tail
                            and own["Config"]["User"] == user
                        )
                        hc = own["HostConfig"]
                        assert (
                            hc["NetworkMode"] == "none"
                            and hc["ReadonlyRootfs"]
                            and hc["CapDrop"] == ["ALL"]
                            and "no-new-privileges" in hc["SecurityOpt"]
                        )
                        assert any(
                            m["Type"] == "volume"
                            and m["Name"] == volume
                            and m["Destination"] == "/work"
                            for m in own["Mounts"]
                        )
                        assert all(
                            m["Type"] != "bind"
                            or (
                                suffix == "fscheck"
                                and m["Destination"] == "/bootstrap"
                                and m["Source"] == str(bootstrap)
                                and not m["RW"]
                            )
                            for m in own["Mounts"]
                        )
                        subprocess.run(
                            DOCKER + ["rm", "-f", aux],
                            check=True,
                            capture_output=True,
                            timeout=15,
                        )
                    result[suffix]["containerAbsent"] = (
                        inspect_container(DOCKER, aux) is None
                    )
        if a.target.startswith("darwin"):
            cmd = [str(bootstrap / "runtime/node"), str(source / "driver.mjs")]
        else:
            assert inspect_container(DOCKER, container) is None
            cmd = DOCKER + [
                "run",
                "--name",
                container,
                "--init",
                "--network",
                "none",
                "--read-only",
                "--user",
                "1000:1000",
                "--cap-drop",
                "ALL",
                "--security-opt",
                "no-new-privileges",
                "--memory",
                "1g",
                "--cpus",
                "1",
                "--tmpfs",
                "/tmp:rw,nosuid,size=64m",
                "--mount",
                f"type=bind,src={source},dst=/input,readonly",
                "--mount",
                f"type=bind,src={bootstrap},dst=/bootstrap,readonly",
                "--mount",
                f"type=bind,src={work},dst=/work",
                "--entrypoint",
                "/bootstrap/runtime/node",
                IMAGE,
                "/input/driver.mjs",
            ]
        if plan.get("linuxWorkVolume"):
            cmd[cmd.index(f"type=bind,src={work},dst=/work")] = (
                f"type=volume,src={volume},dst=/work,volume-nocopy"
            )
        result["argv"] = cmd
        launched = True
        with (evidence / "run.log").open("w") as log:
            run = subprocess.run(
                cmd, env=env, stdout=log, stderr=subprocess.STDOUT, timeout=250
            )
        result["exitCode"] = run.returncode
        if plan.get("linuxWorkVolume"):
            subprocess.run(
                DOCKER
                + [
                    "cp",
                    container + ":/work/result.json",
                    str(evidence / "volume-result.json"),
                ],
                check=True,
                capture_output=True,
                timeout=15,
            )
            shutil.copyfile(evidence / "volume-result.json", work / "result.json")
            logcopy = subprocess.run(
                DOCKER
                + [
                    "cp",
                    container + ":/work/server/logs",
                    str(evidence / "owned-core-logs"),
                ],
                capture_output=True,
                text=True,
                timeout=15,
            )
            result["ownedCoreLogsCopy"] = {
                "exitCode": logcopy.returncode,
                "stderr": logcopy.stderr[-500:],
            }
        if (work / "result.json").exists():
            shutil.copyfile(work / "result.json", evidence / "result.json")
            business = json.loads((work / "result.json").read_text())
            result["businessStatus"] = business["status"]
            if run.returncode == 0 and business["status"] == "passed":
                result["status"] = "passed"
    except BaseException as e:
        result["failure"] = f"{type(e).__name__}: {e}"
    finally:
        if a.target.startswith("linux"):
            try:
                owned = inspect_container(DOCKER, container)
                if owned is not None:
                    assert launched and owned["Name"] == "/" + container
                    assert (
                        owned["Config"]["Image"] == IMAGE
                        and owned["Config"]["Entrypoint"] == ["/bootstrap/runtime/node"]
                        and owned["Config"]["Cmd"] == ["/input/driver.mjs"]
                    )
                    assert owned["Config"]["User"] == "1000:1000"
                    hc = owned["HostConfig"]
                    assert (
                        hc["NetworkMode"] == "none"
                        and hc["ReadonlyRootfs"]
                        and hc["CapDrop"] == ["ALL"]
                        and "no-new-privileges" in hc["SecurityOpt"]
                    )
                    assert hc["Memory"] == 1073741824 and hc["NanoCpus"] == 1000000000
                    mounts = {
                        m["Destination"]: (m["Source"], m["RW"])
                        for m in owned["Mounts"]
                        if m["Type"] == "bind"
                    }
                    expected_mounts = {
                        "/input": (str(source), False),
                        "/bootstrap": (str(bootstrap), False),
                    }
                    if not plan.get("linuxWorkVolume"):
                        expected_mounts["/work"] = (str(work), True)
                    assert mounts == expected_mounts
                    if plan.get("linuxWorkVolume"):
                        assert any(
                            m["Type"] == "volume"
                            and m["Name"] == volume
                            and m["Destination"] == "/work"
                            and m["RW"]
                            for m in owned["Mounts"]
                        )
                    result["ownedContainer"] = {
                        "id": owned["Id"],
                        "name": owned["Name"],
                        "image": owned["Image"],
                        "state": owned["State"],
                        "user": owned["Config"]["User"],
                        "mounts": mounts,
                        "network": "none",
                        "capDrop": hc["CapDrop"],
                        "securityOpt": hc["SecurityOpt"],
                        "memory": hc["Memory"],
                        "nanoCpus": hc["NanoCpus"],
                    }
                    subprocess.run(
                        DOCKER + ["rm", "-f", container],
                        check=True,
                        capture_output=True,
                        timeout=15,
                    )
                result["containerAbsent"] = inspect_container(DOCKER, container) is None
            except BaseException as e:
                result["status"] = "failed"
                result["cleanupFailure"] = str(e)
                result["containerAbsent"] = False
        if volume_created:
            try:
                assert result.get("containerAbsent") is True
                v = inspect_container(DOCKER, volume)
                assert v["Driver"] == "local" and v["Labels"] == {
                    "uwork.owner": "server-local-pty",
                    "uwork.case": name,
                }
                consumers = subprocess.run(
                    DOCKER + ["ps", "-aq", "--filter", "volume=" + volume],
                    check=True,
                    capture_output=True,
                    text=True,
                    timeout=10,
                )
                assert (
                    not consumers.stdout.strip()
                ), "Do not delete a volume with any consumer"
                subprocess.run(
                    DOCKER + ["volume", "rm", volume],
                    check=True,
                    capture_output=True,
                    timeout=15,
                )
                result["volumeAbsent"] = inspect_container(DOCKER, volume) is None
            except BaseException as e:
                result["status"] = "failed"
                result["volumeCleanupFailure"] = str(e)
                result["volumeAbsent"] = False
        result["driverSha256Stable"] = (
            sha(source / "driver.mjs") == plan["driverSha256"]
        )
        result["archiveSha256Stable"] = all(
            sha(source / (k + ".tar.gz")) == metadata[k]["sha256"]
            for k in ["old", "new"]
        )
        (evidence / "controller-result.json").write_text(
            json.dumps(result, indent=2) + "\n"
        )
    print(json.dumps(result))
    raise SystemExit(0 if result["status"] == "passed" else 1)


if __name__ == "__main__":
    main()
