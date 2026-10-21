// Assemble real producer outputs into the existing remote CDN contract.
// --stage only copies/extracts; --pack is a separate scheduled compression step.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, cp, access, rename } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { computeComponentSourceSha256, packComponentSourceAsArchive,
  buildContentAddressedComponentVersion, buildComponentArtifactRelativePath } from '../../../clients/uwork/scripts/prepare-prebuilds.mjs';
import { stageThirdPartyNotices, stageNodeNotices } from '../../../clients/uwork/scripts/third-party-notices.mjs';
import { REMOTE_AGENT_OFFICIAL_PLUGIN_REQUIRED_RELATIVE_PATHS } from '../../../clients/uwork/packages/server/src/remote/zcodeAgentOfficialPluginAssets.ts';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const file = resolve(process.argv[2] ?? '');
const mode = process.argv[3];
assert.ok(['--stage', '--pack'].includes(mode));
const prep = JSON.parse(await readFile(file));
assert.match(prep.profile, /^client-linux-remote-selector-[a-z0-9-]+$/);
const root = resolve(repo, 'data/sandbox-verification', prep.profile);
assert.equal(root, prep.root);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const stage = resolve(root, 'remote-source');
const cdn = resolve(root, 'cdn');
const client = resolve(repo, 'clients/uwork');
const components = [
  {id:'server-bundle', prefix:'3.16.0', mount:'server'},
  {id:'node-runtime', prefix:'24.14.0', mount:'node/linux-arm64'},
  {id:'node-pty', prefix:'1.2.0-beta.10', mount:'node-pty/linux-arm64'},
  {id:'glm', prefix:'3.16.0', mount:'glm/linux-arm64'},
  {id:'bfs', prefix:'owned-debian', mount:'tools/linux-arm64/bfs'},
  {id:'ripgrep', prefix:'owned-debian', mount:'tools/linux-arm64/ripgrep'},
  {id:'ugrep', prefix:'owned-debian', mount:'tools/linux-arm64/ugrep'},
];
const docker = args => execFileSync('docker', ['--context', 'colima-uwork-backend', ...args], {encoding:'utf8', maxBuffer:1024*1024, timeout:30000});
if (mode === '--stage') {
  await mkdir(stage); // Never overwrite a previous stage.
  for (const {mount} of components) await mkdir(resolve(stage,mount), {recursive:true});
  assert.equal(sha(await readFile(prep.server.archive)), prep.server.archiveSha256);
  const archivePrefix = 'zcode-server-linux-arm64/runtime/';
  const extracted = resolve(root, 'server-runtime-input');
  await mkdir(extracted);
  execFileSync('tar', ['-xzf', prep.server.archive, '-C', extracted, '--strip-components=2',
    ...['node','zcode.cjs','packages','LICENSE.node.txt','NODE-SOURCES.json'].map(name=>archivePrefix+name)], {timeout:30000});
  for (const [source,target] of [['node','node/linux-arm64/node'], ['zcode.cjs','glm/linux-arm64/zcode.cjs'], ['packages','glm/linux-arm64/packages']])
    await cp(resolve(extracted,source), resolve(stage,target), {recursive:true});
  for (const name of ['node','zcode.cjs'])
    assert.equal(sha(await readFile(resolve(extracted,name))), prep.server.runtimeFiles['runtime/'+name].sha256);
  for (const path of REMOTE_AGENT_OFFICIAL_PLUGIN_REQUIRED_RELATIVE_PATHS)
    await access(resolve(stage,'glm/linux-arm64/packages',path));
  await cp(resolve(client,'packages/server/dist/remote/zcode-server.cjs'),resolve(stage,'server/zcode-server.cjs'));
  await cp(resolve(client,'node_modules/@lydell/node-pty-linux-arm64/prebuilds/linux-arm64/pty.node'),resolve(stage,'node-pty/linux-arm64/pty.node'));
  const image = docker(['image','inspect','--format','{{.Id}}','uwork-remote-dependencies:node24.14.0-live-20261017']).trim();
  assert.equal(image,'sha256:649b14f1a44859835730c0f2da748279571222ef0cc392c13231e10676762bae');
  const name = 'uwork-selector-assets-'+randomUUID().slice(0,12);
  let container, dependencyContainerRemoved = false;
  try {
    container=docker(['create','--name',name,'--network','none','--label','uwork-probe-owner='+prep.profile,image,'/bin/true']).trim();
    for (const [from,to] of [['/usr/bin/bfs','bfs/bfs'],['/usr/bin/rg','ripgrep/rg'],['/usr/bin/ugrep','ugrep/ugrep']])
      docker(['cp',container+':'+from,resolve(stage,'tools/linux-arm64',to)]);
  } finally {
    if(container) docker(['rm',container]);
    try { docker(['container','inspect',name]); }
    catch(error) { assert.equal(error.status,1); dependencyContainerRemoved=true; }
  }
  assert.ok(dependencyContainerRemoved);
  for(const {mount} of components) await stageThirdPartyNotices(resolve(stage,mount),client);
  await stageNodeNotices(resolve(stage,'node/linux-arm64'),'24.14.0',client);
  const records = {};
  for(const path of ['server/zcode-server.cjs','node/linux-arm64/node','node-pty/linux-arm64/pty.node','glm/linux-arm64/zcode.cjs',
    'tools/linux-arm64/bfs/bfs','tools/linux-arm64/ripgrep/rg','tools/linux-arm64/ugrep/ugrep']) {
    const bytes=await readFile(resolve(stage,path)); records[path]={bytes:bytes.length,sha256:sha(bytes)};
  }
  const receipt={status:'staged-not-packed',stage,cdn,serverArchiveSha256:prep.server.archiveSha256,
    remoteStdioProducer:'pnpm --filter @zcode/server build:remote',
    remoteStdioProducerSourceSha256:sha(await readFile(resolve(client,'packages/server/build-remote.ts'))),
    dependencyImageId:image,dependencyContainerRemoved,records};
  await writeFile(resolve(root,'remote-asset-stage.json'),JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify({status:receipt.status,stage,cdn,records}));
} else {
  const receipt=JSON.parse(await readFile(resolve(root,'remote-asset-stage.json')));
  assert.equal(receipt.status,'staged-not-packed');
  for(const [path,record] of Object.entries(receipt.records)) assert.equal(sha(await readFile(resolve(stage,path))),record.sha256);
  await mkdir(cdn);
  const entries=[];
  for(const {id,prefix,mount} of components) {
    const source=resolve(stage,mount), temp=resolve(cdn,id+'.tar.gz');
    packComponentSourceAsArchive(source,temp);
    const digest=sha(await readFile(temp));
    const version=buildContentAddressedComponentVersion(prefix,digest);
    const artifactPath=buildComponentArtifactRelativePath('linux-arm64',id,version);
    await mkdir(dirname(resolve(cdn,artifactPath)),{recursive:true});
    await rename(temp,resolve(cdn,artifactPath));
    entries.push({id,version,sha256:digest,sourceSha256:computeComponentSourceSha256(source),artifactPath,mount});
  }
  await mkdir(resolve(cdn,'3.16.0'));
  const manifest={schemaVersion:1,appVersion:'3.16.0',platformArch:'linux-arm64',components:entries};
  await writeFile(resolve(cdn,'3.16.0/manifest-linux-arm64.json'),JSON.stringify(manifest,null,2)+'\n');
  console.log(JSON.stringify({status:'packed-not-run',cdn,manifest}));
}
