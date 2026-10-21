// Read-only packaged input verification and finite plan. Never launches GUI.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadOwnedPackagedRuntime } from '../fixtures/native-packaged-runtime.mjs';
import { build } from 'esbuild';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const profile = process.argv[2];
assert.match(profile ?? '', /^client-native-macos-confirmation-[a-z0-9-]+$/);
const manifestPath = resolve(process.argv[3] ?? resolve(repo, 'evidence/client-macos-package-v7-manifest-20261020.json'));
const runtime = await loadOwnedPackagedRuntime(manifestPath, repo, {experience:'enabled', otherMode:false});
const manifest = JSON.parse(await readFile(manifestPath));
assert.equal(manifest.runtimeFiles['app.asar'].sha256, '2937a7ad223a9867e4bcf699e4074a39bad0ddcaa607bc296e3ff950f982a2e9');
assert.equal(manifest.runtimeFiles['glm/zcode.cjs'].sha256, 'cdf781ecf004b9639157fae25e6e96e558b95faefaee7aab09488d5dc650ecac');
assert.ok(manifest.sourceCommit.startsWith('1bd1ec7b'));
assert.equal(manifest.builderExitCode,0);
assert.equal(manifest.codesignExitCode,0);
const root = resolve(repo,'data/sandbox-verification',profile);
await mkdir(root,{mode:0o700});
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const entry=resolve(repo,'scripts/fixtures/client-native-enterprise.mjs');
const original=await readFile(entry,'utf8');
function once(source,needle,replacement){assert.equal(source.split(needle).length,2,'Expected exact single owned fixture boundary');return source.replace(needle,replacement);}
let contents=`import {createOwnedMacosUriLaunchers} from ${JSON.stringify(resolve(repo,'scripts/fixtures/native-macos-secondary-uri.mjs'))};\nlet ownedUriLaunchers;\n`+original;
contents=once(contents,'const rl = createInterface({ input: process.stdin });',`function getOwnedUriLaunchers(){
 if(!packagedRuntime||!experienceMode)throw Error('Original packaged experience fixture required');
 return ownedUriLaunchers??=createOwnedMacosUriLaunchers({
  executable:runtime.electron,cwd:appRoot,candidate:join(root,'确认 中文 空格'),
  primary:()=>electron,validate:path=>validateOwnedNativeWorkspace(root,path),
  environment:nativeEnvironment,emit:event=>console.log(JSON.stringify(event)),
 });
}
const rl = createInterface({ input: process.stdin });`);
contents=once(contents,'    } else if (c.op === "launch") await launch();',`    } else if(c.op==='ownedUriLaunch'){
      if(Object.keys(c).sort().join(',')!=='op,role')throw Error('Finite owned URI command required');
      const launch=await getOwnedUriLaunchers().launch(c.role);
      console.log(JSON.stringify({op:c.op,status:'done',launch}));return;
    } else if(c.op==='ownedUriStatus'){
      if(Object.keys(c).length!==1)throw Error('Finite owned URI status required');
      console.log(JSON.stringify({op:c.op,status:'done',launches:getOwnedUriLaunchers().status()}));return;
    } else if (c.op === "launch") await launch();`);
contents=once(contents,'  await attempt(stopNative);','  await attempt(()=>ownedUriLaunchers?.dispose());\n  await attempt(stopNative);');
const fixturePath=resolve(root,'fixture.mjs');
const external=Object.keys(JSON.parse(await readFile(resolve(repo,'package.json'))).dependencies);
await build({entryPoints:[entry],outfile:fixturePath,bundle:true,platform:'node',format:'esm',target:'node24',external,
 banner:{js:'import {createRequire as _probeRequire} from "node:module";const require=_probeRequire(import.meta.url);'},
 plugins:[{name:'owned-secondary-uri-only',setup(builder){builder.onLoad({filter:/\/scripts\/fixtures\/client-native-enterprise\.mjs$/},args=>{
   assert.equal(args.path,entry);return{contents,loader:'js',resolveDir:dirname(entry)};
 });}}],logLevel:'silent'});
assert.equal(await readFile(entry,'utf8'),original,'Shared fixture must remain unchanged');
const sources={};
for (const path of ['scripts/fixtures/client-native-enterprise.mjs','scripts/fixtures/native-packaged-runtime.mjs',
  'scripts/fixtures/native-owned-workspace.mjs','scripts/tests/macos-ax-driver.py','scripts/tests/native-os-state-guard.swift',
  'scripts/fixtures/native-macos-secondary-uri.mjs','scripts/fixtures/native-macos-secondary-uri.test.mjs',
  'scripts/tests/macos-confirmation-prepare.mjs','scripts/tests/macos-confirmation-probe.py',
  'scripts/tests/macos-confirmation-candidates.test.py',
  'clients/uwork/packages/desktop/src/main/desktopDeepLinkUrl.ts',
  'clients/uwork/packages/desktop/test/desktopSingleInstanceWire.test.ts',
  'clients/uwork/packages/desktop/test/externalWorkspaceConfirmation.fixture.mjs',
  'clients/uwork/packages/desktop/test/externalWorkspaceConfirmation.integration.mjs',
  'clients/uwork/specs/second-instance-native-confirmation.md',
  'clients/uwork/packages/desktop/src/main/desktopOAuthDeepLink.ts',
  'clients/uwork/packages/desktop/src/main/desktopSecondInstanceDeepLink.ts']) {
  sources[path]=sha(await readFile(resolve(repo,path)));
}
const productSourceSha256={};
for(const path of ['packages/desktop/src/main/desktopDeepLinkUrl.ts','packages/desktop/test/desktopSingleInstanceWire.test.ts',
  'packages/desktop/test/externalWorkspaceConfirmation.fixture.mjs','packages/desktop/test/externalWorkspaceConfirmation.integration.mjs',
  'specs/second-instance-native-confirmation.md']){
  const actual=sources['clients/uwork/'+path];
  assert.equal(actual,manifest.sourceSha256[path],'Reviewed package producer source must match');
  productSourceSha256[path]=actual;
}
const pty='app.asar.unpacked/node_modules/node-pty/prebuilds/darwin-arm64/pty.node';
assert.equal(sha(await readFile(resolve(runtime.appPath,'Contents/Resources',pty))),manifest.runtimeFiles[pty].sha256);
const plan={status:'prepared-not-run',profile,preparationRoot:root,runtime,manifestSha256:sha(await readFile(manifestPath)),
  appAsarSha256:manifest.runtimeFiles['app.asar'].sha256,agentSha256:manifest.runtimeFiles['glm/zcode.cjs'].sha256,
  productSourceSha256,allFiveRuntimeResourcesVerified:true,
  sources,fixturePath,compiledFixtureSha256:sha(await readFile(fixturePath)),sharedFixtureUnchanged:true,guiStarted:false,osStateReadOrChanged:false,
  primaryEntry:'Original isolated fixture launch',
  externalEntry:{executable:runtime.executable,argv:['zcode://workspace/open?path=<owned-encoded-path>'],
    environment:'Same fixture-private nativeEnvironment; no credential material recovered by controller'},
  thirdEntry:{executable:runtime.executable,argv:['zcode://unrecognized-owned-protocol-test']},
  baselineDirectory:'<fresh-fixture-root>/project 基线',candidateDirectory:'<fresh-fixture-root>/确认 中文 空格',
  dialogInput:'Existing macos-ax-driver exact owned Main PID + native sheet/frame + AXPress only',
  holdSeconds:25,parallelAtSeconds:8,secondaryDeadlineSeconds:10,
  prerequisite:'Original v6 frontend all owned resources closed; Root verifies this new v7 plan and grants unique Mac GUI window',
  hardStops:['No original handler to restore','AX permission/consent requirement','Cannot bind dialog to exact owned PID/frame',
    'Original second instance cannot receive URI through explicit binary','Any product Main replacement or timeout'],
  notClaimed:['Global scheme handler dispatch acceptance','Cold unparented NSAlert','WeCom/browser OAuth','Remote provider runtime','Any passed native test']};
await writeFile(resolve(root,'preparation.json'),JSON.stringify(plan,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify(plan));
