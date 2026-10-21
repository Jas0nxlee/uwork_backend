"""Pure source derivation of the existing user-unit driver; never starts its runtime."""

from pathlib import Path
import ast

REPO = Path(__file__).resolve().parents[2]


def patch_once(source, before, after):
    assert source.count(before) == 1, repr(before[:120])
    return source.replace(before, after)


def derive():
    baseline = (REPO / "scripts/tests/linux-user-service-probe.py").read_text()
    helpers = (
        REPO / "scripts/tests/linux-user-service-update-helpers.py.tpl"
    ).read_text()
    main = (REPO / "scripts/tests/linux-user-service-update-main.py.tpl").read_text()
    step = (REPO / "scripts/tests/linux-user-service-update-step.py.tpl").read_text()
    source = patch_once(
        baseline, "\ndef main(source):", "\n" + helpers + "\n\ndef main(source):"
    )
    source = patch_once(
        source,
        "import urllib.request",
        "import urllib.request\nimport urllib.parse\nimport http.server\nimport threading\nimport re\nimport shutil",
    )
    source = patch_once(
        source, 'archive = source / "release.tar.gz"', 'archive = source / "old.tar.gz"'
    )
    source = patch_once(
        source, 'metadata["archiveSha256"]', 'metadata["archives"]["old"]["sha256"]'
    )
    source = patch_once(
        source,
        '    facts = {"status": "failed", "scope": "original Linux user systemd service; no model, task or terminal tool",',
        '    facts = {"status": "failed", "scope": "original registered user systemd update; local File/Setting/new PTY only; no provider/model/task/remote",',
    )
    source = patch_once(
        source,
        "LoadState,ActiveState,SubState,MainPID,ExecStart,FragmentPath",
        "LoadState,ActiveState,SubState,MainPID,ExecStart,FragmentPath,ControlGroup,Slice,MemoryMax,CPUQuotaPerSecUSec,NoNewPrivileges,CapabilityBoundingSet,AmbientCapabilities",
    )
    source = patch_once(
        source,
        '    archive = source / "old.tar.gz"',
        '    for file, expected in metadata["driverFiles"].items():\n        assert hashlib.file_digest((source / file).open("rb"), "sha256").hexdigest() == expected\n    archive = source / "old.tar.gz"',
    )
    command = '        reply = subprocess.run([str(launcher), *args, "--server-root", str(root), "--json"], env=env, cwd=root, capture_output=True, text=True, timeout=40)'
    source = patch_once(
        source,
        command,
        '        call_env = env.copy()\n        if args and args[0] == "update":\n            assert catalog_url is not None\n            call_env["ZCODE_SERVER_RELEASE_MANIFEST_URL"] = catalog_url\n'
        + command.replace("env=env", "env=call_env"),
    )
    source = patch_once(
        source,
        '        rows = [json.loads(line) for line in reply.stdout.splitlines() if line.startswith("{")]\n        value = rows[-1] if rows else None',
        "        value = registered_cli_json(reply.stdout)",
    )
    source = patch_once(
        source,
        '"ZCODE_STORAGE_DIR": str(root / ".uwork")}',
        '"ZCODE_STORAGE_DIR": str(root / ".uwork"), "ZCODE_SERVER_ROOT": str(root)}',
    )
    source = patch_once(
        source,
        "str(root), phase], env=env",
        'str(root), phase, str(status["pid"]), str(os.getuid()), metadata["archives"]["new"]["members"]["runtime/node_modules/node-pty/prebuilds/linux-arm64/pty.node"]], env=env',
    )
    source = patch_once(
        source,
        '        facts["sdk"].append(rows[-1])',
        '        facts["sdk"].append(rows[-1])\n        for terminal in rows[-1].get("terminalEvidence", []):\n            pids.add(terminal["identity"]["pid"])',
    )
    source = patch_once(
        source,
        "    try:\n        assert observe_unit()",
        main
        + "\n    try:\n        assert os.getuid() == 501\n        assert not any(os.path.lexists(path) for path in unit_links)\n        assert observe_unit()",
    )
    source = patch_once(
        source,
        '        sdk(ready, "seed")',
        '        old_phase = registered_phase(ready, "old-before-seed")\n        sdk(ready, "seed")',
    )
    source = patch_once(
        source,
        '            pids.add(terminal["identity"]["pid"])',
        '            pids.add(terminal["identity"]["pid"])\n            group = observe_unit()["ControlGroup"]\n            assert any(line.rsplit(":", 1)[-1] == group or line.rsplit(":", 1)[-1].startswith(group + "/") for line in terminal["cgroup"].splitlines())',
    )
    start = source.index('        assert cli("restart") == {"restarting": True}')
    end = source.index('        cli("stop")', start)
    source = source[:start] + step + source[end:]
    source = patch_once(
        source,
        '        facts["checks"].append("original-two-confirmation-uninstall-removes-unit-and-descriptor")',
        '        assert not any(os.path.lexists(path) for path in unit_links)\n        facts["checks"].append("original-two-confirmation-uninstall-removes-unit-and-descriptor")',
    )
    source = patch_once(
        source,
        '        cleanup["portsClosed"] = {}',
        '        try:\n            close_original_socket_watch()\n            close_catalog()\n            cleanup["catalogClosed"] = True\n        except BaseException as error:\n            cleanup["catalogClosed"] = False\n            cleanup["catalogFailure"] = str(error)\n        cleanup["unitUserLinksAbsent"] = {str(path): not os.path.lexists(path) for path in unit_links}\n        cleanup["portsClosed"] = {}',
    )
    source = patch_once(
        source,
        'if not cleanup["unitAbsent"] or',
        'if not cleanup["catalogClosed"] or not all(cleanup["unitUserLinksAbsent"].values()) or not cleanup["unitAbsent"] or',
    )
    source = patch_once(
        source,
        '        cleanup["pidsAbsent"] = {str(pid): not Path(f"/proc/{pid}").exists() for pid in pids}\n',
        "",
    )
    source = patch_once(
        source,
        '        try:\n            close_original_socket_watch()\n            close_catalog()\n            cleanup["catalogClosed"] = True',
        '        try:\n            close_original_socket_watch()\n            cleanup["watcherClosed"] = True\n        except BaseException as error:\n            cleanup["watcherClosed"] = False\n            cleanup["watcherFailure"] = str(error)\n        try:\n            close_catalog()\n            cleanup["catalogClosed"] = True',
    )
    source = patch_once(
        source,
        '        cleanup["unitUserLinksAbsent"] =',
        '        cleanup["pidsAbsent"] = {str(pid): not Path(f"/proc/{pid}").exists() for pid in pids}\n        cleanup["unitUserLinksAbsent"] =',
    )
    source = patch_once(
        source,
        'if not cleanup["catalogClosed"] or',
        'if not cleanup["watcherClosed"] or not cleanup["catalogClosed"] or',
    )
    source = patch_once(
        source,
        '        assert observe_unit()["ActiveState"] == "inactive"',
        '        stopped_unit = observe_unit()\n        assert stopped_unit["ActiveState"] == "inactive" and stopped_unit["MainPID"] == "0"',
    )
    source = patch_once(
        source,
        "        assert restarted['state'] == 'ready' and restarted['pid'] != ready['pid']",
        "        assert restarted['state'] == 'ready' and restarted['pid'] != ready['pid']\n        assert not Path(f\"/proc/{ready['pid']}\").exists()",
    )
    ast.parse(source)

    sdk = (REPO / "scripts/tests/linux-user-service-sdk.mjs").read_text()
    terminal = (
        REPO / "scripts/tests/server-local-pty-update-slice.mjs.tpl"
    ).read_text()
    terminal = terminal[
        terminal.index("function alive(pid) {") : terminal.index("\nlet workspacePath;")
    ]
    terminal = patch_once(
        terminal,
        "/^Uid:\\s+1000\\s+1000\\s+1000\\s+1000$/m",
        'new RegExp("^Uid:\\s+" + expectedUid + "\\s+" + expectedUid + "\\s+" + expectedUid + "\\s+" + expectedUid + "$", "m")',
    )
    # Python preserves JS escapes as supplied; avoid altering the Linux uid requirement.
    terminal = terminal.replace('"^Uid:\\s+"', '"^Uid:\\\\s+"').replace(
        '"\\s+"', '"\\\\s+"'
    )
    observation = """      const shellStatus = await readFile(`/proc/${shellPid}/status`, "utf8");
      row.processFields = Object.fromEntries(shellStatus.split("\\n").filter(line => /^(Uid|Gid|CapInh|CapPrm|CapEff|CapBnd|CapAmb|NoNewPrivs|Seccomp):/.test(line)).map(line => {const index=line.indexOf(":");return [line.slice(0,index),line.slice(index+1).trim()];}));
      row.cgroup = await readFile(`/proc/${shellPid}/cgroup`, "utf8");
      row.birth = (await readFile(`/proc/${shellPid}/stat`, "utf8")).split(") ").slice(1).join(") ").split(/\\s+/)[19];
"""
    terminal = patch_once(
        terminal,
        "      assert.equal(await readlink(`/proc/${shellPid}/cwd`), workspacePath);",
        observation
        + "      assert.equal(await readlink(`/proc/${shellPid}/cwd`), workspacePath);",
    )
    terminal = patch_once(
        terminal,
        "    row.sameShellIdentity = true;",
        '    row.finalBirth = (await readFile(`/proc/${shellPid}/stat`, "utf8")).split(") ").slice(1).join(") ").split(/\\s+/)[19];\n    assert.equal(row.finalBirth,row.birth);\n    row.sameShellIdentity = true;',
    )
    support = """
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {readFile, readlink} from "node:fs/promises";
import {setTimeout as delay} from "node:timers/promises";
let workspacePath;
const facts={checks:[],terminals:[]};
const pids=new Set();
const launcher="unused-in-new-release-only-phase";
const metadata={new:{nativeSha256}};
async function bounded(promise,ms,label) {let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error("Owned SDK timeout: "+label)),ms);})]);}finally{clearTimeout(timer);}}
"""
    sdk = patch_once(
        sdk,
        "const [port, root, phase] = process.argv.slice(2);",
        'const [port, root, phase, corePid, expectedUid, nativeSha256] = process.argv.slice(2);\nassert.equal(process.platform,"linux");assert.equal(process.arch,"arm64");assert.equal(process.version,"v22.16.0");assert.equal(process.getuid(),501);assert.equal(expectedUid,"501");assert.match(nativeSha256,/^[a-f0-9]{64}$/);\n'
        + support
        + terminal,
    )
    sdk = patch_once(
        sdk, '["seed", "read"].includes(phase)', '["seed", "updated"].includes(phase)'
    )
    sdk = patch_once(
        sdk,
        "  const workspace = await services.fileService.ensureConversationWorkspace();",
        '  const system = await services.systemService.info();\n  assert.deepEqual(system,{homedir:root,platform:"linux"});\n  const workspace = await services.fileService.ensureConversationWorkspace();\n  workspacePath=workspace.path;',
    )
    sdk = patch_once(
        sdk,
        "  console.log(JSON.stringify({ phase,",
        '  if(phase === "updated") await terminalSlice({pid:Number(corePid)},services,"new");\n  console.log(JSON.stringify({ terminalEvidence:facts.terminals, SDKHomedir:system.homedir, phase,',
    )
    sdk = patch_once(
        sdk,
        '["seed", "updated"].includes(phase)',
        '["seed", "updated", "watch"].includes(phase)',
    )
    sdk = patch_once(
        sdk,
        "let socket;",
        "let socket; let closeResolve; const originalClosed=new Promise(resolve=>{closeResolve=resolve;});",
    )
    sdk = patch_once(
        sdk,
        "onOpenSocket(value) { socket = value; },",
        "onOpenSocket(value) { socket = value; }, onClose(event) {closeResolve(event);},",
    )
    sdk = patch_once(
        sdk,
        "  const workspace = await services.fileService.ensureConversationWorkspace();",
        '  if(phase === "watch") { console.log(JSON.stringify({watchReady:true,SDKHomedir:system.homedir})); const close=await bounded(originalClosed,15000,"original update socket close"); console.log(JSON.stringify({watchedOriginalClose:true,close})); } else {\n  const workspace = await services.fileService.ensureConversationWorkspace();',
    )
    sdk = patch_once(
        sdk,
        "} finally {\n  clearTimeout(deadline);",
        "  }\n} finally {\n  clearTimeout(deadline);",
    )
    return source, sdk, helpers


if __name__ == "__main__":
    raise SystemExit(
        "Source builder is imported by the prepare-only entry; it never runs the VM controller."
    )
