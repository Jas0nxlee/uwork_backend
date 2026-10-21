"""Reuse original UI acceptance with explicit, audited distro fixture changes.

The shared source files and packaged application are never edited. Audited fixture
adaptations select the native package database, restore the normal sandbox, and
optionally observe public member usage. The outer container provides user namespaces.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import time

REPO = Path(__file__).resolve().parents[3]
DOCKER = ['docker', '--context', 'colima-uwork-backend']
parser = argparse.ArgumentParser()
parser.add_argument('kind', choices=['fedora', 'arch'])
parser.add_argument('--name', required=True)
parser.add_argument('--image', required=True)
parser.add_argument('--usage-isolation', action='store_true', help='Observe original self/other usage API and revoked seat')
parser.add_argument('--business-without-reload', action='store_true', help='Separate business slice; retains previous reload failure as uncovered')
parser.add_argument('--reload-diagnostics', action='store_true', help='Read-only proc/cgroup and local CDP HTTP around original reload')
args = parser.parse_args()
assert args.name.startswith('client-linux-desktop-' + args.kind + '-')
assert args.name.replace('-', '').isalnum()
assert args.image.startswith('uwork-linux-desktop-' + args.kind + ':')
EVIDENCE = REPO / 'evidence' / args.name
CONTAINER = 'uwork-' + args.name
facts = {'status': 'failed', 'kind': args.kind, 'sourceEdits': [],
         'outerLaunches': 0, 'fixtureNoSandboxRemovals': 0}
original_run = subprocess.run
SAMPLER = r'''
const fs=require('node:fs');const seen=new Map();let samples=0;
function sample(){samples++;for(const pid of fs.readdirSync('/proc').filter(p=>/^\d+$/.test(p))){try{
 const base='/proc/'+pid;if(fs.readlinkSync(base+'/exe')!=='/opt/UWork Preview/zcode-preview')continue;
 const status=fs.readFileSync(base+'/status','utf8'),fields={},ns={};
 for(const name of ['Uid','Gid','NSpid','NoNewPrivs','Seccomp','Seccomp_filters','CapEff'])fields[name]=status.match(new RegExp('^'+name+':\\s*(.*)$','m'))?.[1];
 for(const name of ['pid','user','net'])try{ns[name]=fs.readlinkSync(base+'/ns/'+name)}catch{}
 const row={pid:Number(pid),args:fs.readFileSync(base+'/cmdline','utf8').split('\0').filter(Boolean),fields,namespaces:ns};
 if(!seen.has(pid))seen.set(pid,{first:row});seen.get(pid).last=row;
 }catch{}}
 if(samples%5===0)fs.writeFileSync('/work/distro-kernel.json',JSON.stringify({samples,processes:[...seen.values()]},null,2));
}setInterval(sample,100);sample();
'''


SNAPSHOT = r'''
const fs=require('node:fs');const ids=JSON.parse(process.argv[1]);
function birth(base){return fs.readFileSync(base+'/stat','utf8').split(') ').slice(1).join(') ').trim().split(/\s+/)[19];}
const rows=ids.map(pid=>{try{const base='/proc/'+pid;const before=birth(base);const executable=fs.readlinkSync(base+'/exe');
 if(executable!=='/opt/UWork Preview/zcode-preview')throw Object.assign(Error('wrong executable'),{code:'WRONG_EXECUTABLE'});
 const status=fs.readFileSync(base+'/status','utf8'),fields={},namespaces={};
 for(const name of ['Uid','Gid','NSpid','NoNewPrivs','Seccomp','Seccomp_filters','CapEff'])fields[name]=status.match(new RegExp('^'+name+':\\s*(.*)$','m'))?.[1];
 for(const name of ['pid','user','net'])namespaces[name]=fs.readlinkSync(base+'/ns/'+name);
 const args=fs.readFileSync(base+'/cmdline','utf8').split('\0').filter(a=>a===executable||a.startsWith('--type=')||a.startsWith('--no-sandbox')||a.startsWith('--no-zygote-sandbox')||a.startsWith('--renderer-client-id='));
 const after=birth(base);if(before!==after)throw Object.assign(Error('pid changed'),{code:'PID_REUSED'});
 return {pid,executable,args,fields,namespaces,startTicks:before,unchangedBirth:true};
}catch(error){return {pid,unavailable:error.code};}});console.log(JSON.stringify(rows));
'''


def verify_sandbox_before_chat(bridge, phase="before-chat"):
    # Chromium renderer role comes from its own browser CDP, not inherited zygote argv.
    browser_session = bridge.raw_cdp('Target.attachToBrowserTarget')['sessionId']
    process_info = bridge.raw_cdp('SystemInfo.getProcessInfo', session_id=browser_session)['processInfo']
    renderer_ids = {int(row['id']) for row in process_info if row['type'] == 'renderer'}
    browser_ids = {int(row['id']) for row in process_info if row['type'] == 'browser'}
    assert renderer_ids and len(browser_ids) == 1
    ready = json.loads((REPO / 'data/sandbox-verification' / args.name / 'work/backend-ready.json').read_text())
    assert browser_ids == {ready['electronPid']}
    inspected = original_run(DOCKER + ['inspect', CONTAINER], capture_output=True, text=True, check=True)
    actual = json.loads(inspected.stdout)[0]
    assert actual['Id'] == facts['actualContainerIdentity']['id']
    assert actual['State']['Pid'] == facts['actualContainerIdentity']['initHostPid']
    observation = original_run(DOCKER + ['exec', '--user', '1000:1000', CONTAINER, 'node', '-e', SNAPSHOT,
                                       json.dumps(sorted(renderer_ids | browser_ids))], capture_output=True,
                               text=True, check=True, timeout=10)
    rows = json.loads(observation.stdout)
    (EVIDENCE / ('kernel-' + phase + '-raw.json')).write_text(json.dumps({'processInfo': process_info, 'rows': rows}, indent=2) + '\n')
    primary = next(row for row in rows if row['pid'] in browser_ids)
    renderers = [row for row in rows if row['pid'] in renderer_ids]
    for row in [primary, *renderers]:
        assert not row.get('unavailable'), row
        assert row['unchangedBirth'] and row['startTicks'].isdigit()
        assert row['fields']['NSpid'].split()[0] == str(row['pid'])
        assert row['fields']['Uid'].split() == row['fields']['Gid'].split() == ['1000'] * 4
        assert row['fields']['NoNewPrivs'] == '1'
        assert int(row['fields']['CapEff'], 16) == 0
        assert '--no-sandbox' not in row['args']
    for renderer in renderers:
        assert renderer['fields']['Seccomp'] == '2'
        assert renderer['namespaces']['user'] != primary['namespaces']['user']
        assert renderer['namespaces']['pid'] != primary['namespaces']['pid']
    sandbox = {'primaryPid': primary['pid'], 'rendererPids': sorted(renderer_ids),
                        'internalSeccompFilter': True, 'nestedUserAndPidNamespaces': True,
                        'verifiedBeforeChat': True, 'roleSource': 'original browser CDP SystemInfo.getProcessInfo', 'phase': phase}
    facts.setdefault('sandboxObservations', []).append(sandbox)
    if phase == 'before-chat':
        facts['sandbox'] = sandbox
    facts['beforeChatKernel'] = {'processInfo': process_info, 'rows': rows}
    (EVIDENCE / ('kernel-' + phase + '.json')).write_text(json.dumps(facts['beforeChatKernel'], indent=2) + '\n')


def reload_observation(bridge, phase):
    if phase == 'before':
        xdg_source = original_run(DOCKER + ['exec', '--user', '1000:1000', CONTAINER, 'cat', '/usr/sbin/xdg-open'], capture_output=True, text=True, check=True).stdout
        desktop = original_run(DOCKER + ['exec', '--user', '1000:1000', CONTAINER, 'cat', '/usr/share/applications/zcode-preview.desktop'], capture_output=True, text=True, check=True).stdout
        import re
        match = re.search(r'(?m)^first_word\(\)\n\{\n.*?^\}', xdg_source, re.DOTALL)
        assert match, 'Original first_word parser must be observed, not substituted'
        executable = next(line[5:] for line in desktop.splitlines() if line.startswith('Exec='))
        parsed = original_run(DOCKER + ['exec', '--user', '1000:1000', CONTAINER, 'sh', '-c', match.group() + '\nprintf "%s\\n" "$1" | first_word', 'owned-xdg-readonly', executable], capture_output=True, text=True, check=True)
        token = parsed.stdout.strip()
        resolution = original_run(DOCKER + ['exec', '--user', '1000:1000', CONTAINER, 'sh', '-c', 'command -v "$1"', 'owned-token-resolution', token], capture_output=True, text=True)
        alias = original_run(DOCKER + ['exec', '--user', '1000:1000', CONTAINER, 'readlink', '-f', '/usr/bin/zcode-preview'], capture_output=True, text=True, check=True)
        version = original_run(DOCKER + ['exec', '--user', '1000:1000', CONTAINER, 'xdg-open', '--version'], capture_output=True, text=True, check=True)
        facts['xdgReadOnly'] = {'sourceSha256': hashlib.sha256(xdg_source.encode()).hexdigest(), 'desktop': desktop, 'originalFirstWord': match.group(), 'parsedToken': token, 'commandResolutionExit': resolution.returncode, 'resolved': resolution.stdout.strip(), 'installedAliasRealpath': alias.stdout.strip(), 'version': version.stdout.strip(), 'noProtocolDispatched': True}
        (EVIDENCE / 'xdg-readonly.json').write_text(json.dumps(facts['xdgReadOnly'], indent=2) + '\n')
        browser_session = bridge.raw_cdp('Target.attachToBrowserTarget')['sessionId']
        process_info = bridge.raw_cdp('SystemInfo.getProcessInfo', session_id=browser_session)['processInfo']
        ids = sorted(int(row['id']) for row in process_info)
        response = original_run(DOCKER + ['exec', '--user', '1000:1000', CONTAINER, 'node', '-e', SNAPSHOT, json.dumps(ids)], capture_output=True, text=True, check=True, timeout=10)
        rows = json.loads(response.stdout)
        roles = [{'id': row['pid'], 'birth': row['startTicks'], 'type': next(value['type'] for value in process_info if int(value['id']) == row['pid'])} for row in rows if not row.get('unavailable')]
        facts['reloadProcessRoles'] = {'processInfo': process_info, 'initialSnapshots': rows, 'boundRoles': roles}
        observer = Path(__file__).with_name('reload-observer.mjs').read_text()
        facts['reloadObserverSourceSha256'] = hashlib.sha256(observer.encode()).hexdigest()
        original_run(DOCKER + ['exec', '-d', '--user', '1000:1000', CONTAINER, 'node', '--input-type=module', '-e', observer, json.dumps(roles)], capture_output=True, text=True, check=True, timeout=10)
        inspected = json.loads(original_run(DOCKER + ['inspect', CONTAINER], capture_output=True, text=True, check=True).stdout)[0]
        facts['reloadContainerLimits'] = {key: inspected['HostConfig'][key] for key in ['Memory', 'MemorySwap', 'NanoCpus', 'PidsLimit']}
    receipt = {'phase': phase, 'atMonotonic': time.monotonic(), 'endpoints': []}
    for endpoint in ['version', 'list']:
        response = original_run(DOCKER + ['exec', '--user', '1000:1000', CONTAINER, 'curl', '--max-time', '3', '-sS', 'http://127.0.0.1:9222/json/' + endpoint], capture_output=True, text=True, timeout=8)
        receipt['endpoints'].append({'path': '/json/' + endpoint, 'exitCode': response.returncode, 'stdout': response.stdout, 'stderr': response.stderr})
    receipt['finishedMonotonic'] = time.monotonic()
    facts.setdefault('reloadHttpObservations', []).append(receipt)
    (EVIDENCE / ('reload-http-' + phase + '.json')).write_text(json.dumps(receipt, indent=2) + '\n')


def verify_public_usage(control, phase):
    proof = control('/distro-public-usage-proof')
    other = proof['other']
    forged = proof['otherWithForeignSelector']
    assert other['status'] == forged['status'] == 200
    for response in [other, forged]:
        summary = response['body']['summary']
        assert summary['requestCount'] == summary['successCount'] == summary['cost'] == summary['totalTokens'] == 0
        assert response['body']['models'] == response['body']['trend'] == []
    for name in ['selfManagement', 'otherManagement']:
        assert proof[name]['status'] == 403 and proof[name]['body']['error']['code'] == 'FORBIDDEN'
    if phase == 'settled':
        assert proof['self']['status'] == 200
        summary = proof['self']['body']['summary']
        assert summary['requestCount'] == summary['successCount'] == 2
        assert summary['cost'] == summary['totalTokens'] == 44
        assert summary['promptTokens'] == 24 and summary['completionTokens'] == 20
    else:
        assert phase == 'revoked'
        assert proof['self']['status'] == 403 and proof['self']['body']['error']['code'] == 'NO_SEAT'
    facts.setdefault('publicUsageProofs', {})[phase] = proof
    return proof


def patch_once(source, before, after, label):
    assert source.count(before) == 1, label
    facts['sourceEdits'].append({'label': label, 'before': before, 'after': after})
    return source.replace(before, after)


def scoped_run(command, *positional, **kwargs):
    fixture_build = isinstance(command, list) and len(command) > 4 and command[1:3] == ['--input-type=module', '-e'] and 'entryPoints' in command[3]
    if isinstance(command, list) and command[:5] == DOCKER + ['run', '-d']:
        assert command[command.index('--name') + 1] == CONTAINER
        assert command[command.index('--user') + 1] == '1000:1000'
        assert '--privileged' not in command and 'no-new-privileges' in command
        command = command[:5] + ['--security-opt', 'seccomp=unconfined'] + command[5:]
        facts['outerLaunches'] += 1
        facts['actualLaunchArguments'] = command
    if args.usage_isolation and fixture_build:
        backend_path = REPO / 'scripts/tests/linux-desktop/backend.mjs'
        backend_source = backend_path.read_text()
        addon_path = Path(__file__).with_name('usage-fixture-addition.mjs.tpl')
        addon = addon_path.read_text()
        backend_source = patch_once(backend_source, 'const control = createServer(async (req, res) => {',
            addon + '\nconst control = createServer(async (req, res) => {\n  if (req.method === "GET" && req.url === "/distro-public-usage-proof") {\n    res.setHeader("content-type", "application/json");\n    res.end(JSON.stringify(await distroPublicUsageProof())); return;\n  }',
            'one-anchor fixture HTTP observer; original public APIs create/read members')
        adapted = Path(command[-1]).with_name('backend-distro-source.mjs')
        adapted.write_text(backend_source)
        adapted.chmod(0o600)
        facts['usageFixtureSourceSha256'] = hashlib.sha256(backend_source.encode()).hexdigest()
        facts['usageFixtureAdditionSha256'] = hashlib.sha256(addon.encode()).hexdigest()
        build = command[3]
        original_entry = "entryPoints:['scripts/tests/linux-desktop/backend.mjs']"
        assert build.count(original_entry) == 1
        build = build.replace(original_entry, 'stdin:{contents:readFileSync(' + json.dumps(str(adapted)) + ',"utf8"),resolveDir:' + json.dumps(str(backend_path.parent)) + ',sourcefile:"backend-distro.mjs"}')
        command = command[:3] + [build] + command[4:]
    result = original_run(command, *positional, **kwargs)
    if isinstance(command, list) and command[:5] == DOCKER + ['run', '-d'] and result.returncode == 0:
        inspected = original_run(DOCKER + ['inspect', CONTAINER], capture_output=True,
                                 text=True, check=True)
        config = json.loads(inspected.stdout)[0]
        facts['actualContainerIdentity'] = {'id': config['Id'], 'initHostPid': config['State']['Pid']}
        facts['actualOuter'] = {'image': config['Image'], 'user': config['Config']['User'],
                                'securityOpt': config['HostConfig']['SecurityOpt'],
                                'capDrop': config['HostConfig']['CapDrop'],
                                'privileged': config['HostConfig']['Privileged']}
        original_run(DOCKER + ['exec', '-d', '--user', '1000:1000', CONTAINER,
                               'node', '-e', SAMPLER], capture_output=True, text=True,
                      check=True)
    # Only the original esbuild fixture output is adapted; no packaged file is
    # writable here. Removing this test flag restores Chromium's normal sandbox.
    if fixture_build:
        output = Path(command[-1])
        assert output == REPO / 'data/sandbox-verification' / args.name / 'input/backend.mjs'
        assert result.returncode == 0
        source = output.read_text()
        assert source.count('"--no-sandbox",') == 1
        facts['fixtureBeforeSha256'] = hashlib.sha256(source.encode()).hexdigest()
        source = source.replace('"--no-sandbox",', '')
        output.write_text(source)
        facts['fixtureAfterSha256'] = hashlib.sha256(source.encode()).hexdigest()
        facts['fixtureNoSandboxRemovals'] += 1
    return result


try:
    assert original_run(DOCKER + ['inspect', CONTAINER], capture_output=True, text=True).returncode != 0, 'Refuse existing container'
    path = REPO / 'scripts/tests/linux-desktop/probe.py'
    original_source = path.read_text()
    facts['originalProbeSha256'] = hashlib.sha256(original_source.encode()).hexdigest()
    before = "facts['installedPackageStatus'] = docker('exec', container, 'dpkg-query', '-W', '-f=${Package} ${Version} ${Architecture} ${db:Status-Status}', 'zcode-preview').stdout\n            assert facts['installedPackageStatus'] == 'zcode-preview 3.16.0 arm64 installed'"
    if args.kind == 'fedora':
        after = "facts['installedPackageStatus'] = docker('exec', container, 'rpm', '-q', '--qf', '%{NAME} %{VERSION} %{ARCH}', 'zcode-preview').stdout\n            assert facts['installedPackageStatus'] == 'zcode-preview 3.16.0 aarch64'"
    else:
        after = "facts['installedPackageStatus'] = docker('exec', container, 'pacman', '-Q', 'zcode-preview').stdout.strip()\n            assert facts['installedPackageStatus'] == 'zcode-preview 3.16.0-1'"
    source = patch_once(original_source, before, after, 'native package database')
    source = patch_once(source, "        facts['checks'].append('original-linux-app-asar-renderer')", "        facts['checks'].append('original-linux-app-asar-renderer')\n        verify_sandbox_before_chat(bridge, 'initial-ready')", 'read-only sandbox gate at original renderer ready')
    source = patch_once(source, "        bridge.raw_cdp('Page.reload')", "        print('DISTRO_RELOAD_BEGIN', time.monotonic(), flush=True)\n        bridge.raw_cdp('Page.reload')\n        print('DISTRO_RELOAD_RETURNED', time.monotonic(), flush=True)", 'original reload timestamps only')
    source = patch_once(source, "        baseline = control('/proof')", "        verify_sandbox_before_chat(bridge)\n        baseline = control('/proof')", 'read-only sandbox gate before original Chat')
    if args.reload_diagnostics:
        assert not args.business_without_reload, 'Reload diagnostics require the original reload'
        source = patch_once(source, "        print('DISTRO_RELOAD_BEGIN', time.monotonic(), flush=True)", "        reload_observation(bridge, 'before')\n        print('DISTRO_RELOAD_BEGIN', time.monotonic(), flush=True)", 'read-only diagnostics before original reload')
        source = patch_once(source, "        print('DISTRO_RELOAD_RETURNED', time.monotonic(), flush=True)", "        print('DISTRO_RELOAD_RETURNED', time.monotonic(), flush=True)\n        reload_observation(bridge, 'returned')", 'read-only diagnostics after original reload response')
        source = patch_once(source, "    except BaseException as error:\n", "    except BaseException as error:\n        try:\n            reload_observation(bridge, 'failure')\n        except Exception as diagnostic_error:\n            facts['reloadDiagnosticFailure'] = str(diagnostic_error)\n", 'read-only local CDP failure observation before original cleanup')
    if args.business_without_reload:
        start = source.index("        # 预览 tab 由模块内 Map 记忆")
        end = source.index("        if pty:", start)
        omitted = source[start:end]
        assert omitted.count("bridge.raw_cdp('Page.reload')") == 1
        assert omitted.count("renderer-reload-restores-identity-workspace-and-file-entry") == 1
        source = patch_once(source, omitted, "        facts['scopeOmissions'] = ['reload retained as separate failed scenario; not covered in this business slice']\n", 'separate business slice after documented reload failure; no reload pass recorded')
        facts['scopeOmissions'] = ['renderer reload; retained failed Arch v2 is not repaired by this slice']
    if args.usage_isolation:
        source = patch_once(source, "        facts['checks'].append('original-packaged-send-backend-supplier-and-ledger')",
            "        facts['checks'].append('original-packaged-send-backend-supplier-and-ledger')\n        facts['publicUsageSettled'] = verify_public_usage(control, 'settled')\n        facts['checks'].append('original-public-self-usage-and-other-member-isolation')", 'public usage after real settled model calls')
        source = patch_once(source, "        facts['checks'].append('original-send-after-seat-revocation-no-model-or-ledger-delta')",
            "        facts['checks'].append('original-send-after-seat-revocation-no-model-or-ledger-delta')\n        facts['publicUsageRevoked'] = verify_public_usage(control, 'revoked')\n        facts['checks'].append('original-public-usage-seat-denied-other-member-unaffected')", 'public usage after original seat revoke')
    # Keep __file__ anchored to the original directory so that the unmodified
    # entry.sh and protocol.py are reused through their existing source paths.
    namespace = {'__file__': str(path), '__name__': 'linux_distro_acceptance',
                 'verify_sandbox_before_chat': verify_sandbox_before_chat,
                 'verify_public_usage': verify_public_usage, 'reload_observation': reload_observation}
    exec(compile(source, str(path), 'exec'), namespace)
    subprocess.run = scoped_run
    ok = namespace['run'](args.name, pty=True, installed=True, ordinary_user=True,
                           test_image=args.image, protocol=True, window_manager=True,
                           protocol_hold_seconds=25)
    assert ok, 'Original product acceptance failed; exact failure retained in result.json'
    assert facts['outerLaunches'] == facts['fixtureNoSandboxRemovals'] == 1
    work = REPO / 'data/sandbox-verification' / args.name / 'work'
    kernel = json.loads((work / 'distro-kernel.json').read_text())
    shutil.copyfile(work / 'distro-kernel.json', EVIDENCE / 'distro-kernel.json')
    ready = json.loads((work / 'backend-ready.json').read_text())
    assert facts['sandbox']['verifiedBeforeChat']
    assert facts['sandbox']['primaryPid'] == ready['electronPid']
    facts['status'] = 'passed' if ok else 'failed'
except Exception as error:
    facts['failure'] = str(error)
    raise
finally:
    subprocess.run = original_run
    EVIDENCE.mkdir(mode=0o700, exist_ok=True)
    if args.reload_diagnostics:
        passive = REPO / 'data/sandbox-verification' / args.name / 'work/reload-passive.jsonl'
        if passive.exists():
            shutil.copyfile(passive, EVIDENCE / 'reload-passive.jsonl')
    (EVIDENCE / 'distro-controller-result.json').write_text(json.dumps(facts, indent=2) + '\n')
raise SystemExit(0 if facts['status'] == 'passed' else 1)
