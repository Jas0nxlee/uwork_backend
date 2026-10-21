"""Normal current-source Linux directory producer; no VM, GUI, Agent build or archive."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess

REPO = Path(__file__).resolve().parents[2]
CLIENT = REPO / 'clients/uwork'
NODE = Path('/Users/ljp/.cache/uwork-client-toolchain/node-v24.14.0-darwin-arm64/bin/node')
PNPM = '/Users/ljp/.local/share/dsh-tools/node_modules/.bin/pnpm'
OUT = Path('/Users/ljp/Library/Caches/uwork-backend/client-linux-desktop-package-pty-wire-20261020')
EVIDENCE = REPO / 'evidence/client-linux-pty-wire-host-package-20261020'
CDF = 'cdf781ecf004b9639157fae25e6e96e558b95faefaee7aab09488d5dc650ecac'


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def main():
    assert not OUT.exists() and not EVIDENCE.exists(), 'Fresh directory producer required'
    cli = CLIENT / 'apps/zcode-cli/packages/cli/dist/zcode.cjs'
    staged = CLIENT / 'packages/desktop/bundled-agents/linux-arm64/glm/zcode.cjs'
    assert digest(cli) == digest(staged) == CDF
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=REPO, text=True).strip()
    assert head.startswith('1a8f24cb')
    names = ['packages/desktop/src/main/desktopDeepLinkUrl.ts',
             'packages/ui/src/root/useRootPlatformEffects.ts',
             'packages/desktop/src/main/index.ts',
             'packages/desktop/src/main/desktopOAuthDeepLink.ts',
             'packages/desktop/src/main/desktopSecondInstanceDeepLink.ts',
             'packages/desktop/src/main/startupWorkspaceDeepLinkGate.ts',
             'packages/desktop/electron-builder.config.js',
             'packages/desktop/scripts/node-pty-package-assets.mjs',
             'packages/desktop/package.json', 'pnpm-lock.yaml',
             'specs/node-pty-native-compatibility.md']
    before = {name: digest(CLIENT / name) for name in names}
    EVIDENCE.mkdir(mode=0o700)
    import shutil
    inputs = EVIDENCE / 'source-inputs'
    for name in names:
        target = inputs / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(CLIENT / name, target)
        assert digest(target) == before[name]
    shutil.copyfile(Path(__file__), EVIDENCE / 'producer-source.py')
    prefixes = ('ZCODE_', 'UWORK_', 'ELECTRON_', 'BU_', 'BH_', 'BROWSER_',
                'NODE_OPTIONS', 'NODE_PATH', 'CSC_', 'APPLE_')
    env = {key: value for key, value in os.environ.items() if not key.startswith(prefixes)}
    env.update(PATH=f'{NODE.parent}:{CLIENT}/node_modules/.bin:{Path(PNPM).parent}:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin',
               ZCODE_ENV='production', ZCODE_PREVIEW_IDENTITY='1', ZCODE_TARGET_OS='linux',
               ZCODE_TARGET_ARCH='arm64', ZCODE_DESKTOP_DIST_DIR=str(OUT),
               NODE_OPTIONS='--import ' + str(REPO / 'evidence/client-live-20261017/build-env-guard.mjs'))
    result = {'status': 'failed', 'sourceCommit': head, 'output': str(OUT), 'commands': [],
              'sourceSha256Before': before, 'agentSha256Before': CDF, 'vmStarted': False,
              'guiStarted': False, 'agentRebuilt': False, 'archiveCreated': False,
              'startedAt': datetime.datetime.now().astimezone().isoformat()}
    try:
        for label, cwd, argv in [
            ('desktop-build', CLIENT, [PNPM, '--filter', '@zcode/desktop', 'build:no-runtime-assets']),
            ('native-directory', CLIENT / 'packages/desktop', [PNPM, 'exec', 'electron-builder',
             '--config', 'electron-builder.config.js', '--linux', '--arm64', '--dir', '--publish', 'never']),
        ]:
            with (EVIDENCE / (label + '.log')).open('w') as log:
                code = subprocess.run(argv, cwd=cwd, env=env, stdout=log,
                                      stderr=subprocess.STDOUT, timeout=600).returncode
            result['commands'].append({'label': label, 'argv': argv, 'cwd': str(cwd), 'exitCode': code})
            assert code == 0, label + ' failed; preserve original failure'
        app = OUT / 'linux-arm64-unpacked'
        files = {}
        for name in ['zcode-preview', 'resources/app.asar', 'resources/glm/zcode.cjs',
                     'resources/config/provider/zcode-builtin.json',
                     'resources/app.asar.unpacked/node_modules/node-pty/prebuilds/linux-arm64/pty.node']:
            file = app / name
            files[name] = {'bytes': file.stat().st_size, 'sha256': digest(file)}
        assert files['resources/glm/zcode.cjs']['sha256'] == digest(cli) == digest(staged) == CDF
        assert files['resources/app.asar.unpacked/node_modules/node-pty/prebuilds/linux-arm64/pty.node']['sha256'] == 'c192e560428e778842fdbbe72f14032824b03373ed49ad3efcdbcf9eb249b75b'
        asar_script = '''import {createRequire} from 'node:module';
const r=createRequire(process.cwd()+'/package.json');const a=r('@electron/asar');
const path=process.argv[1];const meta=JSON.parse(a.extractFile(path,'node_modules/node-pty/package.json').toString());
const js=a.extractFile(path,'node_modules/node-pty/lib/unixTerminal.js');
if(meta.name!=='node-pty'||meta.version!=='1.1.0'||!js.toString().includes('pty.resize(this._fd, cols, rows);'))throw Error('Original packaged1.1 JS resize contract missing');
const crypto=r('node:crypto');console.log(JSON.stringify({name:meta.name,version:meta.version,resizeNativeArgumentCount:3,jsSha256:crypto.createHash('sha256').update(js).digest('hex')}));'''
        asar_js = json.loads(subprocess.check_output([str(NODE), '--input-type=module', '-e', asar_script,
                                    str(app / 'resources/app.asar')], cwd=CLIENT / 'packages/desktop', env=env, text=True))
        with (app / 'zcode-preview').open('rb') as stream:
            header = stream.read(20)
        assert header[:4] == b'\x7fELF' and int.from_bytes(header[18:20], 'little') == 183
        fuse_script = '''import {createRequire} from 'node:module';
const r=createRequire(process.cwd()+'/package.json');
const b=createRequire(r.resolve('electron-builder'));
const a=createRequire(b.resolve('app-builder-lib'));
console.log(JSON.stringify(await a('@electron/fuses').getCurrentFuseWire(process.argv[1])));'''
        wire = json.loads(subprocess.check_output([str(NODE), '--input-type=module', '-e',
                                                  fuse_script, str(app / 'zcode-preview')],
                                                 cwd=CLIENT / 'packages/desktop', env=env, text=True))
        old_root = Path(json.loads((REPO / 'evidence/client-sqlite-clock-desktop-package-manifest-20261020.json').read_text())['root'])
        old_wire = json.loads(subprocess.check_output([str(NODE), '--input-type=module', '-e',
                                                      fuse_script, str(old_root / 'zcode-preview')],
                                                     cwd=CLIENT / 'packages/desktop', env=env, text=True))
        assert wire == old_wire, 'Original Linux fuse configuration must remain unchanged'
        after = {name: digest(CLIENT / name) for name in names}
        assert after == before
        manifest = {'root': str(app), 'target': 'linux-arm64', 'sourceCommit': head,
                    'sourceSha256': before, 'producerInputSnapshot': str(inputs),
                    'packagedNodePtyJs': asar_js, 'runtimeFiles': files, 'builderExitCode': 0,
                    'published': False, 'guiStarted': False, 'nativeRuntimeAccepted': False,
                    'fuseReadOnly': wire, 'fuseMatchesPreviousNormalLinux': True}
        path = REPO / 'evidence/client-linux-pty-wire-desktop-package-manifest-20261020.json'
        assert not path.exists()
        path.write_text(json.dumps(manifest, indent=2) + '\n')
        result.update(status='passed-directory-producer-only', manifestPath=str(path),
                      sourceSha256After=after, agentSha256After=digest(cli), stagedAgentSha256After=digest(staged))
    except BaseException as error:
        result['failure'] = {'type': type(error).__name__, 'message': str(error)[:1500]}
    finally:
        result['finishedAt'] = datetime.datetime.now().astimezone().isoformat()
        (EVIDENCE / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({key: result[key] for key in ['status', 'manifestPath', 'failure'] if key in result}))
    return result['status'] == 'passed-directory-producer-only'


if __name__ == '__main__':
    raise SystemExit(0 if main() else 1)
