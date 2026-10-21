"""Eight independent fresh profiles, no UI actions/models; retain each exact probe result."""
import json
from pathlib import Path
import subprocess
import sys
import time

REPO = Path(__file__).resolve().parents[3]
evidence = REPO / 'evidence/client-linux-startup-stress-20261020'
evidence.mkdir(mode=0o700)
results = []
for installed in [False, True]:
    label = 'installed' if installed else 'unpacked'
    for index in range(1, 5):
        name = f'client-linux-desktop-startup-{label}-{index}-20261020'
        args = [sys.executable, str(Path(__file__).with_name('probe.py')), '--name', name, '--startup-only']
        if installed:
            args.append('--installed')
        started = time.monotonic()
        with (evidence / (name + '.log')).open('w') as log:
            completed = subprocess.run(args, cwd=REPO, stdout=log, stderr=subprocess.STDOUT)
        path = REPO / 'evidence' / name / 'result.json'
        result = json.loads(path.read_text()) if path.exists() else {}
        row = {'profile': name, 'installed': installed, 'exitCode': completed.returncode,
               'status': result.get('status', 'missing'), 'seconds': round(time.monotonic() - started, 3),
               'firstRunReadySeconds': result.get('firstRunReadySeconds'),
               'cleanupExitCode': result.get('containerExitCode'),
               'finalProofMatches': result.get('finalProofMatches')}
        results.append(row)
        (evidence / 'progress.json').write_text(json.dumps(results, indent=2) + '\n')
        print(json.dumps(row), flush=True)
        if completed.returncode != 0 or row['status'] != 'passed':
            raise SystemExit(1)
assert len(results) == 8
(evidence / 'result.json').write_text(json.dumps({'status': 'passed', 'runs': results}, indent=2) + '\n')
