import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer, request } from "node:http";
import { createServer as createTlsServer } from "node:https";
import {
  mkdir,
  readFile,
  writeFile,
  readdir,
  readlink,
} from "node:fs/promises";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createApp } from "../../../src/app.ts";
import { bootstrap } from "../../../src/identity.ts";
import { setDataBaseDir } from "../../../clients/uwork/packages/services/src/paths.ts";
import { createCredentialService } from "../../../clients/uwork/packages/services/src/credential/credentialService.ts";
import { createCredentialCipherProvider } from "../../../clients/uwork/packages/services/src/credential/providers/credentialCipherProvider.ts";
import { createSharedIdentitySessionStore } from "../../../clients/uwork/packages/services/src/enterprise-identity/identitySessionStore.ts";

const home = "/work/home";
let fixtureAppRoot = process.env.UWORK_LINUX_TEST_APP_ROOT ?? "/app";
assert.ok(["/app", "/opt/UWork Preview"].includes(fixtureAppRoot));
const appImage = process.env.UWORK_LINUX_TEST_APPIMAGE;
if (appImage) assert.equal(appImage, "/opt/artifacts/uwork-preview.AppImage");
let packagedExecutable = fixtureAppRoot + "/zcode-preview";
let packagedCli = fixtureAppRoot + "/resources/glm/zcode.cjs";
const secret = randomBytes(32).toString("hex");
const supplierKey = randomBytes(24).toString("hex");
let calls = 0;
let rejected = 0;
let desktop;
const workingDirectories = new Set();
for (const path of [
  home,
  "/work/project",
  "/work/config",
  "/work/cache",
  "/work/share",
  "/tmp/uwork-runtime",
  "/work/appimage-runtime",
])
  await mkdir(path, { recursive: true, mode: 0o700 });
await writeFile("/work/project/sentinel.txt", "LINUX_DESKTOP_FILE_SENTINEL\n");
await promisify(execFile)("git", ["init", "--quiet", "/work/project"]);
await promisify(execFile)("openssl", [
  "req",
  "-x509",
  "-newkey",
  "rsa:2048",
  "-nodes",
  "-keyout",
  "/work/test.key",
  "-out",
  "/work/test.crt",
  "-days",
  "1",
  "-subj",
  "/CN=127.0.0.1",
  "-addext",
  "subjectAltName=IP:127.0.0.1,DNS:localhost",
]);
const supplier = createServer(async (req, res) => {
  if (req.headers.authorization !== `Bearer ${supplierKey}`) {
    rejected++;
    req.resume();
    res.writeHead(401).end();
    return;
  }
  if (req.url === "/v1/models") {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ data: [{ id: "controlled", object: "model" }] }));
    return;
  }
  assert.equal(req.url, "/v1/chat/completions");
  let body = "";
  for await (const chunk of req) body += chunk;
  const payload = JSON.parse(body);
  calls++;
  for (const message of payload.messages ?? []) {
    if (message.role !== "system" || typeof message.content !== "string")
      continue;
    for (const match of message.content.matchAll(
      /^- Primary working directory: ([^\r\n]+)$/gm,
    ))
      workingDirectories.add(match[1]);
  }
  if (payload.stream) {
    res.setHeader("content-type", "text/event-stream");
    res.write(
      "data: " +
        JSON.stringify({
          choices: [
            {
              index: 0,
              delta: { content: "LINUX_DESKTOP_LINK_OK" },
              finish_reason: null,
            },
          ],
        }) +
        "\n\n",
    );
    res.write(
      "data: " +
        JSON.stringify({
          choices: [],
          usage: { prompt_tokens: 12, completion_tokens: 10 },
        }) +
        "\n\n",
    );
    res.end("data: [DONE]\n\n");
  } else {
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: '{"title":"Linux 联动"}' },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 12, completion_tokens: 10 },
      }),
    );
  }
});
await new Promise((resolve) => supplier.listen(0, "127.0.0.1", resolve));
let backendOrigin;
const tls = createTlsServer(
  {
    key: await readFile("/work/test.key"),
    cert: await readFile("/work/test.crt"),
  },
  (req, res) => {
    if (!backendOrigin) {
      res.writeHead(503).end();
      return;
    }
    const target = new URL(req.url, backendOrigin);
    const proxied = request(
      target,
      { method: req.method, headers: req.headers },
      (reply) => {
        res.writeHead(reply.statusCode, reply.headers);
        reply.pipe(res);
      },
    );
    proxied.on("error", () => res.destroy());
    req.pipe(proxied);
  },
);
await new Promise((resolve) => tls.listen(0, "127.0.0.1", resolve));
const origin = `https://127.0.0.1:${tls.address().port}`;
const app = await createApp({
  database: "/work/backend.sqlite",
  masterKey: randomBytes(32),
  publicUrl: origin,
  allowPrivateUpstreams: true,
  worker: true,
});
const requestSizes = [];
app.addHook("preHandler", async (req) => {
  if (req.method !== "POST" || req.url !== "/v1/chat/completions" || requestSizes.length >= 16) return;
  const body = req.body;
  const messages = (body.messages ?? []).map((message) => ({
    role: message.role,
    utf8Bytes: typeof message.content === "string" ? Buffer.byteLength(message.content) :
      (message.content ?? []).reduce((sum, part) => sum + (part.type === "text" ? Buffer.byteLength(part.text) : Buffer.byteLength(part.image_url.url) + 16384), 0),
    toolCallBytes: message.tool_calls ? Buffer.byteLength(JSON.stringify(message.tool_calls)) : 0,
    toolCallIdBytes: Buffer.byteLength(message.tool_call_id ?? ""),
  }));
  const toolsUtf8Bytes = body.tools ? Buffer.byteLength(JSON.stringify(body.tools)) : 0;
  requestSizes.push({ messages, toolsUtf8Bytes, toolCount: body.tools?.length ?? 0,
    toolNames: (body.tools ?? []).map((tool) => tool.function.name), requestedMaxTokens: body.max_tokens,
    conservativeInputBound: 256 + toolsUtf8Bytes + messages.reduce((sum, m) => sum + m.utf8Bytes + m.toolCallBytes + m.toolCallIdBytes + 64, 0) });
});
const password = randomBytes(24).toString("hex");
const owner = await bootstrap(app.services.db, {
  name: "Linux 联动企业",
  email: "linux-owner@example.test",
  password,
});
backendOrigin = await app.listen({ host: "127.0.0.1", port: 0 });
let admin;
async function api(path, method = "GET", body, token = admin) {
  const response = await fetch(backendOrigin + path, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      "content-type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const value = await response.json();
  assert.ok(response.ok, `${method} ${path}: ${response.status}`);
  return value;
}
admin = (
  await api(
    "/api/auth/login",
    "POST",
    { email: "linux-owner@example.test", password },
    undefined,
  )
).token;
const prefix = `/api/tenants/${owner.tenantId}`;
const credential = await api(prefix + "/credentials", "POST", {
  name: "owned-linux",
  value: supplierKey,
});
await api(prefix + "/models", "POST", {
  name: "Linux 联动受控模型",
  upstreamModel: "controlled",
  credentialId: credential.id,
  baseUrl: `http://127.0.0.1:${supplier.address().port}/v1`,
  scope: { all: true },
  maxOutputTokens: 1024,
  // 正常生产工具面包含 workflow 定义；完整保留工具并用声明的足额窗口验证允许路径。
  contextWindow: 500000,
  supportsTools: true,
});
const department = await api(prefix + "/departments", "POST", {
  name: "Linux 测试部门",
});
const memberPassword = randomBytes(24).toString("hex");
const member = await api(prefix + "/members", "POST", {
  email: "linux-member@example.test",
  name: "Linux 测试成员",
  password: memberPassword,
  role: "member",
  departmentId: department.id,
  seat: true,
});
await api(prefix + "/wecom", "PUT", {
  corpId: "ww-synthetic-never-called",
  agentId: "1",
  credentialId: credential.id,
});
await api(prefix + "/members/" + member.id + "/wecom", "PUT", {
  externalId: "linux-synthetic-member",
});
for (const [subjectType, subjectId] of [
  ["department", department.id],
  ["member", member.id],
])
  await api(prefix + "/limits", "PUT", {
    subjectType,
    subjectId,
    amount: 3000000,
  });
const token = (
  await api(
    "/api/auth/login",
    "POST",
    { email: "linux-member@example.test", password: memberPassword },
    undefined,
  )
).token;
const me = await api("/api/auth/me", "GET", undefined, token);
await mkdir(home + "/.uwork/v2", { recursive: true, mode: 0o700 });
await writeFile(
  home + "/.uwork/v2/enterprise-identity.json",
  JSON.stringify({
    backend: "uwork",
    apiBaseUrl: origin,
    callbackUrl: origin + "/api/auth/wecom/callback",
    organizations: [
      {
        orgId: owner.tenantId,
        corpId: "ww-synthetic-never-called",
        agentId: "1",
        label: "Linux 本机联动",
      },
    ],
  }),
  { mode: 0o600 },
);
await writeFile(
  home + "/.uwork/v2/setting.json",
  JSON.stringify({ httpProxyCaCertPath: "/work/test.crt" }),
  { mode: 0o600 },
);
setDataBaseDir(home);
const credentials = createCredentialService({
  cipherProvider: createCredentialCipherProvider({
    env: { ZCODE_CREDENTIAL_SECRET: secret },
  }),
});
const store = createSharedIdentitySessionStore(credentials, (operation) =>
  operation(),
);
await store.write(
  {
    token,
    issuerOrigin: origin,
    expiresAt: me.expiresAt,
    profile: {
      id: me.user.id,
      tenantId: me.tenant.id,
      displayName: me.user.name,
      provider: "wecom",
    },
  },
  0,
  () => true,
);
function proof() {
  const rows = app.services.db.all(
    "SELECT user_id,status,amount,input_tokens,output_tokens FROM ledger WHERE tenant_id=?",
    owner.tenantId,
  );
  return {
    modelCalls: calls,
    rejectedSupplierRequests: rejected,
    workingDirectories: [...workingDirectories],
    ledger: {
      count: rows.length,
      owned: rows.every((row) => row.user_id === member.id),
      settled: rows.filter((row) => row.status === "settled").length,
      amount: rows.reduce((sum, row) => sum + row.amount, 0),
      inputTokens: rows.reduce((sum, row) => sum + row.input_tokens, 0),
      outputTokens: rows.reduce((sum, row) => sum + row.output_tokens, 0),
    },
  };
}
const control = createServer(async (req, res) => {
  res.setHeader("content-type", "application/json");
  if (req.method === "GET" && req.url === "/proof")
    res.end(JSON.stringify(proof()));
  else if (req.method === "GET" && req.url === "/request-sizes")
    res.end(JSON.stringify({ requests: requestSizes }));
  else if (req.method === "GET" && req.url === "/terminal-proof") {
    try {
      const text = await readFile("/work/project/terminal-proof.txt", "utf8");
      const lines = text.trimEnd().split("\n");
      const shellPid = Number(lines[3]);
      assert.ok(Number.isSafeInteger(shellPid) && shellPid > 1);
      const tty = await readlink("/proc/" + shellPid + "/fd/0");
      res.end(JSON.stringify({ exists: true, markerMatches: lines[0] === "LINUX_PTY_WRITE_OK",
        cwd: lines[1], tty: lines[2], shellPid, liveTtyMatches: tty === lines[2],
        shellExecutable: await readlink("/proc/" + shellPid + "/exe"),
        shellCwd: await readlink("/proc/" + shellPid + "/cwd") }));
    } catch (error) {
      res.end(JSON.stringify({ exists: error.code !== "ENOENT", incomplete: error.code !== "ENOENT" }));
    }
  }
  else if (req.method === "GET" && req.url === "/runtime") {
    const processes = [];
    for (const name of await readdir("/proc")) {
      if (!/^\d+$/.test(name)) continue;
      try {
        const args = (await readFile(`/proc/${name}/cmdline`, "utf8")).split(
          "\0",
        );
        const executable = await readlink(`/proc/${name}/exe`);
        if (executable !== packagedExecutable) continue;
        const status = await readFile(`/proc/${name}/status`, "utf8");
        processes.push({
          pid: Number(name),
          parentPid: Number(status.match(/^PPid:\s+(\d+)$/m)[1]),
          packagedCliArgument: args.includes(packagedCli),
          processTitle: (await readFile(`/proc/${name}/comm`, "utf8")).trim(),
          executable,
          cwd: await readlink(`/proc/${name}/cwd`),
        });
      } catch {
        /* 已结束的本轮子进程不冒充仍存活的 CLI。 */
      }
    }
    assert.ok(processes.length <= 32);
    res.end(JSON.stringify({ processes }));
  } else if (req.method === "POST" && req.url === "/revoke-seat") {
    await api(prefix + "/members/" + member.id, "PATCH", { seat: false });
    res.end('{"revoked":true}');
  } else if (req.method === "POST" && req.url === "/shutdown") {
    res.end('{"closing":true}');
    setImmediate(() => {
      void close();
    });
  } else {
    req.resume();
    res.writeHead(404).end("{}");
  }
});
await new Promise((resolve) => control.listen(9334, "0.0.0.0", resolve));
desktop = spawn(
  appImage ?? (fixtureAppRoot === "/app" ? packagedExecutable : "/usr/bin/zcode-preview"),
  [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--lang=zh-CN",
    "--remote-debugging-port=9222",
    "--open-workspace",
    "/work/project",
  ],
  {
    env: {
      ...process.env,
      ZCODE_DATA_BASE_DIR: home,
      UWORK_DATA_BASE_DIR: home,
      ZCODE_STORAGE_DIR: home + "/.uwork",
      ZCODE_DESKTOP_HOME_DIR: home,
      ZCODE_DESKTOP_USER_DATA_DIR: "/work/userdata",
      ZCODE_DESKTOP_SESSION_DATA_DIR: "/work/sessiondata",
      ZCODE_DISABLE_FIXED_REMOTE_DEBUGGING_PORT: "1",
      ZCODE_CREDENTIAL_SECRET: secret,
      NODE_EXTRA_CA_CERTS: "/work/test.crt",
      ZCODE_ENV: "production",
      ZCODE_BASE_URL: origin,
      ZCODE_UPDATE_FEED_URL: origin + "/owned-test-no-updates",
      ZCODE_ARMS_RUM_ENDPOINT: "",
      ...(appImage ? { APPIMAGE_EXTRACT_AND_RUN: "1", TMPDIR: "/work/appimage-runtime" } : {}),
    },
    stdio: ["ignore", "inherit", "inherit"],
  },
);
desktop.once("close", (code, signal) => {
  void writeFile("/work/desktop-exit.json", JSON.stringify({ code, signal }), { mode: 0o600 });
});
let packagedElectronPid = desktop.pid;
if (appImage) {
  const deadline = Date.now() + 20000;
  let resolved = false;
  while (Date.now() < deadline && !resolved) {
    for (const name of await readdir("/proc")) {
      if (!/^\d+$/.test(name)) continue;
      try {
        const executable = await readlink(`/proc/${name}/exe`);
        const args = (await readFile(`/proc/${name}/cmdline`, "utf8")).split("\0");
        if (executable.startsWith("/work/appimage-runtime/") && executable.endsWith("/zcode-preview") && !args.some((arg) => arg.startsWith("--type="))) {
          packagedExecutable = executable;
          fixtureAppRoot = executable.slice(0, -"/zcode-preview".length);
          packagedCli = fixtureAppRoot + "/resources/glm/zcode.cjs";
          packagedElectronPid = Number(name);
          resolved = true;
          break;
        }
      } catch { /* 本轮已结束的 runtime 子进程不作为活应用。 */ }
    }
    if (!resolved) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(resolved, "Original AppImage must launch its extracted Electron executable");
}
await writeFile(
  "/work/backend-ready.json",
  JSON.stringify({
    origin,
    backendPid: process.pid,
    desktopPid: desktop.pid,
    electronPid: packagedElectronPid,
    packagedRoot: fixtureAppRoot,
    baseline: proof(),
  }),
  { mode: 0o600 },
);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await writeFile(
    "/work/backend-final-proof.json",
    JSON.stringify(proof(), null, 2),
    { flush: true },
  );
  if (desktop.exitCode === null) {
    const closed = new Promise((resolve) => desktop.once("close", resolve));
    desktop.kill("SIGTERM");
    await closed;
  }
  await app.close();
  await Promise.all(
    [supplier, tls, control].map(
      (server) => new Promise((resolve) => server.close(resolve)),
    ),
  );
  process.exitCode = 0;
}
process.once("SIGTERM", () => {
  void close();
});
process.once("SIGINT", () => {
  void close();
});
