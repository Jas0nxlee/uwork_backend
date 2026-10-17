import { randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir, symlink, rm } from "node:fs/promises";
import { createServer as httpServer, request as httpRequest } from "node:http";
import { createServer as httpsServer } from "node:https";
import { createServer as netServer } from "node:net";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline";
import { createApp } from "../../src/app.ts";
import { bootstrap } from "../../src/identity.ts";
const fixtureName =
  process.env.UWORK_NATIVE_FIXTURE_NAME ?? "client-native-enterprise-20261017";
if (!/^client-native-[a-z0-9-]+$/.test(fixtureName))
  throw Error("Invalid fixture name");
const exec = promisify(execFile),
  evidence = "evidence/" + fixtureName;
await mkdir(evidence, { recursive: true, mode: 0o700 });
const runtime = {
  electron:
    process.env.UWORK_NATIVE_ELECTRON ??
    join(
      process.cwd(),
      "data/client-live-20261017/electron/Electron.app/Contents/MacOS/Electron",
    ),
};
const root = join(process.cwd(), "data/" + fixtureName),
  client = join(process.cwd(), "clients/uwork"),
  home = join(root, "data"),
  appRoot = join(root, "app"),
  credentialSecret = randomBytes(32).toString("hex");
await mkdir(join(process.cwd(), "data"), { recursive: true });
// 固定命名的复现夹具只能认领新目录，不能覆盖仍在运行或已存在的测试资料。
await mkdir(root, { mode: 0o700 });
for (const p of [home, appRoot])
  await mkdir(p, { recursive: true, mode: 0o700 });
const key = join(root, "tls.key"),
  cert = join(root, "tls.crt");
await exec("openssl", [
  "req",
  "-x509",
  "-newkey",
  "rsa:2048",
  "-nodes",
  "-keyout",
  key,
  "-out",
  cert,
  "-days",
  "1",
  "-subj",
  "/CN=127.0.0.1",
  "-addext",
  "subjectAltName=IP:127.0.0.1,DNS:localhost",
]);
let backendOrigin = "",
  modelCalls = 0,
  electron;
const traffic = [];
let enterpriseAsset, denyPolicy;
const modelRequests = [];
const upstream = httpServer(async (req, res) => {
  let text = "";
  for await (const b of req) text += b;
  if (req.url === "/v1/models") {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ data: [{ id: "controlled" }] }));
    return;
  }
  modelCalls++;
  const body = JSON.parse(text);
  modelRequests.push(body);
  const skillTurn =
    body.tools?.some((t) => t.function?.name === "Skill") &&
    !body.messages.some((m) => m.role === "tool") &&
    body.messages.some(
      (m) =>
        typeof m.content === "string" && m.content.includes("运行企业技能"),
    );
  const call = {
    index: 0,
    id: "native-skill-" + modelCalls,
    type: "function",
    function: {
      name: "Skill",
      arguments: JSON.stringify({ skill: "enterprise:" + enterpriseAsset?.id }),
    },
  };
  const output = "原生企业资产联动完成。";
  if (body.stream) {
    res.setHeader("content-type", "text/event-stream");
    if (skillTurn)
      res.write(
        "data: " +
          JSON.stringify({
            choices: [
              {
                index: 0,
                delta: { tool_calls: [call] },
                finish_reason: "tool_calls",
              },
            ],
          }) +
          "\n\n",
      );
    else
      for (const content of ["原生企业资产", "联动完成。"])
        res.write(
          "data: " +
            JSON.stringify({
              choices: [{ index: 0, delta: { content }, finish_reason: null }],
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
            message: skillTurn
              ? { role: "assistant", content: null, tool_calls: [call] }
              : { role: "assistant", content: output },
            finish_reason: skillTurn ? "tool_calls" : "stop",
          },
        ],
        usage: { prompt_tokens: 12, completion_tokens: 10 },
      }),
    );
  }
});
await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
let configurationPaused = false;
const configurationReplies = new Set();
const proxy = httpsServer(
  { key: await readFile(key), cert: await readFile(cert) },
  (req, res) => {
    const target = httpRequest(
      backendOrigin + (req.url ?? "/"),
      { method: req.method, headers: req.headers },
      (reply) => {
        const deliver = () => {
          configurationReplies.delete(deliver);
          if (res.destroyed) {
            reply.destroy();
            return;
          }
          res.writeHead(reply.statusCode ?? 500, reply.headers);
          reply.pipe(res);
        };
        // 只延迟真实后台响应，不替换正文，复现旧菜单仍可见时的即时准入。
        if (configurationPaused && req.url === "/api/client/configuration") {
          reply.pause();
          configurationReplies.add(deliver);
          res.once("close", () => configurationReplies.delete(deliver));
        } else deliver();
      },
    );
    target.on("error", () => {
      if (!res.destroyed && !res.headersSent) res.writeHead(502).end();
    });
    res.on("close", () => target.destroy());
    req.pipe(target);
  },
);
await new Promise((r) => proxy.listen(0, "127.0.0.1", r));
const origin = `https://127.0.0.1:${proxy.address().port}`;
const app = await createApp({
  database: join(root, "backend.sqlite"),
  masterKey: randomBytes(32),
  publicUrl: origin,
  allowPrivateUpstreams: true,
  worker: true,
});
app.addHook("onResponse", async (req, reply) =>
  traffic.push({
    method: req.method,
    path: req.routeOptions.url,
    status: reply.statusCode,
  }),
);
const password = randomBytes(24).toString("hex");
const owner = await bootstrap(app.services.db, {
  name: "客户端联动测试",
  email: "desktop-owner@example.test",
  password,
});
backendOrigin = await app.listen({ host: "127.0.0.1", port: 0 });
let admin;
async function api(path, method = "GET", body, auth = admin) {
  const r = await fetch(backendOrigin + path, {
    method,
    headers: {
      ...(auth ? { authorization: "Bearer " + auth } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000),
  });
  const text = await r.text();
  const value = text ? JSON.parse(text) : undefined;
  if (!r.ok)
    throw Error(
      `Fixture HTTP ${method} ${path}: ${r.status}/${value?.error?.code}`,
    );
  return value;
}
const login = async () =>
  api(
    "/api/auth/login",
    "POST",
    { email: "desktop-owner@example.test", password },
    undefined,
  );
admin = (await login()).token;
const p = "/api/tenants/" + owner.tenantId;
const credential = await api(p + "/credentials", "POST", {
  name: "controlled",
  value: randomBytes(24).toString("hex"),
});
const model = await api(p + "/models", "POST", {
  name: "联动受控模型",
  upstreamModel: "controlled",
  credentialId: credential.id,
  baseUrl: `http://127.0.0.1:${upstream.address().port}/v1`,
  scope: { all: true },
  maxOutputTokens: 1024,
  supportsTools: true,
});
const dA = await api(p + "/departments", "POST", { name: "业务一部" }),
  dB = await api(p + "/departments", "POST", { name: "业务二部" });
const memberPassword = randomBytes(24).toString("hex");
const member = await api(p + "/members", "POST", {
  email: "journey-a@example.test",
  name: "企业用户甲",
  password: memberPassword,
  role: "operator",
  departmentId: dA.id,
  seat: true,
});
await api(p + "/wecom", "PUT", {
  corpId: "ww-synthetic-never-called",
  agentId: "1",
  credentialId: credential.id,
});
await api(p + "/members/" + member.id + "/wecom", "PUT", {
  externalId: "synthetic-wecom-user-a",
});
await api(p + "/limits", "PUT", {
  subjectType: "department",
  subjectId: dA.id,
  amount: 200000,
});
await api(p + "/limits", "PUT", {
  subjectType: "member",
  subjectId: member.id,
  amount: 150000,
});
const bobPassword = randomBytes(24).toString("hex");
const bob = await api(p + "/members", "POST", {
  email: "journey-b@example.test",
  name: "企业用户乙",
  password: bobPassword,
  role: "member",
  departmentId: dB.id,
  seat: true,
});
const bobToken = (
  await api(
    "/api/auth/login",
    "POST",
    { email: "journey-b@example.test", password: bobPassword },
    undefined,
  )
).token;
for (let i = 0; i < 2; i++)
  await api(
    "/v1/chat/completions",
    "POST",
    {
      model: model.id,
      messages: [{ role: "user", content: "other-user-test" }],
      max_tokens: 16,
    },
    bobToken,
  );
await api("/api/auth/logout", "POST", undefined, bobToken);
const identity = (
    await api(
      "/api/auth/login",
      "POST",
      { email: "journey-a@example.test", password: memberPassword },
      undefined,
    )
  ).token,
  me = await api("/api/auth/me", "GET", undefined, identity);
const configDir = join(home, ".uwork", "v2");
await mkdir(configDir, { recursive: true, mode: 0o700 });
const publicConfig = {
  backend: "uwork",
  apiBaseUrl: origin,
  callbackUrl: origin + "/api/auth/wecom/callback",
  organizations: [
    {
      orgId: owner.tenantId,
      corpId: "ww-controlled-unused",
      agentId: "1",
      label: "本机联动测试",
    },
  ],
};
await writeFile(
  join(configDir, "enterprise-identity.json"),
  JSON.stringify(publicConfig),
  { mode: 0o600 },
);
await writeFile(
  join(configDir, "setting.json"),
  JSON.stringify({ httpProxyCaCertPath: cert }),
  { mode: 0o600 },
);
const load = (path) => import(pathToFileURL(join(client, path)).href);
const paths = await load("packages/services/src/paths.ts");
paths.setDataBaseDir(home);
const { createCredentialService } = await load(
  "packages/services/src/credential/credentialService.ts",
);
const { createCredentialCipherProvider } = await load(
  "packages/services/src/credential/providers/credentialCipherProvider.ts",
);
const { createSharedIdentitySessionStore } = await load(
  "packages/services/src/enterprise-identity/identitySessionStore.ts",
);
const credentials = createCredentialService({
  cipherProvider: createCredentialCipherProvider({
    env: { ZCODE_CREDENTIAL_SECRET: credentialSecret },
  }),
});
const store = createSharedIdentitySessionStore(credentials, (operation) =>
  operation(),
);
await store.write(
  {
    token: identity,
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
await writeFile(
  join(appRoot, "package.json"),
  JSON.stringify({
    name: "uwork-client-link-test",
    version: "0.0.0",
    main: "entry.cjs",
  }),
);
await writeFile(
  join(appRoot, "entry.cjs"),
  `const {app}=require('electron');app.setAsDefaultProtocolClient=()=>false;import(${JSON.stringify(pathToFileURL(join(client, "packages/desktop/out/main/index.js")).href)});`,
);
for (const name of ["out", "bundled-agents", "node_modules"])
  await symlink(
    join(client, name === "node_modules" ? name : "packages/desktop/" + name),
    join(appRoot, name),
  );
const probe = netServer();
await new Promise((r) => probe.listen(0, "127.0.0.1", r));
const cdpPort = probe.address().port;
await new Promise((r) => probe.close(r));
const meta = {
  root,
  origin,
  backendOrigin,
  appRoot,
  cert,
  home,
  modelId: model.id,
  supplierOrigin: `http://127.0.0.1:${upstream.address().port}`,
  tenantId: owner.tenantId,
  memberId: member.id,
  departmentId: dA.id,
  cdpPort,
  pid: process.pid,
  identityInitialization:
    "email HTTP session encrypted with production credential/shared-store; no WeCom request",
  nativeBoundary:
    "default URL protocol registration suppressed in owned launcher only; no deep-link acceptance claimed",
};
await writeFile(
  evidence + "/desktop-state.json",
  JSON.stringify(meta, null, 2),
  { mode: 0o600 },
);
async function configure(kind, data) {
  const old = await api(p + "/configurations/" + kind);
  const saved = await api(p + "/configurations/" + kind, "PUT", {
    revision: old.revision,
    data: { ...old.published, ...data },
  });
  await api(p + "/configurations/" + kind + "/publish", "POST", {
    revision: saved.revision,
  });
}
async function saveDraft(kind, data) {
  const old = await api(p + "/configurations/" + kind);
  return api(p + "/configurations/" + kind, "PUT", {
    revision: old.revision,
    data: { ...old.published, ...data },
  });
}
async function publishDraft(kind) {
  const old = await api(p + "/configurations/" + kind);
  return api(p + "/configurations/" + kind + "/publish", "POST", {
    revision: old.revision,
  });
}
async function publishAsset(version) {
  for (const operation of ["review", "publish"])
    await api(p + "/assets/" + enterpriseAsset.id + "/" + operation, "POST", {
      version,
      ...(operation === "review" ? { approved: true } : {}),
    });
}
function assetBody(version) {
  return {
    name: "Native Enterprise Skill",
    kind: "skill",
    scope: { all: true },
    content: {
      files: [
        {
          path: "SKILL.md",
          content:
            "---\nname: native-enterprise-skill\ndescription: Native enterprise skill controlled version " +
            version +
            "\n---\nNATIVE_ENTERPRISE_SKILL_VERSION_" +
            version +
            "\nReply with a short acceptance message.",
        },
      ],
      highRisk: false,
    },
  };
}
async function assetCreate() {
  enterpriseAsset = await api(p + "/assets", "POST", assetBody(1));
  await publishAsset(1);
}
async function assetUpdate() {
  const list = await api(p + "/assets");
  const old = list.items.find((a) => a.id === enterpriseAsset.id);
  await api(p + "/assets/" + enterpriseAsset.id, "PUT", {
    revision: old.revision,
    ...assetBody(2),
  });
  await publishAsset(2);
}
async function launch() {
  if (electron) throw Error("Already launched");
  electron = spawn(
    runtime.electron,
    [appRoot, "--remote-debugging-port=" + cdpPort],
    {
      cwd: appRoot,
      detached: true,
      env: {
        PATH: process.env.PATH,
        HOME: home,
        USERPROFILE: home,
        ZCODE_TELEMETRY_REPORT_ENDPOINT: "",
        ZCODE_ARMS_RUM_ENDPOINT: "",
        UWORK_DATA_BASE_DIR: home,
        ZCODE_DESKTOP_HOME_DIR: home,
        ZCODE_DESKTOP_USER_DATA_DIR: join(root, "userdata"),
        ZCODE_DESKTOP_SESSION_DATA_DIR: join(root, "sessiondata"),
        ZCODE_DESKTOP_APPLICATION_NAME: "UWork 联动验证",
        ZCODE_DISABLE_FIXED_REMOTE_DEBUGGING_PORT: "1",
        ZCODE_CREDENTIAL_SECRET: credentialSecret,
        NODE_EXTRA_CA_CERTS: cert,
        ZCODE_STORAGE_DIR: join(home, ".uwork"),
        ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: join(
          client,
          "config/provider/zcode-builtin.json",
        ),
        ZCODE_ENV: "production",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const { createWriteStream } = await import("node:fs");
  const log = createWriteStream(evidence + "/electron.log", { mode: 0o600 });
  electron.stdout.pipe(log);
  electron.stderr.pipe(log);
  electron.once("exit", (code) => {
    console.log(JSON.stringify({ event: "electron-exit", code }));
    electron = undefined;
    log.end();
  });
  console.log(
    JSON.stringify({ event: "launched", pid: electron.pid, cdpPort }),
  );
}
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  const errors = [];
  const attempt = async (operation) => {
    try {
      await operation();
    } catch {
      errors.push("cleanup_failed");
    }
  };
  await attempt(async () => {
    const child = electron;
    if (!child) return;
    const wait = (milliseconds) =>
      new Promise((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) {
          resolve(true);
          return;
        }
        const done = () => {
          clearTimeout(timer);
          resolve(true);
        };
        const timer = setTimeout(() => {
          child.off("exit", done);
          resolve(false);
        }, milliseconds);
        child.once("exit", done);
      });
    process.kill(-child.pid, "SIGTERM");
    if (!(await wait(10000))) {
      process.kill(-child.pid, "SIGKILL");
      if (!(await wait(5000))) throw Error("Owned Electron did not exit");
    }
  });
  await attempt(() => app.close());
  for (const server of [upstream, proxy])
    await attempt(async () => {
      server.closeAllConnections();
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    });
  await writeFile(
    evidence + "/desktop-traffic.json",
    JSON.stringify({ modelCalls, traffic, modelRequests }, null, 2),
    { mode: 0o600 },
  );
  paths.setDataBaseDir(null);
  if (!errors.length)
    await attempt(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    evidence + "/cleanup.json",
    JSON.stringify(
      {
        errors,
        electronExited: !electron,
        serversClosed: !upstream.listening && !proxy.listening,
        ownedRootRemoved: !errors.length,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({ event: "fixture-closed", errors: errors.length }),
  );
  process.exit(errors.length ? 1 : 0);
}
const rl = createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  try {
    const c = JSON.parse(line);
    if (c.op === "launch") await launch();
    else if (c.op === "pauseConfiguration") configurationPaused = true;
    else if (c.op === "resumeConfiguration") {
      configurationPaused = false;
      for (const deliver of configurationReplies) deliver();
    } else if (c.op === "draft") await saveDraft(c.kind, c.data);
    else if (c.op === "publish") await publishDraft(c.kind);
    else if (c.op === "configure") await configure(c.kind, c.data);
    else if (c.op === "assetCreate") await assetCreate();
    else if (c.op === "assetUpdate") await assetUpdate();
    else if (c.op === "assetRevoke")
      denyPolicy = await api(p + "/policies", "POST", {
        name: "Native revoke",
        family: "skill",
        mode: "deny",
        resourceIds: [enterpriseAsset.id],
        scope: { all: true },
      });
    else if (c.op === "assetRestore")
      await api(p + "/policies/" + denyPolicy.id, "DELETE");
    else if (c.op === "status") {
      console.log(
        JSON.stringify({
          origin,
          backendOrigin,
          root,
          home,
          cdpPort,
          modelCalls,
          assetId: enterpriseAsset?.id,
          traffic: traffic.slice(-30),
        }),
      );
      return;
    } else if (c.op === "welcome")
      await configure("new-chat", { welcome: c.value });
    else if (c.op === "menus") await configure("menus", { items: c.items });
    else if (c.op === "revokeDevices") {
      for (const d of await api("/api/auth/device-tokens"))
        await api("/api/auth/device-tokens/" + d.id, "DELETE");
    } else if (c.op === "departmentLimit")
      await api(p + "/limits", "PUT", {
        subjectType: "department",
        subjectId: dA.id,
        amount: c.amount,
      });
    else if (c.op === "memberSeat")
      await api(p + "/members/" + member.id, "PATCH", { seat: c.value });
    else if (c.op === "memberRole")
      await api(p + "/members/" + member.id, "PATCH", { role: c.value });
    else if (c.op === "revokeIdentity")
      await api("/api/auth/logout", "POST", undefined, identity);
    else if (c.op === "disableModel")
      await api(p + "/models/" + model.id, "DELETE");
    else if (c.op === "stats") {
      console.log(
        JSON.stringify({
          modelCalls,
          deviceCount: (await api("/api/auth/device-tokens")).length,
          usage: await api(p + "/usage"),
        }),
      );
      return;
    } else if (c.op === "close") await close();
    else throw Error("Unknown fixture command");
    console.log(JSON.stringify({ op: c.op, status: "done" }));
  } catch (e) {
    console.log(
      JSON.stringify({ status: "fixture-command-failed", message: e.message }),
    );
  }
});
for (const s of ["SIGTERM", "SIGINT"]) process.on(s, () => void close());
console.log(JSON.stringify({ event: "ready", origin, root, cdpPort }));
