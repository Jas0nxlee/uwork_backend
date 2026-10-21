"""Own one regular tmpfs file lease; JSON stdin unlock, no filesystem/runtime replacement."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import select
import signal
import stat
import sys
import time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--case', choices=['deny', 'allow'], required=True)
args = parser.parse_args()
case = args.case
path = Path('/work/project/.pending-read') / (case + '.txt')
state_path = Path('/work') / ('pending-read-lease-' + case + '.json')
marker = ('OWNED_PENDING_READ_' + case.upper() + '_FILE_BYTES_20261020\n').encode()
state = {'case': case, 'pid': os.getpid(), 'uid': os.getuid(), 'gid': os.getgid(),
         'path': str(path), 'markerSha256': hashlib.sha256(marker).hexdigest(),
         'sigioTimesMs': [], 'acquired': False, 'released': False, 'closed': False}
descriptor = None
started = time.monotonic()
notices = []
stopping = False


def save():
    temporary = state_path.with_suffix('.tmp')
    temporary.write_text(json.dumps(state, indent=2) + '\n')
    temporary.chmod(0o600)
    temporary.replace(state_path)


def release(reason):
    if state['acquired'] and not state['released']:
        fcntl.fcntl(descriptor, fcntl.F_SETLEASE, fcntl.F_UNLCK)
        state.update(released=True, releaseReason=reason, releasedAtMs=int(time.time() * 1000))
        save()


def stop(_signal, _frame):
    global stopping
    stopping = True


try:
    assert os.getuid() == os.getgid() == 1000
    cap = next(line.split()[1] for line in Path('/proc/self/status').read_text().splitlines() if line.startswith('CapEff:'))
    assert int(cap, 16) == 0
    state['capEff'] = cap
    state['leaseBreakSeconds'] = int(Path('/proc/sys/fs/lease-break-time').read_text())
    assert state['leaseBreakSeconds'] >= 15
    path.parent.mkdir(mode=0o700, exist_ok=True)
    descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_RDWR, 0o600)
    os.write(descriptor, marker)
    os.fsync(descriptor)
    info = os.fstat(descriptor)
    assert stat.S_ISREG(info.st_mode) and info.st_uid == info.st_gid == 1000
    state.update(inode=info.st_ino, device=info.st_dev, mode=oct(stat.S_IMODE(info.st_mode)), size=info.st_size, regularFile=True)
    signal.signal(signal.SIGIO, lambda _signal, _frame: notices.append(int(time.time() * 1000)))
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    fcntl.fcntl(descriptor, fcntl.F_SETOWN, os.getpid())
    fcntl.fcntl(descriptor, fcntl.F_SETLEASE, fcntl.F_WRLCK)
    assert fcntl.fcntl(descriptor, fcntl.F_GETLEASE) == fcntl.F_WRLCK
    state.update(acquired=True, acquiredAtMs=int(time.time() * 1000))
    save()
    while not stopping and time.monotonic() - started < 90:
        if len(notices) != len(state['sigioTimesMs']):
            state['sigioTimesMs'] = list(notices)
            save()
        if notices and not state['released'] and int(time.time() * 1000) - notices[0] > min(25000, (state['leaseBreakSeconds'] - 2) * 1000):
            state['safetyTimeout'] = True
            release('owned-safety-timeout')
            break
        ready, _, _ = select.select([sys.stdin], [], [], .02)
        if not ready:
            continue
        line = sys.stdin.readline()
        if not line:
            break
        command = json.loads(line)
        assert isinstance(command, dict) and set(command) == {'op'}
        if command['op'] == 'unlock':
            release('explicit-owned-command')
        elif command['op'] == 'shutdown':
            break
        else:
            raise ValueError('Unknown owned lease command')
except BaseException as error:
    state['failure'] = {'kind': type(error).__name__, 'errno': getattr(error, 'errno', None)}
finally:
    if descriptor is not None:
        try:
            release('owned-helper-finally')
        finally:
            os.close(descriptor)
    state['closed'] = True
    state['closedAtMs'] = int(time.time() * 1000)
    save()
    print(json.dumps(state))
sys.exit(0 if not state.get('failure') and not state.get('safetyTimeout') else 1)
