"""Owned Linux regular-file lease probe; no app, GUI, network or credential access."""
import fcntl
import json
import os
from pathlib import Path
import signal
import stat
import subprocess
import sys
import time

facts = {"status": "failed", "uid": os.getuid(), "gid": os.getgid()}
path = Path("/work/lease-probe.txt")
marker = b"OWNED_NATIVE_READ_LEASE_SENTINEL\n"
reader = None
descriptor = None
try:
    assert os.getuid() == os.getgid() == 1000
    path.write_bytes(marker)
    assert stat.S_ISREG(path.stat().st_mode)
    facts["regularFileBeforeLease"] = True
    facts["leaseBreakSeconds"] = int(Path("/proc/sys/fs/lease-break-time").read_text())
    facts["capEff"] = next(line.split()[1] for line in Path("/proc/self/status").read_text().splitlines() if line.startswith("CapEff:"))
    assert int(facts["capEff"], 16) == 0
    notices = []
    signal.signal(signal.SIGIO, lambda _number, _frame: notices.append(time.monotonic()))
    descriptor = os.open(path, os.O_RDWR)
    fcntl.fcntl(descriptor, fcntl.F_SETOWN, os.getpid())
    fcntl.fcntl(descriptor, fcntl.F_SETLEASE, fcntl.F_WRLCK)
    assert fcntl.fcntl(descriptor, fcntl.F_GETLEASE) == fcntl.F_WRLCK
    facts["writeLeaseAcquired"] = True
    facts["readerRuntime"] = subprocess.check_output(["node", "--version"], text=True).strip()
    reader = subprocess.Popen(["node", "--input-type=module", "-e", "import {readFile} from 'node:fs/promises'; process.stdout.write(await readFile(process.argv[1]));", str(path)], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    deadline = time.monotonic() + 4
    while not notices and time.monotonic() < deadline:
        assert reader.poll() is None, "Reader must remain blocked before lease release"
        time.sleep(.01)
    assert notices, "Conflicting open must deliver SIGIO to the lease holder"
    facts["sigioObserved"] = True
    time.sleep(.2)
    assert reader.poll() is None
    assert stat.S_ISREG(path.stat().st_mode)
    facts["realReaderBlockedAndStillRegular"] = True
    facts["blockedReaderWchans"] = [thread.joinpath("wchan").read_text().strip() for thread in Path(f"/proc/{reader.pid}/task").iterdir()]
    assert "__break_lease" in facts["blockedReaderWchans"]
    fcntl.fcntl(descriptor, fcntl.F_SETLEASE, fcntl.F_UNLCK)
    facts["leaseReleased"] = True
    content, errors = reader.communicate(timeout=3)
    assert reader.returncode == 0 and not errors and content == marker
    facts["readerResumedWithExactBytes"] = True
    facts["readerExitCode"] = reader.returncode
    facts["status"] = "passed"
except BaseException as error:
    facts["failure"] = {"kind": type(error).__name__, "errno": getattr(error, "errno", None)}
finally:
    if descriptor is not None:
        try:
            if facts.get("writeLeaseAcquired") and not facts.get("leaseReleased"):
                try:
                    fcntl.fcntl(descriptor, fcntl.F_SETLEASE, fcntl.F_UNLCK)
                except OSError as error:
                    facts["cleanupLeaseErrno"] = error.errno
        finally:
            os.close(descriptor)
    if reader is not None and reader.poll() is None:
        reader.kill()
        reader.communicate(timeout=3)
    facts["ownReaderAbsent"] = reader is None or reader.poll() is not None
    path.unlink(missing_ok=True)
print(json.dumps(facts))
sys.exit(0 if facts["status"] == "passed" else 1)
