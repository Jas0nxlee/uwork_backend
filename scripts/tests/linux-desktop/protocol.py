"""System xdg-open and real GTK confirmation, scoped to the owned X display."""
import json
import time
import urllib.parse


def run_protocol(docker, container, bridge, control, until, facts, work, hold_seconds=0):
    target = '/work/protocol space 测试'
    docker('exec', container, 'mkdir', '-p', target)
    ready = json.loads((work / 'backend-ready.json').read_text())
    assert isinstance(ready.get('electronPid'), int), 'Current owned backend must identify its Electron owner'
    rows = []
    facts['protocol'] = rows
    baseline = control('/proof')
    handler = docker('exec', container, 'xdg-mime', 'query', 'default', 'x-scheme-handler/zcode').stdout.strip()
    assert handler == 'zcode.desktop', 'Original application must own its registered scheme'

    def visible_dialog():
        # 中文标题的 locale 转换可能失败；按已知 owner PID 找窗口，再核对原生 dialog 类型。
        result = docker('exec', container, 'xdotool', 'search', '--onlyvisible', '--pid',
                        str(ready['electronPid']), check=False, timeout=5)
        windows = []
        observed = []
        for window in result.stdout.split()[:8]:
            title = docker('exec', container, 'xdotool', 'getwindowname', window, check=False).stdout.strip()
            properties = docker('exec', container, 'xprop', '-id', window,
                                '_NET_WM_WINDOW_TYPE', '_NET_WM_STATE', 'WM_TRANSIENT_FOR', check=False).stdout
            observed.append({'window': window, 'title': title, 'properties': properties[:500]})
            if '_NET_WM_WINDOW_TYPE_DIALOG' in properties or '_NET_WM_STATE_MODAL' in properties:
                pid = docker('exec', container, 'xdotool', 'getwindowpid', window).stdout.strip()
                executable = docker('exec', container, 'readlink', '/proc/' + pid + '/exe').stdout.strip()
                assert executable == ready['packagedRoot'] + '/zcode-preview'
                windows.append(window)
        facts['protocolNativeWindows'] = observed
        assert len(windows) <= 1, 'Only one owned protocol dialog is allowed'
        return windows[0] if windows else None

    try:
        for action in ['cancel', 'confirm']:
            docker('exec', container, 'kill', '-0', str(ready['desktopPid']))
            url = 'zcode://workspace/open?' + urllib.parse.urlencode({'path': target})
            # 原 .desktop 决定命令与 argv；仅在 RAM 复用当前进程环境，保持同一 userData/single-instance。
            script = '''const fs=require('node:fs'),cp=require('node:child_process');
const env=Object.fromEntries(fs.readFileSync('/proc/'+process.argv[1]+'/environ','utf8').split('\\0').filter(Boolean).map(x=>{const i=x.indexOf('=');return[x.slice(0,i),x.slice(i+1)]}));
fs.writeFileSync('/work/protocol-'+process.argv[2]+'-env.json',JSON.stringify({sameUserData:env.ZCODE_DESKTOP_USER_DATA_DIR==='/work/userdata',sameHome:env.HOME==='/work/home',sameSessionData:env.ZCODE_DESKTOP_SESSION_DATA_DIR==='/work/sessiondata'}));
const fd=fs.openSync('/work/protocol-'+process.argv[2]+'.log','w');
const trace=env.UWORK_LINUX_TEST_TRACE_LIFETIME==='1';
const child=cp.spawn(trace?'strace':'xdg-open',trace?['-ff','-tt','-e','trace=process,signal,connect','-o','/work/protocol-secondary-trace','xdg-open',process.argv[3]]:[process.argv[3]],{env,stdio:['ignore',fd,fd]});
child.on('error',e=>fs.writeFileSync('/work/protocol-'+process.argv[2]+'-exit.json',JSON.stringify({error:e.code})));
child.on('close',(code,signal)=>fs.writeFileSync('/work/protocol-'+process.argv[2]+'-exit.json',JSON.stringify({code,signal})));'''
            docker('exec', '-d', container, 'node', '-e', script, str(ready['desktopPid']), action, url)
            row = {'action': action, 'handler': handler, 'systemXdgOpen': True}
            rows.append(row)
            row['singletonBefore'] = docker('exec', container, 'sh', '-c', 'ls -l /work/userdata/Singleton*', check=False).stdout[-1000:]
            window = None
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline:
                window = visible_dialog()
                if window:
                    break
                exit_file = work / ('protocol-' + action + '-exit.json')
                if exit_file.exists():
                    row['launcherExit'] = json.loads(exit_file.read_text())
                env_file = work / ('protocol-' + action + '-env.json')
                if env_file.exists():
                    row['launchEnvironment'] = json.loads(env_file.read_text())
                    assert all(row['launchEnvironment'].values())
                time.sleep(.2)
            if not window:
                row['launcherLog'] = (work / ('protocol-' + action + '.log')).read_text()[-1600:]
                row['singletonFiles'] = docker('exec', container, 'sh', '-c', 'ls -ld /work/userdata; ls -l /work/userdata/Singleton*', check=False).stdout[-1500:]
                row['nativeWindowTree'] = docker('exec', container, 'xwininfo', '-root', '-tree', check=False).stdout[-6000:]
                diagnostic = '''const fs=require('node:fs');const rows=[];
for(const p of fs.readdirSync('/proc').filter(x=>/^\\d+$/.test(x))){try{const exe=fs.readlinkSync('/proc/'+p+'/exe');if(!exe.endsWith('/zcode-preview'))continue;const entries=fs.readFileSync('/proc/'+p+'/environ','utf8').split(String.fromCharCode(0)).filter(Boolean).map(s=>{const i=s.indexOf('=');return[s.slice(0,i),s.slice(i+1)]});const e=Object.fromEntries(entries);rows.push({pid:Number(p),sameUserData:e.ZCODE_DESKTOP_USER_DATA_DIR==='/work/userdata',sameHome:e.HOME==='/work/home',sameSessionData:e.ZCODE_DESKTOP_SESSION_DATA_DIR==='/work/sessiondata'});}catch{}}
process.stdout.write(JSON.stringify(rows));'''
                row['ownedElectronEnvironments'] = json.loads(docker('exec', container, 'node', '-e', diagnostic).stdout)
                raise AssertionError('System URI did not reach the original native confirmation')
            exit_path = work / 'desktop-exit.json'
            if exit_path.exists():
                row['originalDesktopExit'] = json.loads(exit_path.read_text())
            row['dialogTitle'] = docker('exec', container, 'xdotool', 'getwindowname', window).stdout.strip()
            row['dialogWindowId'] = window
            row['dialogPid'] = docker('exec', container, 'xdotool', 'getwindowpid', window).stdout.strip()
            assert int(row['dialogPid']) == ready['electronPid'], 'Confirmation must belong to the original Electron instance'
            if action == 'cancel' and hold_seconds:
                assert 0 < hold_seconds <= 30
                before_hold = time.monotonic()
                while time.monotonic() - before_hold < hold_seconds:
                    if time.monotonic() - before_hold > 8 and not row.get('parallelUnknownUriSent'):
                        docker('exec', '-d', container, 'node', '-e', script, str(ready['desktopPid']),
                               'parallel', 'zcode://unrecognized-owned-protocol-test')
                        row['parallelUnknownUriSent'] = True
                    alive = docker('exec', container, 'kill', '-0', str(ready['desktopPid']), check=False).returncode == 0
                    if not alive:
                        row['originalDesktopExit'] = json.loads((work / 'desktop-exit.json').read_text())
                        row['exitedAfterDialogSeconds'] = round(time.monotonic() - before_hold, 3)
                        raise AssertionError('Original instance died while its protocol confirmation was awaiting a decision')
                    time.sleep(.2)
                row['pendingConfirmationHoldSeconds'] = round(time.monotonic() - before_hold, 3)
                parallel_exit = work / 'protocol-parallel-exit.json'
                assert parallel_exit.exists(), 'Parallel system protocol launcher must finish during pending confirmation'
                row['parallelLauncherExit'] = json.loads(parallel_exit.read_text())
                assert row['parallelLauncherExit'] == {'code': 0, 'signal': None}
                mains = [p['pid'] for p in control('/runtime')['processes'] if p['processTitle'] == 'UWork Preview']
                row['electronMainPidsAfterHold'] = mains
                row['originalExecutableLinkAfterHold'] = docker('exec', container, 'readlink', f"/proc/{ready['electronPid']}/exe", check=False).stdout.strip()
                row['originalExecutableStillExists'] = docker('exec', container, 'test', '-x', ready['packagedRoot'] + '/zcode-preview', check=False).returncode == 0
                assert mains == [ready['electronPid']], 'Second instance must finish without replacing or duplicating the original'
                row['onlyOriginalElectronMainAlive'] = True
            docker('exec', container, 'xdotool', 'windowfocus', '--sync', window)
            docker('exec', container, 'xdotool', 'key', '--clearmodifiers',
                   *(['Escape'] if action == 'cancel' else ['shift+Tab', 'Return']))
            deadline = time.monotonic() + 5
            while visible_dialog() and time.monotonic() < deadline:
                time.sleep(.1)
            assert visible_dialog() is None, 'Native decision must dismiss its dialog'
            expected = 'project' if action == 'cancel' else 'protocol space 测试'
            row['workspace'] = until('''(()=>{const draft=document.querySelector('[data-testid="composer-workspace-trigger"]');const context=document.querySelector('[data-testid="workspace-path"]')?.getAttribute("aria-label");const text=draft?.innerText.trim()??context?.split(" · ")[0];return{ok:text===%s,text,context}})()''' % json.dumps(expected), 15)
            assert control('/proof') == baseline, 'Protocol delivery must not run models or add ledger entries'
            docker('exec', container, 'kill', '-0', str(ready['desktopPid']))
            row['originalDesktopAlive'] = True
            row['status'] = 'passed'
        facts['checks'].append('system-xdg-uri-original-confirmation-cancel-and-accept-no-model-delta')
    finally:
        window = visible_dialog()
        if window:
            docker('exec', container, 'xdotool', 'windowfocus', '--sync', window, check=False)
            docker('exec', container, 'xdotool', 'key', '--clearmodifiers', 'Escape', check=False)
