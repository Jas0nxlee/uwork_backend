// Only controlled supplier/control additions to the existing isolated fixture; product/Read/Host/RPC remain original.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const profile = process.argv[2];
assert.match(profile ?? "", /^client-linux-pending-read-[a-z0-9-]+$/);
const root = resolve(repo, "data/sandbox-verification", profile);
await mkdir(root, { mode: 0o700 });
await mkdir(resolve(root, "input"), { mode: 0o700 });
const entry = resolve(repo, "scripts/tests/linux-desktop/backend.mjs");
const original = await readFile(entry, "utf8");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function once(source, needle, replacement) {
  assert.equal(
    source.split(needle).length,
    2,
    "Require exactly one owned fixture boundary",
  );
  return source.replace(needle, replacement);
}
const preamble = `import {createHash as pendingHash} from "node:crypto";
const pendingCases = Object.fromEntries(["deny", "allow"].map(key => [key, {
  key, prompt: "OWNED_PENDING_READ_" + key.toUpperCase(),
  marker: "OWNED_PENDING_READ_" + key.toUpperCase() + "_FILE_BYTES_20261020",
  path: "/work/project/.pending-read/" + key + ".txt", callId: "owned-pending-read-" + key,
  issued: false, completed: false, requests: [],
}]));
const pendingAuthorizations = [], pendingPublications = [], pendingHolders = new Map();
const pendingText = message => typeof message.content === "string" ? message.content :
  Array.isArray(message.content) ? message.content.map(part => part.text ?? "").join("") : "";
function pendingSupplier(payload, res) {
  const messages = payload.messages ?? [], all = JSON.stringify(messages);
  const userIndex = messages.findLastIndex(message => message.role === "user");
  const user = userIndex >= 0 ? pendingText(messages[userIndex]) : "";
  const stage = Object.values(pendingCases).find(value => user.includes(value.prompt));
  const observed = {atMs: Date.now(), ordinal: calls, stream: !!payload.stream,
    denyMarker: all.includes(pendingCases.deny.marker), allowMarker: all.includes(pendingCases.allow.marker)};
  for (const value of Object.values(pendingCases)) value.requests.push({...observed});
  if (!payload.stream || !stage) return false;
  assert.ok(calls <= 8, "Bound actual supplier calls");
  const results = messages.slice(userIndex + 1).filter(message => message.role === "tool" && message.tool_call_id === stage.callId);
  let delta, finish;
  if (!results.length) {
    assert.equal(stage.issued, false, "Issue the real Read tool once per new path");
    assert.ok(payload.tools.some(tool => tool.function.name === "Read"));
    assert.equal(observed.denyMarker, false);
    assert.equal(observed.allowMarker, false);
    stage.issued = true; stage.issuedAtMs = Date.now(); stage.toolCount = payload.tools.length;
    delta = {role: "assistant", tool_calls: [{index: 0, id: stage.callId, type: "function", function: {name: "Read", arguments: JSON.stringify({file_path: stage.path})}}]};
    finish = "tool_calls";
  } else {
    assert.equal(stage.issued, true); assert.equal(stage.completed, false); assert.equal(results.length, 1);
    const text = pendingText(results[0]);
    stage.result = {atMs: Date.now(), bytes: Buffer.byteLength(text), sha256: pendingHash("sha256").update(text).digest("hex"),
      denied: text.includes("enterprise_filesystem_denied"), ownMarkerPresent: text.includes(stage.marker),
      errorCode: text.match(/enterprise_[a-z_]{1,80}/)?.[0] ?? null,
      handlerCompletedResultWithheld: text.includes("Read completed; content withheld (enterprise_filesystem_denied)"),
      denyMarkerPresent: all.includes(pendingCases.deny.marker), callId: results[0].tool_call_id};
    stage.completed = true;
    delta = {role: "assistant", content: "PENDING_READ_" + stage.key.toUpperCase() + "_COMPLETE"}; finish = "stop";
  }
  res.setHeader("content-type", "text/event-stream");
  res.write("data: " + JSON.stringify({choices: [{index: 0, delta, finish_reason: null}]}) + "\\n\\n");
  res.write("data: " + JSON.stringify({choices: [{index: 0, delta: {}, finish_reason: finish}], usage: {prompt_tokens: 12, completion_tokens: 10}}) + "\\n\\n");
  res.end("data: [DONE]\\n\\n"); return true;
}
`;
let contents = preamble + original;
contents = once(
  contents,
  'await promisify(execFile)("git", ["init", "--quiet", "/work/project"]);',
  'await promisify(execFile)("git", ["init", "--quiet", "/work/project"]);\nawait writeFile("/work/project/.gitignore", ".pending-read/\\n");',
);
contents = once(
  contents,
  "  calls++;",
  "  calls++;\n  if (pendingSupplier(payload, res)) return;",
);
contents = once(
  contents,
  'backendOrigin = await app.listen({ host: "127.0.0.1", port: 0 });',
  `app.addHook("onSend", async (req, reply, payload) => {
  if (req.url === "/api/client/authorize" && req.headers.authorization === "Bearer " + token) {
    const body = typeof payload === "string" ? JSON.parse(payload) : {};
    assert.ok(pendingAuthorizations.length < 256);
    pendingAuthorizations.push({atMs: Date.now(), status: reply.statusCode,
      filesystem: body.security?.allowFilesystem ?? null, originalMemberSession: true});
  }
  return payload;
});
backendOrigin = await app.listen({ host: "127.0.0.1", port: 0 });`,
);
const helpers = `
async function pendingPolicy(allowFilesystem) {
  const path = prefix + "/configurations/security";
  const current = await api(path);
  const saved = await api(path, "PUT", {revision: current.revision, data: {...current.published, allowFilesystem}});
  const published = await api(path + "/publish", "POST", {revision: saved.revision});
  const receipt = {atMs: Date.now(), allowFilesystem, revision: saved.revision,
    publishedSha256: pendingHash("sha256").update(JSON.stringify(published)).digest("hex")};
  pendingPublications.push(receipt); return receipt;
}
async function pendingState() {
  const holders = {};
  for (const [key, child] of pendingHolders) {
    try { holders[key] = {...JSON.parse(await readFile("/work/pending-read-lease-" + key + ".json", "utf8")), exitCode: child.exitCode}; }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  const cliWorkers = [];
  for (const name of await readdir("/proc")) {
    if (!/^\\d+$/.test(name)) continue;
    try {
      const exe = await readlink("/proc/" + name + "/exe");
      const cwd = await readlink("/proc/" + name + "/cwd");
      const status = await readFile("/proc/" + name + "/status", "utf8");
      if (!/^Uid:\\s+1000\\s+1000\\s+1000\\s+1000$/m.test(status)) continue;
      const workers = [];
      for (const tid of await readdir("/proc/" + name + "/task")) {
        try { workers.push({tid: Number(tid), wchan: (await readFile("/proc/" + name + "/task/" + tid + "/wchan", "utf8")).trim()}); } catch {}
      }
      cliWorkers.push({pid: Number(name), parentPid: Number(status.match(/^PPid:\\s+(\\d+)$/m)[1]),
        uid: status.match(/^Uid:\\s+([^\\n]+)/m)[1].trim(), capEff: status.match(/^CapEff:\\s+(\\S+)/m)[1],
        executable: exe, cwd, workers});
    } catch {}
  }
  return {holders, cliWorkers, cases: Object.fromEntries(Object.entries(pendingCases).map(([key, value]) => [key,
    {issued: value.issued, issuedAtMs: value.issuedAtMs, completed: value.completed,
      path: value.path, callId: value.callId, toolCount: value.toolCount, result: value.result, requests: value.requests}])),
    authorizations: pendingAuthorizations, publications: pendingPublications, proof: proof()};
}
async function pendingStopHolders() {
  for (const child of pendingHolders.values()) {
    if (child.exitCode !== null) continue;
    child.stdin.end(JSON.stringify({op: "shutdown"}) + "\\n");
    await Promise.race([new Promise(done => child.once("close", done)), new Promise(done => setTimeout(done, 3000))]);
    if (child.exitCode === null) { child.kill("SIGTERM"); await new Promise(done => child.once("close", done)); }
  }
}
`;
const controls = `
  if (req.method === "GET" && req.url === "/pending-read-state") { res.end(JSON.stringify(await pendingState())); return; }
  if (req.method === "POST" && ["/pending-read-policy-allow", "/pending-read-policy-deny"].includes(req.url)) {
    res.end(JSON.stringify(await pendingPolicy(req.url.endsWith("allow")))); return;
  }
  const command = req.url.match(/^\\/pending-read-(arm|unlock)-(deny|allow)$/);
  if (req.method === "POST" && command) {
    const [, op, key] = command;
    if (op === "arm") {
      assert.equal(pendingHolders.has(key), false);
      const child = spawn("python3", ["/opt/backend/probe/pending-read-lease.py", "--case", key], {stdio: ["pipe", "pipe", "inherit"]});
      child.stdout.resume(); pendingHolders.set(key, child);
      const until = Date.now() + 3000;
      while (Date.now() < until) { const state = await pendingState(); if (state.holders[key]?.acquired) { res.end(JSON.stringify(state.holders[key])); return; }
        assert.equal(child.exitCode, null, "Owned lease helper must start"); await new Promise(done => setTimeout(done, 20)); }
      throw Error("Owned regular-file lease did not start");
    }
    const child = pendingHolders.get(key); assert.ok(child && child.exitCode === null);
    child.stdin.write(JSON.stringify({op: "unlock"}) + "\\n");
    const until = Date.now() + 1000;
    while (Date.now() < until) { const state = await pendingState(); if (state.holders[key]?.released) { res.end(JSON.stringify(state.holders[key])); return; }
      await new Promise(done => setTimeout(done, 10)); }
    throw Error("Owned lease did not release");
  }
`;
contents = once(
  contents,
  'const control = createServer(async (req, res) => {\n  res.setHeader("content-type", "application/json");',
  helpers +
    '\nconst control = createServer(async (req, res) => {\n  res.setHeader("content-type", "application/json");\n  try {' +
    controls,
);
contents = once(
  contents,
  '    res.writeHead(404).end("{}");\n  }\n});\nawait new Promise((resolve) => control.listen',
  '    res.writeHead(404).end("{}");\n  }\n  } catch (error) {\n    await writeFile("/work/pending-read-control-error.json", JSON.stringify({kind: error.name, message: error.message.slice(0, 1000)}), {mode: 0o600});\n    if (!res.headersSent) res.writeHead(500);\n    res.end(JSON.stringify({error: "owned_pending_read_control_failed"}));\n  }\n});\nawait new Promise((resolve) => control.listen',
);
contents = once(
  contents,
  "desktop = spawn(",
  "await pendingPolicy(true);\ndesktop = spawn(",
);
contents = once(
  contents,
  '  await writeFile(\n    "/work/backend-final-proof.json",',
  '  await pendingStopHolders();\n  await writeFile("/work/pending-read-final-state.json", JSON.stringify(await pendingState(), null, 2), {mode: 0o600, flush: true});\n  await writeFile(\n    "/work/backend-final-proof.json",',
);
const outfile = resolve(root, "input/backend.mjs");
const deps = Object.keys(
  JSON.parse(await readFile(resolve(repo, "package.json"), "utf8"))
    .dependencies,
);
await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  external: deps,
  banner: {
    js: 'import {createRequire as _pendingRequire} from "node:module"; const require=_pendingRequire(import.meta.url);',
  },
  plugins: [
    {
      name: "owned-pending-read-fixture-boundaries",
      setup(builder) {
        builder.onLoad(
          { filter: /\/scripts\/tests\/linux-desktop\/backend\.mjs$/ },
          (args) => {
            assert.equal(args.path, entry);
            return { contents, loader: "js", resolveDir: dirname(entry) };
          },
        );
      },
    },
  ],
});
await writeFile(
  resolve(root, "input/entry.sh"),
  await readFile(resolve(repo, "scripts/tests/linux-desktop/entry.sh")),
  { mode: 0o600 },
);
await writeFile(
  resolve(root, "input/pending-read-lease.py"),
  await readFile(
    resolve(repo, "scripts/tests/linux-desktop/pending-read-lease.py"),
  ),
  { mode: 0o600 },
);
assert.equal(
  await readFile(entry, "utf8"),
  original,
  "Shared fixture stays unchanged",
);
const preparation = {
  status: "prepared-not-run",
  profile,
  root,
  sourceFixtureSha256: hash(original),
  preparationSha256: hash(await readFile(fileURLToPath(import.meta.url))),
  compiledFixtureSha256: hash(await readFile(outfile)),
  leaseHelperSha256: hash(
    await readFile(resolve(root, "input/pending-read-lease.py")),
  ),
  sharedFixtureUnchanged: true,
  productSourcesRewritten: false,
  boundary:
    "Original isolated fixture plus bounded supplier Read and public backend publication/own regular-file lease control; no GUI run",
};
await writeFile(
  resolve(root, "preparation.json"),
  JSON.stringify(preparation, null, 2) + "\n",
  { mode: 0o600 },
);
console.log(JSON.stringify(preparation));
