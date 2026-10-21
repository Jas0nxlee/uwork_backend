// 仅扩展既有隔离测试 fixture 的传输/控制边界；不改共享 fixture 或客户端产品代码。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const profile = process.argv[2];
assert.match(profile ?? "", /^client-linux-gateway-mounted-[a-z0-9-]+$/);
const mode = process.argv[3] ?? "server-rejection";
assert.ok(["server-rejection", "natural-expiry"].includes(mode));
const root = resolve(repo, "data/sandbox-verification", profile);
await mkdir(root, { mode: 0o700 });
await mkdir(resolve(root, "input"), { mode: 0o700 });
const entry = resolve(repo, "scripts/tests/linux-desktop/backend.mjs");
const gatePath = resolve(
  repo,
  "scripts/fixtures/native-gateway-usage-hold.mjs",
);
const original = await readFile(entry, "utf8");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function replaceOnce(source, needle, replacement) {
  assert.equal(
    source.split(needle).length,
    2,
    "Expected one exact owned fixture boundary",
  );
  return source.replace(needle, replacement);
}
let contents =
  `import {createNativeGatewayUsageHold} from ${JSON.stringify(gatePath)};
const gatewayHold = createNativeGatewayUsageHold();
const gatewayResponses = [];
let gatewayServerSessionRevoked = false;
let gatewayServerLogoutStatus = null;
` + original;
if (mode === "natural-expiry") {
  contents =
    `import {issueSession as issueGatewayExpirySession} from ${JSON.stringify(resolve(repo, "src/identity.ts"))};\n` +
    contents;
  contents = replaceOnce(
    contents,
    `const token = (
  await api(
    "/api/auth/login",
    "POST",
    { email: "linux-member@example.test", password: memberPassword },
    undefined,
  )
).token;`,
    `// 用原签发者的正式TTL参数建立隔离会话，me与Host恢复均读取同一真实到期时间。
const token = issueGatewayExpirySession(app.services.db, member.id, owner.tenantId, "session", ["execute"], 60000).token;`,
  );
}
contents = replaceOnce(
  contents,
  "    const target = new URL(req.url, backendOrigin);",
  "    const gatewayRequestStartedAtMs = Date.now();\n    const target = new URL(req.url, backendOrigin);",
);
contents = replaceOnce(
  contents,
  "        res.writeHead(reply.statusCode, reply.headers);\n        reply.pipe(res);",
  `        if (req.method === "GET" && ["/api/client/entitlement", "/api/client/usage"].includes(target.pathname)) {
          assert.ok(gatewayResponses.length < 32, "Owned Gateway observation bound exceeded");
          gatewayResponses.push({path: target.pathname + target.search, status: reply.statusCode, afterServerLogout: gatewayServerSessionRevoked});
        }
        const deliver = () => {
          if (res.destroyed) { reply.destroy(); return; }
          res.writeHead(reply.statusCode, reply.headers);
          reply.pipe(res);
        };
        if (!gatewayHold.hold(req, res, reply, deliver, gatewayRequestStartedAtMs)) deliver();`,
);
const controls = `
  if (req.method === "GET" && req.url === "/gateway-identity-record") {
    const record = await store.read();
    res.end(JSON.stringify({revision: record.revision, sessionPresent: record.session !== null,
      expiresAtMatchesIssuer: record.session?.expiresAt === me.expiresAt}));
    return;
  }
  if (req.method === "GET" && req.url === "/gateway-state") {
    res.end(JSON.stringify(gatewayState()));
    return;
  }
  if (req.method === "POST" && req.url === "/gateway-arm") {
    res.end(JSON.stringify(gatewayHold.command({op: "armGatewayUsageHold"})));
    return;
  }
  if (req.method === "POST" && req.url === "/gateway-release") {
    res.end(JSON.stringify(gatewayHold.command({op: "releaseGatewayUsageHold"})));
    return;
  }
  if (req.method === "POST" && req.url === "/gateway-revoke-session") {
    assert.equal(${JSON.stringify(mode)}, "server-rejection", "Natural expiry cannot call a logout substitute");
    assert.equal(gatewayServerSessionRevoked, false, "Revoke only this test session once");
    const response = await fetch(backendOrigin + "/api/auth/logout", {
      method: "POST", headers: {authorization: "Bearer " + token, "content-type": "application/json"},
      body: JSON.stringify({revokeDevices: false}), signal: AbortSignal.timeout(5000),
    });
    gatewayServerLogoutStatus = response.status;
    assert.equal(response.status, 204);
    gatewayServerSessionRevoked = true;
    res.end(JSON.stringify({revoked: true, status: response.status}));
    return;
  }
`;
contents = replaceOnce(
  contents,
  'const control = createServer(async (req, res) => {\n  res.setHeader("content-type", "application/json");',
  `function gatewayState() {
  return {hold: gatewayHold.command({op: "gatewayUsageHoldStatus"}),
    mode: ${JSON.stringify(mode)}, sessionExpiresAt: me.expiresAt,
    sessionRemainingMs: me.expiresAt - Date.now(), observedAtMs: Date.now(),
    serverSessionRevoked: gatewayServerSessionRevoked, serverLogoutStatus: gatewayServerLogoutStatus,
    responses: gatewayResponses, proof: proof(),
    traceCount: app.services.db.get("SELECT count(*) n FROM traces WHERE tenant_id=?", owner.tenantId).n};
}
const control = createServer(async (req, res) => {\n  res.setHeader("content-type", "application/json");` +
    `if (req.url?.startsWith("/gateway-")) { try {` +
    controls +
    `
    } catch (error) {
      const clean = text => [token, admin, secret, supplierKey, password, memberPassword]
        .reduce((value, credential) => value.replaceAll(credential, "<redacted>"), String(text));
      const failure = {scope: "owned-gateway-control", name: error?.name ?? typeof error,
        code: error?.code ?? null, message: clean(error?.message ?? ""), stack: clean(error?.stack ?? "")};
      await writeFile("/work/gateway-control-error.json", JSON.stringify(failure, null, 2), {mode: 0o600});
      res.writeHead(500).end(JSON.stringify({error: failure.scope, name: failure.name, code: failure.code}));
      return;
    }}
`,
);
contents = replaceOnce(
  contents,
  '  await writeFile(\n    "/work/backend-final-proof.json",',
  `  await writeFile("/work/gateway-final-state.json", JSON.stringify(gatewayState(), null, 2), {mode: 0o600, flush: true});
  gatewayHold.dispose();
  await writeFile(\n    "/work/backend-final-proof.json",`,
);
const deps = Object.keys(
  JSON.parse(await readFile(resolve(repo, "package.json"), "utf8"))
    .dependencies,
);
const outfile = resolve(root, "input/backend.mjs");
await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  external: deps,
  banner: {
    js: 'import {createRequire as _probeRequire} from "node:module"; const require=_probeRequire(import.meta.url);',
  },
  plugins: [
    {
      name: "owned-gateway-transport-boundary",
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
assert.equal(
  await readFile(entry, "utf8"),
  original,
  "Shared fixture must remain unchanged",
);
const manifest = {
  status: "prepared-not-run",
  profile,
  mode,
  root,
  sourceFixtureSha256: hash(original),
  holdFixtureSha256: hash(await readFile(gatePath)),
  preparationSha256: hash(await readFile(fileURLToPath(import.meta.url))),
  compiledFixtureSha256: hash(await readFile(outfile)),
  sharedFixtureUnchanged: true,
  productSourcesRewritten: false,
  boundary:
    "Original fixture plus transparent real-response hold and own-session backend logout controls; no GUI run",
};
await writeFile(
  resolve(root, "preparation.json"),
  JSON.stringify(manifest, null, 2) + "\n",
  { mode: 0o600 },
);
console.log(JSON.stringify(manifest));
