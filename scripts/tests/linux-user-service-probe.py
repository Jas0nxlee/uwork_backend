"""Run inside the dedicated project VM, using an original staged Linux archive."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import select
import socket
import subprocess
import tempfile
import time
import urllib.request


def path_id(value):
    result = 2166136261
    for char in value:
        result = ((result ^ ord(char)) * 16777619) & 0xffffffff
    return f"{result:08x}"


def main(source):
    source = source.resolve()
    metadata = json.loads((source / "metadata.json").read_text())
    archive = source / "release.tar.gz"
    assert hashlib.file_digest(archive.open("rb"), "sha256").hexdigest() == metadata["archiveSha256"]
    assert subprocess.check_output(["cat", "/proc/1/comm"], text=True).strip() == "systemd"
    assert subprocess.check_output(["systemctl", "--user", "is-system-running"], text=True).strip() == "running"
    scratch = Path(tempfile.mkdtemp(prefix="uwsysd-", dir="/tmp"))
    root, bootstrap = scratch / "server", scratch / "bootstrap"
    root.mkdir(mode=0o700)
    bootstrap.mkdir(mode=0o700)
    subprocess.run(["tar", "-xzf", str(archive), "-C", str(bootstrap), "--strip-components=1", "--no-same-owner"], check=True)
    node, launcher = bootstrap / "runtime/node", bootstrap / "bin/zcode"
    label = "com.zhipu.zcode.server." + path_id(str(root))
    unit = label + ".service"
    descriptor = root / "service" / unit
    env = {key: value for key, value in os.environ.items() if not key.startswith(("ZCODE_", "UWORK_", "NODE_OPTIONS"))}
    env.update(PATH=str(node.parent) + ":/usr/bin:/bin", NODE_ENV="production", LC_ALL="C")
    facts = {"status": "failed", "scope": "original Linux user systemd service; no model, task or terminal tool", "root": str(root), "label": label,
             "archive": metadata, "commands": [], "checks": [], "sdk": []}
    pids, ports = set(), set()
    owned = False
    registration_attempted = False

    def systemctl(*args):
        return subprocess.run(["systemctl", "--user", *args], capture_output=True, text=True, timeout=15)

    def observe_unit():
        reply = systemctl("show", unit, "--property=LoadState,ActiveState,SubState,MainPID,ExecStart,FragmentPath")
        values = dict(line.split("=", 1) for line in reply.stdout.splitlines() if "=" in line)
        facts.setdefault("unitObservations", []).append(values)
        return values

    def owned_descriptor():
        content = descriptor.read_text()
        assert str(root / "bin/zcode") in content and "--service-entry" in content
        assert "'--server-root' '" + str(root) + "'" in content
        state = observe_unit()
        # systemd reports its normal user-unit symlink, not the source unit path.
        assert Path(state["FragmentPath"]).resolve(strict=True) == descriptor.resolve(strict=True)
        assert str(root / "bin/zcode") in state["ExecStart"] and str(root) in state["ExecStart"]
        if int(state.get("MainPID", "0")):
            pids.add(int(state["MainPID"]))
        return state

    def cli(*args, expected=0):
        reply = subprocess.run([str(launcher), *args, "--server-root", str(root), "--json"], env=env, cwd=root, capture_output=True, text=True, timeout=40)
        rows = [json.loads(line) for line in reply.stdout.splitlines() if line.startswith("{")]
        value = rows[-1] if rows else None
        facts["commands"].append({"args": args, "exitCode": reply.returncode, "result": value, "stderr": reply.stderr[-1200:]})
        assert reply.returncode == expected and isinstance(value, dict)
        if value.get("pid"):
            pids.add(value["pid"])
        if value.get("port"):
            ports.add(value["port"])
        return value

    def sdk(status, phase):
        # Guard the actual exec environment before any public SDK mutation.
        raw = Path(f"/proc/{status['pid']}/environ").read_bytes().split(b"\0")
        current = dict(item.decode().split("=", 1) for item in raw if b"=" in item)
        expected = {"HOME": str(root), "USERPROFILE": str(root), "ZCODE_DESKTOP_HOME_DIR": str(root),
                    "UWORK_DATA_BASE_DIR": str(root), "ZCODE_DATA_BASE_DIR": str(root), "ZCODE_STORAGE_DIR": str(root / ".uwork")}
        assert all(current.get(key) == value for key, value in expected.items()), "Core profile guard failed before SDK mutation"
        facts.setdefault("coreProfileEnvironments", []).append({"pid": status["pid"], "fields": {key: current.get(key) for key in expected}})
        with urllib.request.urlopen(f"http://127.0.0.1:{status['port']}/api/server-info", timeout=5) as response:
            info = json.load(response)
        assert info["capabilities"]["websocketRpc"] and info["authRequired"] is False
        reply = subprocess.run([str(node), str(source / "sdk.mjs"), str(status["port"]), str(root), phase], env=env, capture_output=True, text=True, timeout=30)
        assert reply.returncode == 0, reply.stderr[-1500:]
        rows = [json.loads(line) for line in reply.stdout.splitlines() if line.startswith("{")]
        facts["sdk"].append(rows[-1])
        settings = json.loads((root / ".uwork/v2/setting.json").read_text())
        assert settings["locale"] == "en-US" and settings["terminalInheritSystemProfile"] is False

    try:
        assert observe_unit().get("LoadState") == "not-found", "New unit must be absent before registration"
        facts["checks"].append("unique-systemd-unit-absent-before")
        registration_attempted = True
        ready = cli("serve", "--daemon")
        owned_descriptor()
        owned = True
        assert ready["state"] == "ready" and ready["serviceRegistered"]
        facts["checks"].append("original-user-systemd-registered-ready")
        again = cli("serve", "--daemon")
        assert again["pid"] == ready["pid"] and again["generation"] == ready["generation"]
        facts["checks"].append("repeated-daemon-idempotent")
        sdk(ready, "seed")
        facts["checks"].append("guarded-original-sdk-private-file-setting-write")
        assert cli("restart") == {"restarting": True}
        deadline = time.monotonic() + 25
        while time.monotonic() < deadline:
            restarted = cli("status")
            if restarted["state"] == "ready" and restarted["pid"] != ready["pid"]:
                break
            time.sleep(.2)
        assert restarted["state"] == "ready" and restarted["pid"] != ready["pid"]
        sdk(restarted, "read")
        facts["checks"].append("original-restart-new-core-same-file-settings")
        cli("stop")
        time.sleep(12)
        stopped = cli("status")
        assert stopped["state"] == "stopped" and stopped["pid"] is None
        assert observe_unit()["ActiveState"] == "inactive"
        facts["checks"].append("original-stop-no-systemd-restart-for-twelve-seconds")
        child = subprocess.Popen([str(launcher), "uninstall", "--server-root", str(root), "--json"], env=env, cwd=root, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        pids.add(child.pid)
        output, confirmations = b"", 0
        try:
            deadline = time.monotonic() + 25
            while child.poll() is None and time.monotonic() < deadline:
                if select.select([child.stdout], [], [], .1)[0]:
                    output += os.read(child.stdout.fileno(), 4096)
                    prompts = output.count(b"Type DELETE")
                    if prompts > confirmations:
                        assert prompts == confirmations + 1 and prompts <= 2
                        child.stdin.write(b"DELETE\n")
                        child.stdin.flush()
                        confirmations += 1
        finally:
            if child.poll() is None:
                child.kill()
            rest, error = child.communicate(timeout=5)
            output += rest
            facts["uninstall"] = {"exitCode": child.returncode, "confirmations": confirmations, "stderr": error.decode()[-1200:]}
        assert child.returncode == 0 and confirmations == 2 and b'"uninstalled":true' in output
        assert not descriptor.exists() and observe_unit()["LoadState"] == "not-found"
        assert systemctl("is-enabled", unit).returncode != 0
        facts["checks"].append("original-two-confirmation-uninstall-removes-unit-and-descriptor")
        facts["status"] = "passed"
    except BaseException as error:
        facts["failure"] = f"{type(error).__name__}: {error}"
    finally:
        cleanup = {}
        try:
            state = observe_unit()
            if state.get("LoadState") != "not-found" and registration_attempted:
                # A descriptor and loaded ExecStart must both identify our fresh root.
                owned_descriptor()
                owned = True
                try:
                    cli("stop")
                except (AssertionError, subprocess.TimeoutExpired) as error:
                    cleanup["stopFailure"] = str(error)
                cleanup["disableExitCode"] = systemctl("disable", "--now", str(descriptor)).returncode
                systemctl("daemon-reload")
            elif state.get("LoadState") != "not-found":
                cleanup["preexistingUnitUntouched"] = True
            cleanup["unitAbsent"] = observe_unit().get("LoadState") == "not-found"
        except BaseException as error:
            cleanup["guardedCleanupFailure"] = f"{type(error).__name__}: {error}"
            cleanup["unitAbsent"] = False
        cleanup["pidsAbsent"] = {str(pid): not Path(f"/proc/{pid}").exists() for pid in pids}
        cleanup["portsClosed"] = {}
        for port in ports:
            with socket.socket() as connection:
                connection.settimeout(.5)
                cleanup["portsClosed"][str(port)] = connection.connect_ex(("127.0.0.1", port)) != 0
        cleanup["controlSocketAbsent"] = not (root / "run/control.sock").exists()
        cleanup["originalUserDataPreserved"] = (root / ".uwork").exists()
        cleanup["ownedRegistrationObserved"] = owned
        facts["cleanup"] = cleanup
        if not cleanup["unitAbsent"] or not all(cleanup["pidsAbsent"].values()) or not all(cleanup["portsClosed"].values()) or not cleanup["controlSocketAbsent"] or not cleanup["originalUserDataPreserved"]:
            facts["status"] = "failed"
        (source.parent / "result.json").write_text(json.dumps(facts, indent=2) + "\n")
    print(json.dumps({"status": facts["status"], "checks": len(facts["checks"]), "root": str(root), "failure": facts.get("failure")}))
    return facts["status"] == "passed"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    raise SystemExit(0 if main(parser.parse_args().input) else 1)
