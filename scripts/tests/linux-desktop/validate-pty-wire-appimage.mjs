/** One fresh AppImage only: original payload and public modes, no application launch. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const execute = promisify(execFile);
const asar = createRequire('/opt/builder/package.json')('@electron/asar');
const expected = JSON.parse(await readFile('/input/expected.json', 'utf8'));
const artifact = '/packages/UWork Preview-3.16.0-linux-arm64.AppImage';
const facts = {status:'failed', scope:'one new AppImage payload; no GUI/FUSE or four-format claim', coreFiles:{}, publicRuntimePermissions:[]};
async function digest(path) {
  const hash = createHash('sha256');
  for await (const block of createReadStream(path)) hash.update(block);
  return {bytes:(await stat(path)).size, sha256:hash.digest('hex')};
}
try {
  assert.equal(expected.target, 'linux-arm64');
  assert.equal(expected.sourceCommit, '1a8f24cb0421a253b4ce720f059c9e800cf6d68d');
  assert.equal(Object.keys(expected.runtimeFiles).length, 5);
  facts.artifact = await digest(artifact);
  const runtime = '/tmp/owned-wire.AppImage';
  await copyFile(artifact, runtime);
  await chmod(runtime, 0o755);
  const header = (await readFile(runtime)).subarray(0,24);
  assert.equal(header.subarray(0,4).toString('hex'),'7f454c46');
  assert.equal(header.readUInt16LE(18),183);
  assert.equal(header.subarray(8,11).toString('hex'),'414902');
  facts.squashfsOffset = Number((await execute(runtime,['--appimage-offset'])).stdout.trim());
  assert.ok(facts.squashfsOffset > 0 && facts.squashfsOffset < facts.artifact.bytes);
  const extract = '/work/extract';
  await mkdir(extract);
  await execute(runtime,['--appimage-extract'],{cwd:extract,timeout:90000,maxBuffer:8*1024*1024});
  const root = join(extract,'squashfs-root');
  assert.equal((await stat(root)).mode & 0o005,0o005);
  for (const [name,value] of Object.entries(expected.runtimeFiles)) {
    const directories = [];
    const parts = name.split('/');
    for(let index=1;index<parts.length;index++) {
      const path = join(root,...parts.slice(0,index));
      const mode = (await stat(path)).mode & 0o777;
      assert.equal(mode & 0o005,0o005,'Public directory read/traverse: '+name);
      directories.push({path:parts.slice(0,index).join('/'),mode:mode.toString(8)});
    }
    const mode = (await stat(join(root,name))).mode & 0o777;
    assert.ok(mode & 0o004,'Public runtime file read: '+name);
    if(name==='zcode-preview')assert.ok(mode & 0o001,'Original executable public execute');
    facts.publicRuntimePermissions.push({name,mode:mode.toString(8),directories});
    facts.coreFiles[name] = await digest(join(root,name));
    assert.deepEqual(facts.coreFiles[name],value,'Original fresh directory payload: '+name);
  }
  const metadata=JSON.parse(asar.extractFile(join(root,'resources/app.asar'),'package.json'));
  assert.equal(metadata.version,'3.16.0');
  assert.equal(metadata.zcodeProductFlavor,'preview');
  const ptyMeta=JSON.parse(asar.extractFile(join(root,'resources/app.asar'),'node_modules/node-pty/package.json'));
  const ptyJs=asar.extractFile(join(root,'resources/app.asar'),'node_modules/node-pty/lib/unixTerminal.js').toString();
  assert.equal(ptyMeta.version,'1.1.0');
  assert.ok(ptyJs.includes('pty.resize(this._fd, cols, rows);'));
  assert.equal(facts.coreFiles['resources/app.asar.unpacked/node_modules/node-pty/prebuilds/linux-arm64/pty.node'].sha256,'c192e560428e778842fdbbe72f14032824b03373ed49ad3efcdbcf9eb249b75b');
  facts.packagedJsVersion=ptyMeta.version;facts.publicResizeNativeArgumentCount=3;
  facts.status='passed-single-AppImage-core-and-public-permissions';
} catch(error) {facts.failure=String(error);}
await writeFile('/work/result.json',JSON.stringify(facts,null,2)+'\n');
process.stdout.write(JSON.stringify({status:facts.status,failure:facts.failure})+'\n');
process.exitCode=facts.status==='passed-single-AppImage-core-and-public-permissions'?0:1;
