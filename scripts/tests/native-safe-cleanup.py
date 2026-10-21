"""Only the original owned Native fixture cleanup. Pure import; never starts App or backend."""

import ast, json, socket, subprocess, sys
from urllib.parse import urlparse


def derive_safe_native_cleanup(source, budget_name):
    assert isinstance(budget_name, str) and budget_name.isidentifier()
    tree = ast.parse(source)
    run = next(
        n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "run"
    )
    tries = [n for n in run.body if isinstance(n, ast.Try) and n.finalbody]
    assert len(tries) == 1
    final = tries[0].finalbody
    text = "\n".join(source.splitlines()[final[0].lineno - 1 : final[-1].end_lineno])
    for marker in [
        "f.command('stopNative', 25)",
        "known-process-still-alive",
        "portsClosed",
        "result.json",
    ]:
        assert marker in text, marker
    lines = source.splitlines(keepends=True)
    lines[final[0].lineno - 1 : final[-1].end_lineno] = [
        "        safe_native_cleanup(f=f,bridge=bridge,guard=guard,old=OLD,meta=meta,known=known,errors=errors,observations=observations,facts=facts,evidence=evidence,budget="
        + budget_name
        + ")\n"
    ]
    result = "".join(lines)
    compile(result, "actual-safe-native-cleanup", "exec")
    return result


def safe_native_cleanup(
    *, f, bridge, guard, old, meta, known, errors, observations, facts, evidence, budget
):
    """Every step is isolated; exhausted budget is failure, never proof of resource closure."""
    absent = None
    closed = {}
    steps = []

    def step(label, operation, bounded=True):
        try:
            value = budget.call(operation) if bounded else operation()
            steps.append({"step": label, "status": "returned"})
            return True, value
        except BaseException as error:
            errors.append(label + ": " + type(error).__name__)
            steps.append(
                {"step": label, "status": "failed", "errorType": type(error).__name__}
            )
            return False, None

    def eof(handle, label):
        # Only an original retained Popen stdin. EOF is an attempt, never a restoration ACK.
        try:
            stream = getattr(handle, "stdin", None)
            if stream is None:
                raise AssertionError("original stdin unavailable")
            stream.close()
            observations.setdefault("cleanupEofFallbacks", []).append(
                {"owner": label, "attempted": True, "verified": False}
            )
        except BaseException as error:
            errors.append(label + "-eof: " + type(error).__name__)
            observations.setdefault("cleanupEofFallbacks", []).append(
                {
                    "owner": label,
                    "attempted": True,
                    "verified": False,
                    "errorType": type(error).__name__,
                }
            )

    try:
        step("cleanup-phase", budget.begin_cleanup, bounded=False)
        if guard:
            observations["osRestoreAttempt"] = {
                "normalInterfaceAttempted": True,
                "verified": False,
            }
            ok, value = step("OS-guard", guard.close)
            if ok:
                observations["osRestore"] = value
                valid = (
                    isinstance(value, dict)
                    and value.get("protocolRestored") is True
                    and value.get("usesSystemClipboard") is False
                )
                observations["osRestoreAttempt"]["verified"] = valid
                if not valid:
                    errors.append("OS-protocol-not-restored")
            else:
                valid = False
            if not valid:
                eof(getattr(guard, "child", None), "original-swift-os-guard")
        if f:

            def census():
                with f.lock:
                    mains = {
                        row["pid"] for row in f.events if row.get("event") == "launched"
                    }
                    known.update(
                        row["secondaryPid"]
                        for row in f.events
                        if row.get("event") == "workspace-secondary-started"
                    )
                rows = []
                for pid in mains:
                    rows.extend(
                        old["owned_processes"](
                            pid,
                            meta.get("packagedRuntime", {}).get("appPath", "")
                            + "/Contents/Resources/glm/zcode.cjs",
                        )
                    )
                known.update(row["pid"] for row in rows)
                observations["shutdownOwnedProcesses"] = rows

            step("owned-process-census", census)
            step("stopNative", lambda: f.command("stopNative", 25))
        if bridge:

            def close_bridge():
                bridge.kill()
                value = json.loads((evidence / "harness-cleanup.json").read_text())
                observations["harnessCleanup"] = value
                assert (
                    value.get("daemonAbsent") is True
                    and value.get("socketClosed") is True
                )

            step("harness", close_bridge)
        if f:
            ok, status = step("fixture-poll", f.child.poll, bounded=False)
            if ok and status is None:
                step("fixture-terminate", f.child.terminate, bounded=False)
                step("fixture-wait", lambda: f.child.wait(timeout=30))
            # Original control-stream EOF lets its original shutdown handler run; no new business command.
            ok, status = step("fixture-final-poll", f.child.poll, bounded=False)
            if not ok or status is None:
                eof(f.child, "original-fixture")
            facts["fixtureExitCode"] = status if ok else None
            if not ok or status != 0:
                errors.append("fixture-exit-not-zero-or-unverified")

        def remaining():
            if not known:
                return True
            result = subprocess.run(
                ["ps", "-p", ",".join(map(str, sorted(known))), "-o", "pid="],
                capture_output=True,
                text=True,
                timeout=min(0.75, budget.left()),
            )
            assert result.returncode in (0, 1)
            return not result.stdout.strip()

        ok, value = step("known-process-census", remaining)
        if ok:
            absent = value
            if not value:
                errors.append("known-process-still-alive")
        ports = {
            meta.get("cdpPort"),
            *[
                urlparse(meta.get(k, "")).port
                for k in ["origin", "backendOrigin", "supplierOrigin"]
            ],
        } - {None}
        for port in sorted(ports):

            def probe():
                with socket.socket() as connection:
                    connection.settimeout(min(0.5, budget.left()))
                    return connection.connect_ex(("127.0.0.1", port)) != 0

            ok, value = step("owned-port-" + str(port), probe)
            closed[str(port)] = value if ok else None
            if ok and not value:
                errors.append("owned-port-still-open")
    except BaseException as error:
        errors.append("cleanup-coordinator: " + type(error).__name__)
    finally:
        try:
            facts["caseElapsedSeconds"] = budget.now() - (budget.case_end - 180)
            facts["elapsedSeconds"] = facts["caseElapsedSeconds"]
            if budget.now() > budget.case_end:
                errors.append("native-case-deadline-exceeded")
        except BaseException as error:
            errors.append("cleanup-clock: " + type(error).__name__)
        facts["observations"] = observations
        facts["cleanup"] = {
            "errors": errors,
            "knownPids": sorted(known),
            "knownPidsAbsent": absent,
            "portsClosed": closed,
            "steps": steps,
        }
        if errors:
            facts["businessPassed"] = facts.get("status") == "passed"
            facts["status"] = "failed"
        try:
            (evidence / "result.json").write_text(
                json.dumps(facts, ensure_ascii=False, indent=2) + "\n"
            )
        except BaseException as error:
            facts["status"] = "failed"
            facts["resultPersistenceFailureType"] = type(error).__name__
            try:
                sys.stderr.write(
                    "native-cleanup-result-persistence-failed: "
                    + type(error).__name__
                    + "\n"
                )
            except BaseException:
                pass
    return facts
