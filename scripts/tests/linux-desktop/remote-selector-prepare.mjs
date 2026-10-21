// Owned test setup only. No product patches, remote commands, or GUI startup.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, cp } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const profile = process.argv[2];
assert.match(profile ?? '', /^client-linux-remote-selector-[a-z0-9-]+$/);
const root = resolve(repo, 'data/sandbox-verification', profile);
const input = resolve(root, 'input');
const target = resolve(root, 'target');
await mkdir(root, { mode: 0o700 }); // Refuse reuse of a previous GUI profile or key.
await mkdir(input, { mode: 0o700 });
await mkdir(target, { mode: 0o700 });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const original = resolve(repo, 'scripts/tests/linux-desktop/backend.mjs');
const deps = Object.keys(JSON.parse(await readFile(resolve(repo, 'package.json'), 'utf8')).dependencies);
const result = await build({ entryPoints: [original], bundle: true,
  platform: 'node', target: 'node24', format: 'esm',
  outfile: resolve(input, 'backend.mjs'), external: deps,
  banner: { js: 'import {createRequire as _probeRequire} from "node:module"; const require=_probeRequire(import.meta.url);' },
  absWorkingDir: repo, logLevel: 'silent' });
assert.equal(result.errors.length, 0);
await cp(resolve(repo, 'scripts/tests/linux-desktop/entry.sh'), resolve(input, 'entry.sh'));
const key = resolve(root, 'id_rsa');
execFileSync('/usr/bin/ssh-keygen', ['-q', '-t', 'rsa', '-b', '2048', '-m', 'PEM', '-N', '', '-f', key], { stdio: 'ignore' });
await cp(key + '.pub', resolve(target, 'authorized_keys'));
const fingerprint = execFileSync('/usr/bin/ssh-keygen', ['-lf', key + '.pub'], { encoding: 'utf8' }).trim();
await writeFile(resolve(target, 'Dockerfile'), `FROM uwork-remote-dependencies:node24.14.0-live-20261017
USER root
RUN apt-get update && apt-get install -y --no-install-recommends openssh-server procps ca-certificates && rm -rf /var/lib/apt/lists/* && usermod -p '*' node
COPY sshd_config /etc/ssh/sshd_config
COPY start.sh /owned-start.sh
COPY cdn.mjs /owned-cdn.mjs
ENTRYPOINT ["/bin/sh", "/owned-start.sh"]
`);
await writeFile(resolve(target, 'sshd_config'), `Port 2222
ListenAddress 0.0.0.0
HostKey /run/owned-ssh/hostkey
PidFile /run/owned-ssh/sshd.pid
AuthorizedKeysFile .ssh/authorized_keys
AuthenticationMethods publickey
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
AllowUsers node
UsePAM no
StrictModes yes
AllowTcpForwarding no
X11Forwarding no
PermitTunnel no
Subsystem sftp internal-sftp
LogLevel VERBOSE
`);
await writeFile(resolve(target, 'start.sh'), `#!/bin/sh
set -eu
mkdir -p /run/sshd /run/owned-ssh /home/node/.ssh /home/node/selector-owned/child /home/node/selector-owned/.hidden-child
cp /owned-key.pub /home/node/.ssh/authorized_keys
chown -R 1000:1000 /home/node
chmod 700 /home/node/.ssh
chmod 600 /home/node/.ssh/authorized_keys
ssh-keygen -q -t ed25519 -N '' -f /run/owned-ssh/hostkey
ssh-keygen -lf /run/owned-ssh/hostkey.pub >&2
node /owned-cdn.mjs &
exec /usr/sbin/sshd -D -e
`);
await writeFile(resolve(target, 'cdn.mjs'), `import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
const base='/cdn';
createServer(async(req,res)=>{
 let path;
 try { path=resolve(base,'.'+decodeURIComponent(new URL(req.url,'http://owned').pathname));
  if(req.method!=='GET'||!path.startsWith(base+sep)||!(await stat(path)).isFile()) throw Error('scope');
  const bytes=await readFile(path); res.writeHead(200,{'content-length':bytes.length}); res.end(bytes);
  console.error(JSON.stringify({ownedStaticAsset:req.url,status:200,bytes:bytes.length}));
 }catch{res.writeHead(404).end(); console.error(JSON.stringify({ownedStaticAsset:req.url,status:404}));}
}).listen(8080,'0.0.0.0');
`);
// Server CLI/Core is a distinct HTTP product. It may supply Node+Agent bytes,
// but it must never be renamed to masquerade as entry-stdio's server bundle.
const server = JSON.parse(await readFile(resolve(repo, 'evidence/client-sqlite-clock-normal-server-provenance-20261020.json')));
const desktop = JSON.parse(await readFile(resolve(repo, 'evidence/client-sqlite-clock-native-inputs-20261020.json')));
const sources = {};
for (const path of [original,
  'clients/uwork/packages/server/src/remote/sshAuth.ts',
  'clients/uwork/packages/server/src/remote/connect.ts',
  'clients/uwork/packages/server/src/remote/deploy.ts',
  'clients/uwork/packages/ui/src/DirectoryBrowser.tsx',
  'clients/uwork/packages/ui/src/SSHDialog.tsx',
  'clients/uwork/packages/desktop/src/main/desktopRuntimeEnv.ts']) {
  sources[path] = sha(await readFile(resolve(repo, path)));
}
const preparation = {
  status: 'prepared-not-run', profile, root, input, target,
  compiledFixtureSha256: sha(await readFile(resolve(input, 'backend.mjs'))),
  clientKeyPath: key, clientPublicFingerprint: fingerprint,
  desktop, server, sources,
  assetContract: {
    originalEntry: 'ZCODE_REMOTE_ASSET_CDN_BASE_URL',
    originalStrategy: 'local-download-upload',
    requiredComponents: ['server-bundle','node-runtime','node-pty','glm','bfs','ripgrep','ugrep'],
    stdioProducer: 'pnpm --filter @zcode/server build:remote',
    stdioEntry: 'clients/uwork/packages/server/src/entry-stdio.ts',
    stdioArtifact: 'clients/uwork/packages/server/dist/remote/zcode-server.cjs',
    manifest: 'manifest-linux-arm64.json',
    stageStatus: 'not-yet-staged',
  },
  scope: 'Original Native SSH selector into owned Docker target; system.info and file.readdir before project selection; cancel and reconnect',
  gaps: ['No native known_hosts/hostVerifier implementation exists in current sshAuth.ts',
    'This does not accept managed remote execution or remote model/command capability'],
};
await writeFile(resolve(root, 'preparation.json'), JSON.stringify(preparation, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify(preparation));
