import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";

const exec = promisify(execFile);
const context = process.env.UWORK_DOCKER_CONTEXT ?? "colima-uwork-backend";
const image = process.env.UWORK_DOCKER_IMAGE ?? "uwork-backend:local";
const owner = randomUUID(),
  name = `uwork-verification-${owner.slice(0, 8)}`,
  volume = `${name}-data`;
const docker = async (args: string[]) => {
  const r = await exec("docker", ["--context", context, ...args], {
    env: { ...process.env, MASTER_KEY: masterKey },
    maxBuffer: 2 * 1024 * 1024,
  });
  return r.stdout.trim();
};
const masterKey = randomBytes(32).toString("hex");
const label = "uwork.verification-owner";
const common = [
  "--read-only",
  "--cap-drop=ALL",
  "--security-opt=no-new-privileges:true",
  "--tmpfs",
  "/tmp:size=64m",
  "--env",
  "MASTER_KEY",
  "--env",
  "PUBLIC_URL=http://localhost:3001",
  "--env",
  "DATABASE_PATH=/app/data/uwork.sqlite",
  "--mount",
  `type=volume,source=${volume},target=/app/data`,
];
const readiness = async () => {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch("http://localhost:3001/health", {
        signal: AbortSignal.timeout(1000),
      });
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Container did not become ready");
};
const applicationCheck = String.raw`
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const values=Object.fromEntries((await readFile('/app/data/bootstrap-credentials.txt','utf8')).trim().split('\n').map(s=>{const i=s.indexOf(': ');return[s.slice(0,i),s.slice(i+2)];}));
const login=await fetch('http://127.0.0.1:3000/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:values.Email,password:values.Password})});assert.equal(login.status,200);
const token=(await login.json()).token;const headers={authorization:'Bearer '+token,'content-type':'application/json'};const p='/api/tenants/'+values['Tenant ID'];
if(process.argv[1]==='restore'){
 const state=JSON.parse(await readFile('/app/data/verification-state.json','utf8'));
 const departments=await fetch('http://127.0.0.1:3000'+p+'/departments',{headers});assert.ok((await departments.json()).some(d=>d.id===state.department));
 const snapshot=await fetch('http://127.0.0.1:3000/api/client/configuration',{headers});const data=await snapshot.json();assert.equal(data.configuration['new-chat'].welcome,'Container persistence verified');assert.equal(data.versions['new-chat'],1);
}else{
 const department=await fetch('http://127.0.0.1:3000'+p+'/departments',{method:'POST',headers,body:JSON.stringify({name:'Container Verification'})});assert.equal(department.status,201);const d=await department.json();
 const config=await fetch('http://127.0.0.1:3000'+p+'/configurations/new-chat',{method:'PUT',headers,body:JSON.stringify({revision:0,data:{welcome:'Container persistence verified',riskNotice:'Verify important information.'}})});assert.equal(config.status,200);const c=await config.json();
 const publish=await fetch('http://127.0.0.1:3000'+p+'/configurations/new-chat/publish',{method:'POST',headers,body:JSON.stringify({revision:c.revision})});assert.equal(publish.status,200);
 await writeFile('/app/data/verification-state.json',JSON.stringify({department:d.id}),{mode:0o600});
}
console.log('application-check-passed');
`;
let createdVolume = false,
  createdContainer = false;
try {
  await docker(["volume", "create", "--label", `${label}=${owner}`, volume]);
  createdVolume = true;
  await docker([
    "run",
    "--rm",
    "--label",
    `${label}=${owner}`,
    ...common,
    image,
    "node",
    "dist/cli.js",
    "init",
  ]);
  await docker([
    "run",
    "--detach",
    "--name",
    name,
    "--label",
    `${label}=${owner}`,
    ...common,
    "--publish",
    "127.0.0.1:3001:3000",
    image,
  ]);
  createdContainer = true;
  await readiness();
  await docker([
    "exec",
    name,
    "node",
    "--input-type=module",
    "-e",
    applicationCheck,
  ]);
  const details = JSON.parse(await docker(["inspect", name]))[0];
  assert.equal(details.Config.User, "node");
  assert.equal(details.HostConfig.ReadonlyRootfs, true);
  assert.ok(details.HostConfig.CapDrop.includes("ALL"));
  await docker(["restart", "--time", "10", name]);
  await readiness();
  await docker([
    "exec",
    name,
    "node",
    "--input-type=module",
    "-e",
    applicationCheck,
    "restore",
  ]);
  const report = {
    context,
    image,
    imageId: details.Image,
    nonRoot: true,
    readOnlyRoot: true,
    capabilitiesDropped: true,
    applicationFlow: true,
    restartPersistence: true,
    defaultDockerContext: await exec("docker", ["context", "show"]).then((r) =>
      r.stdout.trim(),
    ),
  };
  await mkdir("evidence", { recursive: true });
  await writeFile(
    "evidence/docker-smoke.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  if (createdContainer) {
    const info = JSON.parse(await docker(["inspect", name]))[0];
    assert.equal(info.Config.Labels[label], owner);
    await docker(["rm", "--force", name]);
  }
  if (createdVolume) {
    const info = JSON.parse(await docker(["volume", "inspect", volume]))[0];
    assert.equal(info.Labels[label], owner);
    await docker(["volume", "rm", volume]);
  }
}
