"""Normal no-runtime-assets Mac producer, isolated output; no GUI or publication."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import plistlib
import subprocess

REPO=Path(__file__).resolve().parents[2]
CLIENT=REPO/'clients/uwork'
NODE=Path('/Users/ljp/.cache/uwork-client-toolchain/node-v24.14.0-darwin-arm64/bin/node')
PNPM='/Users/ljp/.local/share/dsh-tools/node_modules/.bin/pnpm'
OUT=Path('/Users/ljp/Library/Caches/uwork-backend/client-macos-package-20261020-v7-wire')
EVIDENCE=REPO/'evidence/client-macos-wire-package-v7-20261020'
CDF='cdf781ecf004b9639157fae25e6e96e558b95faefaee7aab09488d5dc650ecac'

def digest(path):
    with path.open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()

def main():
    assert not OUT.exists() and not EVIDENCE.exists(),'Fresh normal producer output required'
    cli=CLIENT/'apps/zcode-cli/packages/cli/dist/zcode.cjs'
    assert digest(cli)==CDF
    head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=REPO,text=True).strip()
    assert head.startswith('1bd1ec7b'),'Build only the reviewed committed wire source'
    source_paths=['packages/desktop/src/main/desktopDeepLinkUrl.ts','packages/desktop/test/desktopSingleInstanceWire.test.ts',
      'packages/desktop/test/externalWorkspaceConfirmation.fixture.mjs','packages/desktop/test/externalWorkspaceConfirmation.integration.mjs',
      'specs/second-instance-native-confirmation.md','packages/desktop/electron-builder.config.js']
    before={path:digest(CLIENT/path) for path in source_paths}
    EVIDENCE.mkdir(mode=0o700)
    prefixes=('ZCODE_','UWORK_','ELECTRON_','BU_','BH_','BROWSER_','NODE_OPTIONS','NODE_PATH','CSC_','APPLE_')
    env={key:value for key,value in os.environ.items() if not key.startswith(prefixes)}
    env.update(PATH=f'{NODE.parent}:{CLIENT}/node_modules/.bin:{Path(PNPM).parent}:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin',
      ZCODE_ENV='production',ZCODE_PREVIEW_IDENTITY='1',ZCODE_TARGET_OS='darwin',ZCODE_TARGET_ARCH='arm64',
      ZCODE_MAC_ADHOC_SIGN='1',ZCODE_DESKTOP_DIST_DIR=str(OUT),
      NODE_OPTIONS='--import '+str(REPO/'evidence/client-live-20261017/build-env-guard.mjs'))
    result={'status':'failed','sourceCommit':head,'output':str(OUT),'commands':[],
      'sourceSha256Before':before,'agentSha256Before':CDF,'startedAt':datetime.datetime.now().astimezone().isoformat()}
    try:
        for label,cwd,args in [('desktop-build',CLIENT,[PNPM,'--filter','@zcode/desktop','build:no-runtime-assets']),
          ('native-package',CLIENT/'packages/desktop',[PNPM,'exec','electron-builder','--config','electron-builder.config.js','--mac','--arm64','--dir','--publish','never'])]:
            with (EVIDENCE/(label+'.log')).open('w') as log:
                code=subprocess.run(args,cwd=cwd,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=600).returncode
            result['commands'].append({'label':label,'command':args,'cwd':str(cwd),'exitCode':code})
            assert code==0,label+' failed; preserve original output'
        app=OUT/'mac-arm64/UWork Preview.app'
        with (EVIDENCE/'codesign.log').open('w') as log:
            code=subprocess.run(['codesign','--verify','--deep','--strict',str(app)],stdout=log,stderr=subprocess.STDOUT,timeout=60).returncode
        result['codesignExitCode']=code
        assert code==0,'Original builder signature required; never hand-sign an old package'
        plist=plistlib.loads((app/'Contents/Info.plist').read_bytes())
        assert plist['CFBundleIdentifier']=='dev.zcode.app.preview' and plist['CFBundleShortVersionString']=='3.16.0'
        resources={}
        for path in ['app.asar','glm/zcode.cjs','config/provider/zcode-builtin.json','macos-window-bounds/zcode-window-bounds',
          'app.asar.unpacked/node_modules/node-pty/prebuilds/darwin-arm64/pty.node']:
            actual=app/'Contents/Resources'/path
            resources[path]={'bytes':actual.stat().st_size,'sha256':digest(actual)}
        assert resources['glm/zcode.cjs']['sha256']==CDF and digest(cli)==CDF
        manifest={'appPath':str(app),'builderExitCode':0,'codesignExitCode':0,'bundleIdentifier':plist['CFBundleIdentifier'],
          'version':plist['CFBundleShortVersionString'],'sourceCommit':head,'sourceSha256':before,'runtimeFiles':resources,
          'published':False,'notarized':False,'signing':'original builder ad-hoc'}
        path=REPO/'evidence/client-macos-package-v7-manifest-20261020.json'
        assert not path.exists(),'Do not overwrite immutable manifest'
        path.write_text(json.dumps(manifest,indent=2)+'\n')
        result['manifestPath']=str(path)
        after={path:digest(CLIENT/path) for path in source_paths}
        assert after==before,'Reviewed producer inputs changed during build'
        result.update(sourceSha256After=after,agentSha256After=digest(cli),status='passed')
    except BaseException as error:
        result['failure']={'type':type(error).__name__,'message':str(error)[:1500]}
    finally:
        result['finishedAt']=datetime.datetime.now().astimezone().isoformat()
        (EVIDENCE/'result.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({key:result[key] for key in ['status','manifestPath','failure'] if key in result}))
    return result['status']=='passed'

if __name__=='__main__':raise SystemExit(0 if main() else 1)
