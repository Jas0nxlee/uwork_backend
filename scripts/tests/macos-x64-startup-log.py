"""Strict subset of original private Main log, correlated to the original child event pair."""
import json
import math
from pathlib import Path
import re
import stat

PROFILE = re.compile(r'client-native-packaged-macos-x64-startup-v[0-9]+-20261020')
PREFIX = re.compile(r'^\[([0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3})\] \[info\] \[pid:([0-9]+)\] \[main\] \[single-instance-startup\] (.*)$')
PHASES = ('lock-request-start', 'lock-request-return', 'secondary-quit-start', 'secondary-quit-return')


def read_owned_single_instance_phases(repo, profile, events):
    assert PROFILE.fullmatch(profile), 'Only fresh owned startup profile'
    starts = [row for row in events if row.get('event') == 'workspace-secondary-started']
    exits = [row for row in events if row.get('event') == 'workspace-secondary-exit']
    assert len(starts) <= 1 and len(exits) <= 1
    if not starts:
        assert not exits
        return {'available': False, 'rows': [], 'reason': 'No original workspace-secondary-started receipt'}
    start = starts[0]
    primary, secondary = start['primaryPid'], start['secondaryPid']
    assert type(primary) is int and type(secondary) is int and primary > 0 and secondary > 0 and primary != secondary
    if exits:
        assert exits[0]['primaryPid'] == primary and exits[0]['secondaryPid'] == secondary
    repo = Path(repo).resolve()
    root = repo / 'data' / profile
    for path in [root, root/'data', root/'data/.uwork', root/'data/.uwork/v2']:
        info = path.lstat()
        assert stat.S_ISDIR(info.st_mode) and stat.S_IMODE(info.st_mode) == 0o700
        assert path.resolve() == path, 'Owned ancestor must not contain symlinks'
    logs = root/'data/.uwork/v2/logs'
    value = {'available': True, 'primaryPid': primary, 'secondaryPid': secondary,
             'exitObserved': bool(exits), 'rows': [], 'files': [],
             'scope': 'Fixed fields from original PID-prefixed private file only; missing stage does not prove nonexecution or ACK; original644 file is not claimed0600'}
    if not logs.exists(): return value
    assert logs.resolve() == logs and stat.S_ISDIR(logs.lstat().st_mode)
    files = sorted(logs.glob('*.log'))
    assert len(files) <= 2, 'Finite case may cross at most one local date'
    seen = set()
    for path in files:
        assert re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}\.log', path.name)
        info = path.lstat()
        assert stat.S_ISREG(info.st_mode) and path.resolve() == path and info.st_size <= 4*1024*1024
        with path.open('rb') as stream: raw = stream.read(4*1024*1024+1)
        assert len(raw) <= 4*1024*1024
        value['files'].append({'date': path.stem, 'bytes': len(raw), 'mode': format(stat.S_IMODE(info.st_mode), '04o')})
        for line in raw.decode('utf8', 'replace').splitlines():
            matched = PREFIX.fullmatch(line)
            if not matched: continue
            stamp, pid, payload = matched.groups(); pid = int(pid)
            if pid not in (primary, secondary): continue
            fields = json.loads(payload)
            assert type(fields) is dict and fields.get('event') == 'desktop_single_instance_startup'
            phase = fields.get('phase'); assert phase in PHASES
            allowed = {'event', 'phase'}
            if phase == 'lock-request-return':
                allowed.add('acquired'); assert type(fields.get('acquired')) is bool
            if phase in ('lock-request-return', 'secondary-quit-return'): allowed.add('elapsedMs')
            assert set(fields) <= allowed, 'Unapproved diagnostic field'
            row = {'pid': pid, 'role': 'primary' if pid == primary else 'secondary', 'wallTime': stamp, 'phase': phase}
            if 'acquired' in fields: row['acquired'] = fields['acquired']
            if 'elapsedMs' in fields:
                elapsed = fields['elapsedMs']
                assert type(elapsed) in (int, float) and math.isfinite(elapsed) and elapsed >= 0
                row['elapsedMs'] = elapsed
            assert (pid, phase) not in seen, 'Duplicate stage in original single-start PID'
            seen.add((pid, phase)); value['rows'].append(row)
    assert len(value['rows']) <= 8
    return value
