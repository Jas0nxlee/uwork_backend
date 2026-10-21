"""Passive owned X Error dialog observation; never a product success or recovery path."""
import hashlib
import json
import re
import time


def read_main_binding(docker, container, main_pid, packaged_root):
    assert re.fullmatch(r'uwork-client-linux-desktop-pty-wire-appimage-v[1-9][0-9]*-20261020', container)
    assert isinstance(main_pid, int) and main_pid > 0
    assert packaged_root.startswith('/work/appimage-runtime/') and '/..' not in packaged_root
    exe = docker('exec', container, 'readlink', f'/proc/{main_pid}/exe', timeout=3).stdout.strip()
    assert exe == packaged_root + '/zcode-preview'
    raw = docker('exec', container, 'cat', f'/proc/{main_pid}/stat', timeout=3).stdout
    start = raw.rsplit(')', 1)[1].split()[19]
    assert start.isdigit()
    return {'pid': main_pid, 'exe': exe, 'startTime': start}


def observe_failure(action, observer):
    try:
        return action()
    except BaseException:
        # 只旁路观察，不允许诊断超时、保存或清理错误替换原异常对象。
        try: observer()
        except BaseException: pass
        raise


def capture_owned_error(docker, container, binding, work, evidence):
    started = time.monotonic()
    facts = {'status': 'diagnostic-failed', 'mainBinding': binding, 'buttonActions': [],
             'scope': 'Only passive owned XID properties/tree and its geometry screenshot; no CDP substitute or dialog dismissal'}

    def bounded_docker(*args, **_kwargs):
        remaining = 12 - (time.monotonic() - started)
        assert remaining > 0, 'Owned passive diagnostic budget exceeded'
        return docker(*args, timeout=min(3, remaining))

    def command(*args):
        value = bounded_docker('exec', container, *args)
        assert value.returncode == 0
        assert len(value.stdout) <= 32768
        return value.stdout

    def main_guard():
        actual = read_main_binding(bounded_docker, container, binding['pid'], binding['exe'].rsplit('/', 1)[0])
        assert actual == binding, 'Original Main generation changed'

    def properties(window):
        assert window.isdigit()
        raw = command('xprop', '-id', window, '_NET_WM_PID', '_NET_WM_WINDOW_TYPE', '_NET_WM_STATE')
        pid = re.search(r'^_NET_WM_PID\(CARDINAL\) = ([0-9]+)$', raw, re.M)
        return {'pid': int(pid.group(1)) if pid else None, 'properties': raw,
                'title': command('xdotool', 'getwindowname', window).strip()}

    def owned_modal(value):
        atoms = {item.strip() for line in value['properties'].splitlines() if '(ATOM) = ' in line
                 for item in line.split('(ATOM) = ', 1)[1].split(',')}
        return (value['pid'] == binding['pid'] and value['title'] == 'Error'
                and '_NET_WM_WINDOW_TYPE_DIALOG' in atoms and '_NET_WM_STATE_MODAL' in atoms)

    def geometry(window):
        raw = command('xdotool', 'getwindowgeometry', '--shell', window)
        value = {k: int(v) for line in raw.splitlines() if '=' in line
                 for k, v in [line.split('=', 1)] if k in ['X', 'Y', 'WIDTH', 'HEIGHT']}
        assert set(value) == {'X', 'Y', 'WIDTH', 'HEIGHT'}
        width, height = map(int, command('xdotool', 'getdisplaygeometry').split())
        assert 0 <= value['X'] and 0 <= value['Y'] and value['WIDTH'] > 0 and value['HEIGHT'] > 0
        assert value['X'] + value['WIDTH'] <= width and value['Y'] + value['HEIGHT'] <= height
        return value

    try:
        main_guard()
        windows = command('xdotool', 'search', '--onlyvisible', '--name', '.').split()
        assert len(windows) <= 8 and len(windows) == len(set(windows))
        candidates = []
        facts['visibleWindows'] = []
        for window in windows:
            value = properties(window)
            facts['visibleWindows'].append({'xid': window, **value})
            if owned_modal(value): candidates.append(window)
        facts['ownedModalCandidates'] = candidates
        if len(candidates) != 1:
            facts['status'] = 'no-unique-owned-error-dialog'
            return facts
        window = candidates[0]
        main_guard()
        before = properties(window)
        assert owned_modal(before)
        shape = geometry(window)
        facts.update(xid=window, before=before, geometry=shape,
                     nativeXTree=command('xwininfo', '-id', window, '-tree')[:8000])
        help_text = command('scrot', '--help')
        assert '--autoselect' in help_text and '-a' in help_text, 'Actual scrot autoselect option required'
        main_guard()
        assert properties(window) == before and geometry(window) == shape
        filename = 'native-error-' + window + '.png'
        rectangle = ','.join(str(shape[key]) for key in ['X', 'Y', 'WIDTH', 'HEIGHT'])
        command('scrot', '-a', rectangle, '-o', '/work/' + filename)
        main_guard()
        assert properties(window) == before and geometry(window) == shape
        raw = (work / filename).read_bytes()
        assert raw.startswith(b'\x89PNG\r\n\x1a\n') and len(raw) <= 16 * 1024 * 1024
        target = evidence / filename
        with target.open('xb') as output: output.write(raw)
        target.chmod(0o600)
        facts.update(status='captured-owned-native-error', screenshot=filename,
                     screenshotSha256=hashlib.sha256(raw).hexdigest(),
                     beforeAfterBindingAndGeometryEqual=True)
        return facts
    except BaseException as error:
        facts['failure'] = {'type': type(error).__name__}
        return facts
    finally:
        facts['seconds'] = round(time.monotonic() - started, 3)
        # 保存失败也必须留在旁路，由 observe_failure 保留原业务异常。
        path = evidence / 'owned-native-error-diagnostic.json'
        with path.open('x') as output: json.dump(facts, output, indent=2); output.write('\n')
        path.chmod(0o600)
