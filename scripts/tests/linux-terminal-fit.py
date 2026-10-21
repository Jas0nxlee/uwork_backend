"""Observe actual original UI fit via an owned X window and same-shell stty; no RPC substitute."""
import json
import time


def resized_geometry(geometry):
    width, height = geometry['WIDTH'], geometry['HEIGHT']
    assert width > 0 and height > 0
    return {'WIDTH': width - 180 if width >= 1100 else width + 180,
            'HEIGHT': max(650, height - 80) if height > 650 else height + 80}


def parse_shell_proof(text):
    lines = text.strip().splitlines()
    assert len(lines) == 4
    rows, cols = map(int, lines[0].split())
    assert rows > 0 and cols > 0 and lines[1] == '/work/project'
    assert lines[2].startswith('/dev/pts/') and lines[2][len('/dev/pts/'):].isdigit()
    pid = int(lines[3])
    assert pid > 0
    return {'rows': rows, 'cols': cols, 'cwd': lines[1], 'tty': lines[2], 'shellPid': pid}


def layout_projection_expression(target):
    assert target in ['collapse', 'focus', 'collapsed']
    return '''(()=>{const mode=%s,buttons=[...document.querySelectorAll('[data-testid="side-pane-toggle"]')].filter(e=>{const r=e.getBoundingClientRect();return!!r.width&&!!r.height&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}),b=buttons[0],label=b?.getAttribute('aria-label'),p=document.querySelector('[data-testid="preview-pane"]'),previewWidth=p?.getBoundingClientRect().width??0,frames=[...document.querySelectorAll('[data-workspace-side-frame]')],frame=frames.length===1?frames[0]:null,frameHidden=frame?.getAttribute('aria-hidden')??null,previewHidden=frameHidden==='true',expanded=['展开侧边面板','Expand side pane'].includes(label),collapse=['收起侧边面板','Collapse side pane'].includes(label);if(mode==='collapsed')return{ok:buttons.length===1&&expanded&&previewHidden,label,previewWidth,frameHidden,frameCount:frames.length};const e=mode==='collapse'?b:document.querySelector('[data-testid="terminal"] .xterm-screen'),r=e?.getBoundingClientRect(),x=r?r.x+r.width/2:0,y=r?r.y+r.height/2:0;return{ok:buttons.length===1&&(mode==='collapse'?collapse&&frameHidden==='false'&&previewWidth>1:expanded&&previewHidden)&&!!r?.width&&!!r?.height&&e.contains(document.elementFromPoint(x,y))&&!e.disabled,x,y,label,previewWidth,frameHidden,frameCount:frames.length}})()''' % json.dumps(target)


def run_terminal_fit(docker, container, raw_cdp, main_pid, packaged_root, evidence):
    assert container.startswith('uwork-client-linux-desktop-')
    assert isinstance(main_pid, int) and main_pid > 0
    assert packaged_root.startswith('/work/appimage-runtime/') and '/..' not in packaged_root
    facts = {'status': 'failed', 'mainPid': main_pid, 'actions': [],
             'method': 'Original xterm UI input, exact owned X window geometry, actual same-shell stty; no product state/RPC injection'}
    identity = None
    original_geometry = None
    window = None
    resized = False
    shell_samples = {'before': 0, 'after': 0, 'restored': 0}
    started = time.monotonic()

    def budget():
        assert time.monotonic() - started < 35, 'Owned terminal fit budget exceeded'

    def guard():
        nonlocal identity
        budget()
        actual = docker('exec', container, 'readlink', f'/proc/{main_pid}/exe').stdout.strip()
        assert actual == packaged_root + '/zcode-preview'
        value = docker('exec', container, 'cat', f'/proc/{main_pid}/stat').stdout
        start_time = value.rsplit(')', 1)[1].split()[19]
        if identity is None: identity = start_time
        assert identity == start_time, 'Original Main generation changed'

    def viewport():
        guard()
        result = raw_cdp('Runtime.evaluate', returnByValue=True, expression='''(()=>{const screens=[...document.querySelectorAll('[data-testid="terminal"] .xterm-screen')].filter(e=>e.getClientRects().length),e=screens[0],r=e?.getBoundingClientRect(),p=e?.closest('.xterm'),c=e?.closest('[data-testid="terminal"]'),s=p?getComputedStyle(p):null;return{ok:screens.length===1&&!!r?.width&&!!r?.height&&!!p?.contains(document.activeElement)&&document.activeElement?.matches('textarea.xterm-helper-textarea'),width:r?.width??0,height:r?.height??0,clientWidth:e?.clientWidth??0,clientHeight:e?.clientHeight??0,containerWidth:c?.clientWidth??0,containerHeight:c?.clientHeight??0,fontFamily:s?.fontFamily??'',fontSize:s?.fontSize??'',fontReady:document.fonts.status==='loaded',devicePixelRatio:window.devicePixelRatio,innerWidth:window.innerWidth,innerHeight:window.innerHeight,visualViewportScale:window.visualViewport?.scale??1,activeAnimations:document.getAnimations().filter(a=>a.playState==='running'&&a.effect?.target instanceof Element&&(a.effect.target===e||a.effect.target.contains(e))).length}})()''')
        value = result.get('result', {}).get('value')
        assert isinstance(value, dict) and value['ok'], 'Original owned xterm must remain focused and visible'
        return value

    def shell(label):
        assert label in ['before', 'after', 'restored']
        viewport()
        ordinal = shell_samples[label]
        assert ordinal < 8, 'Owned shell sample limit exceeded'
        shell_samples[label] += 1
        path = '/work/project/terminal-fit-' + label + '-' + str(ordinal) + '.txt'
        command = "stty size > " + path + "; pwd >> " + path + "; tty >> " + path + "; printf '%s\\n' \"$$\" >> " + path
        raw_cdp('Input.insertText', text=command)
        raw_cdp('Input.dispatchKeyEvent', type='keyDown', key='Enter', code='Enter', windowsVirtualKeyCode=13, text='\r')
        raw_cdp('Input.dispatchKeyEvent', type='keyUp', key='Enter', code='Enter', windowsVirtualKeyCode=13)
        facts['actions'].append('original-xterm-stty-' + label)
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            guard()
            result = docker('exec', container, 'cat', path, check=False)
            if result.returncode == 0:
                try: return parse_shell_proof(result.stdout)
                except (AssertionError, ValueError): pass
            time.sleep(.1)
        raise AssertionError('Original shell stty result incomplete: ' + label)

    def settled(label):
        deadline = time.monotonic() + 8
        previous_view = previous_measurement = None
        stable_since = None
        samples = facts[label + 'ReadinessSamples'] = []
        while time.monotonic() < deadline:
            guard()
            before = viewport()
            now = time.monotonic()
            samples.append({'atSeconds': round(now - started, 3), 'viewport': before})
            del samples[:-6]
            if before != previous_view or not before.get('fontReady') or before.get('activeAnimations') != 0:
                previous_view, stable_since, previous_measurement = before, now, None
            elif now - stable_since >= .6:
                proof = shell(label)
                after = viewport()
                for key in ['shellPid', 'tty', 'cwd']:
                    assert proof[key] == facts['originalShell'][key], 'Original shell identity changed'
                current = {'viewport': after, 'shell': proof}
                samples[-1]['shell'] = proof
                assert time.monotonic() < deadline, 'Owned fit measurement phase exceeded8s'
                if after == before and current == previous_measurement:
                    return current
                previous_measurement = current if after == before else None
                if after != before:
                    previous_view, stable_since = after, time.monotonic()
            time.sleep(.2)
        raise AssertionError('Original terminal DOM and same-shell stty did not settle: ' + label)

    def original_shell():
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            guard()
            result = docker('exec', container, 'cat', '/work/project/terminal-proof.txt', check=False)
            lines = result.stdout.strip().splitlines()
            if result.returncode == 0 and len(lines) == 4 and lines[0] == 'LINUX_PTY_WRITE_OK':
                assert lines[1] == '/work/project' and lines[2].startswith('/dev/pts/')
                assert lines[2][len('/dev/pts/'):].isdigit() and lines[3].isdigit() and int(lines[3]) > 0
                return {'cwd': lines[1], 'tty': lines[2], 'shellPid': int(lines[3])}
            time.sleep(.1)
        raise AssertionError('Original terminal proof did not identify its shell')

    def layout_projection(target):
        guard()
        expression = layout_projection_expression(target)
        result = raw_cdp('Runtime.evaluate', returnByValue=True, expression=expression)
        value = result.get('result', {}).get('value')
        assert isinstance(value, dict)
        return value

    def click_layout_control(target):
        point = layout_projection(target)
        assert point['ok'], 'Expected original verified preview close or terminal control'
        for _ in range(3):
            raw_cdp('Input.dispatchMouseEvent', type='mouseMoved', x=point['x'], y=point['y'])
            current = layout_projection(target)
            assert current['ok']
            if abs(current['x'] - point['x']) < .5 and abs(current['y'] - point['y']) < .5:
                point = current
                break
            point = current
        else:
            raise AssertionError('Original layout control did not stabilize before click')
        guard()
        for kind in ['mousePressed', 'mouseReleased']:
            raw_cdp('Input.dispatchMouseEvent', type=kind, x=point['x'], y=point['y'], button='left', clickCount=1)
        facts['actions'].append('original-preview-pane-close' if target == 'collapse' else 'original-terminal-refocus')
        return point

    try:
        guard()
        facts['originalShell'] = original_shell()
        addon = packaged_root + '/resources/app.asar.unpacked/node_modules/node-pty/prebuilds/linux-arm64/pty.node'
        mapped_script = '''const fs=require('node:fs'),crypto=require('node:crypto');
const main=Number(process.argv[1]),addon=process.argv[2],parents=new Map();
for(const item of fs.readdirSync('/proc').filter(x=>/^\\d+$/.test(x))){try{const raw=fs.readFileSync('/proc/'+item+'/stat','utf8');parents.set(Number(item),Number(raw.slice(raw.lastIndexOf(')')+1).trim().split(/\\s+/)[1]));}catch{}}
const rows=[];for(const pid of parents.keys()){let current=pid,seen=new Set();while(current!==main&&parents.has(current)&&seen.size<64&&!seen.has(current)){seen.add(current);current=parents.get(current);}if(current!==main)continue;try{const maps=fs.readFileSync('/proc/'+pid+'/maps','utf8').split('\\n');if(maps.some(line=>line.endsWith(' '+addon)))rows.push({pid,ancestorMain:main,addon});}catch{}}
const hash=crypto.createHash('sha256').update(fs.readFileSync(addon)).digest('hex');process.stdout.write(JSON.stringify({rows,sha256:hash}));'''
        native = json.loads(docker('exec', container, 'node', '-e', mapped_script,
                                  str(main_pid), addon).stdout)
        assert native['sha256'] == 'c192e560428e778842fdbbe72f14032824b03373ed49ad3efcdbcf9eb249b75b'
        assert 1 <= len(native['rows']) <= 8, 'Original Main descendant must actually map the matched native addon'
        facts['actualMatchedNativeMappings'] = native
        guard()
        windows = docker('exec', container, 'xdotool', 'search', '--onlyvisible', '--pid', str(main_pid), check=False).stdout.split()
        candidates = []
        assert len(windows) <= 8
        for candidate in windows:
            assert candidate.isdigit()
            props = docker('exec', container, 'xprop', '-id', candidate, '_NET_WM_WINDOW_TYPE').stdout
            if '_NET_WM_WINDOW_TYPE_NORMAL' in props and '_NET_WM_WINDOW_TYPE_DIALOG' not in props:
                assert int(docker('exec', container, 'xdotool', 'getwindowpid', candidate).stdout.strip()) == main_pid
                candidates.append(candidate)
        assert len(candidates) == 1, 'One original owned main X window required'
        window = candidates[0]
        geometry = docker('exec', container, 'xdotool', 'getwindowgeometry', '--shell', window).stdout
        original_geometry = {key: int(value) for line in geometry.splitlines() if '=' in line
                             for key, value in [line.split('=', 1)] if key in ['WIDTH', 'HEIGHT']}
        changed = resized_geometry(original_geometry)
        # 文件预览已由原 probe 复读验收；先沿原按钮关闭，避免窗口变窄触发产品
        # 480px 响应式收起并保存偏好，改变恢复时的内部布局。这里不改 React 状态。
        closed = layout_projection('collapsed')
        if closed['ok']:
            facts['previewAlreadyCollapsed'] = True
        else:
            facts['previewBeforeClose'] = click_layout_control('collapse')
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            closed = layout_projection('collapsed')
            facts['previewLastProjection'] = closed
            if closed['ok']: break
            time.sleep(.1)
        else:
            raise AssertionError('Original preview pane did not close through its original UI')
        facts['previewAfterClose'] = closed
        click_layout_control('focus')
        baseline = settled('before')
        facts.update(window=window, geometryBefore=original_geometry, geometryAfter=changed,
                     viewportBefore=baseline['viewport'], before=baseline['shell'])
        guard()
        docker('exec', container, 'xdotool', 'windowsize', '--sync', window,
               str(changed['WIDTH']), str(changed['HEIGHT']))
        resized = True
        changed_measurement = settled('after')
        facts['viewportAfter'], facts['after'] = changed_measurement['viewport'], changed_measurement['shell']
        assert abs(facts['viewportAfter']['width'] - facts['viewportBefore']['width']) >= 10, 'Original terminal viewport did not follow the owned window resize'
        for key in ['shellPid', 'tty', 'cwd']:
            assert facts['after'][key] == facts['before'][key], 'Original shell identity changed'
        assert (facts['after']['rows'], facts['after']['cols']) != (facts['before']['rows'], facts['before']['cols']), 'Actual PTY size did not follow original UI fit'
        guard()
        docker('exec', container, 'xdotool', 'windowsize', '--sync', window,
               str(original_geometry['WIDTH']), str(original_geometry['HEIGHT']))
        restored = settled('restored')
        facts['viewportRestored'], facts['restored'] = restored['viewport'], restored['shell']
        assert restored['viewport'] == baseline['viewport'], 'Original terminal full viewport signature did not restore'
        assert facts['restored'] == facts['before'], 'Same shell and PTY size must restore with the original UI geometry'
        actual_geometry = docker('exec', container, 'xdotool', 'getwindowgeometry', '--shell', window).stdout
        facts['geometryRestored'] = {key: int(value) for line in actual_geometry.splitlines() if '=' in line
                                    for key, value in [line.split('=', 1)] if key in ['WIDTH', 'HEIGHT']}
        assert facts['geometryRestored'] == original_geometry
        resized = False
        facts['status'] = 'passed-original-UI-fit-and-same-shell-stty'
    except BaseException as error:
        facts['failure'] = {'type': type(error).__name__, 'message': str(error)[:500]}
        raise
    finally:
        if resized and original_geometry and window:
            try:
                guard()
                docker('exec', container, 'xdotool', 'windowsize', '--sync', window,
                       str(original_geometry['WIDTH']), str(original_geometry['HEIGHT']))
                facts['failedCaseOriginalGeometryRestored'] = True
            except BaseException as error:
                facts['failedCaseRestoreError'] = type(error).__name__
        facts['seconds'] = round(time.monotonic() - started, 3)
        (evidence / 'terminal-fit-actual.json').write_text(json.dumps(facts, indent=2) + '\n')
    return facts


if __name__ == '__main__':
    print(json.dumps({'status': 'prepared-not-run', 'guiStarted': False}))
