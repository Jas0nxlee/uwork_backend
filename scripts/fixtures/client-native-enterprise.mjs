import { randomBytes, createHash, X509Certificate } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  copyFile,
  readFile,
  writeFile,
  mkdir,
  symlink,
  rm,
} from "node:fs/promises";
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
import { copyNativeOutSnapshot } from "./native-out-snapshot.mjs";
import { copyNativeAdminSnapshot } from "./native-admin-snapshot.mjs";
const fixtureName =
  process.env.UWORK_NATIVE_FIXTURE_NAME ?? "client-native-enterprise-20261017";
if (!/^client-native-[a-z0-9-]+$/.test(fixtureName))
  throw Error("Invalid fixture name");
const dynamicWorkflowMode = process.env.UWORK_NATIVE_DYNAMIC_WORKFLOW_MODE;
if (dynamicWorkflowMode !== undefined && dynamicWorkflowMode !== "alwaysOn")
  throw Error(
    "Only the existing alwaysOn workflow mode is supported by this fixture",
  );
const experienceMode = process.env.UWORK_NATIVE_CLIENT_EXPERIENCE;
if (experienceMode !== undefined && experienceMode !== "enabled")
  throw Error("Invalid Native client experience fixture mode");
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
  runtimeRoot = join(root, "runtime"),
  appRoot = join(runtimeRoot, "app"),
  helpConfigDir = join(root, "config"),
  credentialSecret = randomBytes(32).toString("hex");
await mkdir(join(process.cwd(), "data"), { recursive: true });
// 固定命名的复现夹具只能认领新目录，不能覆盖仍在运行或已存在的测试资料。
await mkdir(root, { mode: 0o700 });
for (const p of [home, appRoot, helpConfigDir])
  await mkdir(p, { recursive: true, mode: 0o700 });
const helpConfigSource = join(client, "config/default.json"),
  helpConfigPath = join(helpConfigDir, "default.json");
await copyFile(helpConfigSource, helpConfigPath, fsConstants.COPYFILE_EXCL);
const [helpConfigSourceBytes, helpConfigTargetBytes] = await Promise.all([
  readFile(helpConfigSource),
  readFile(helpConfigPath),
]);
const helpLocalConfig = {
  source: helpConfigSource,
  destination: helpConfigPath,
  bytes: helpConfigTargetBytes.length,
  sourceSha256: createHash("sha256")
    .update(helpConfigSourceBytes)
    .digest("hex"),
  targetSha256: createHash("sha256")
    .update(helpConfigTargetBytes)
    .digest("hex"),
  exclusiveCopy: true,
};
if (helpLocalConfig.sourceSha256 !== helpLocalConfig.targetSha256)
  throw Error("Native Help public config snapshot differs from its source");
await writeFile(
  join(evidence, "help-local-config-artifact.json"),
  JSON.stringify(helpLocalConfig, null, 2),
  { mode: 0o600 },
);
const workflowWorkspacePath = join(root, "project-input");
if (dynamicWorkflowMode === "alwaysOn")
  await mkdir(workflowWorkspacePath, { mode: 0o700 });
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
const certSpkiSha256 = createHash("sha256")
  .update(
    new X509Certificate(await readFile(cert)).publicKey.export({
      type: "spki",
      format: "der",
    }),
  )
  .digest("base64");
const adminSnapshot = experienceMode
  ? await copyNativeAdminSnapshot({
      repository: process.cwd(),
      ownedRoot: root,
    })
  : undefined;
if (adminSnapshot)
  await writeFile(
    join(evidence, "admin-static-snapshot.json"),
    JSON.stringify(adminSnapshot.manifest, null, 2),
    { mode: 0o600 },
  );
let backendOrigin = "",
  modelCalls = 0,
  electron;
const traffic = [];
let enterpriseAsset, denyPolicy, enterpriseExpert, expertDenyPolicy;
const modelRequests = [];
let workflowHoldSecond = false;
const workflowPendingReplies = new Set(),
  workflowFacts = [];
const workflowScript = [
  'const worker = agent("NativeUiWorker", { system: "NATIVE_UI_WORKFLOW_ACTOR" });',
  'const first = await worker.ask("NATIVE_UI_STEP_ONE");',
  'const second = await worker.ask("NATIVE_UI_STEP_TWO");',
  "return { first, second };",
].join("\n");
const messageText = (message) =>
  typeof message?.content === "string"
    ? message.content
    : Array.isArray(message?.content)
      ? message.content.map((part) => part.text ?? "").join("")
      : "";
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
  const lastUserIndex = body.messages.findLastIndex((m) => m.role === "user");
  const currentUser = body.messages[lastUserIndex];
  const currentHasTool = body.messages
    .slice(lastUserIndex + 1)
    .some((m) => m.role === "tool");
  const workflowActor =
    dynamicWorkflowMode === "alwaysOn" &&
    body.messages.some(
      (m) =>
        m.role === "system" &&
        messageText(m).includes("NATIVE_UI_WORKFLOW_ACTOR"),
    );
  const workflowStep = messageText(currentUser).includes("NATIVE_UI_STEP_TWO")
    ? 2
    : 1;
  const workflowSaveTurn =
    dynamicWorkflowMode === "alwaysOn" &&
    body.stream &&
    !currentHasTool &&
    messageText(currentUser).includes("NATIVE_UI_WORKFLOW_SAVE") &&
    body.tools?.some((t) => t.function?.name === "SaveWorkflow");
  if (workflowActor) {
    const fact = { request: modelCalls, step: workflowStep, held: false };
    workflowFacts.push(fact);
    if (workflowStep === 2 && workflowHoldSecond) {
      fact.held = true;
      await new Promise((resolve) => {
        const finish = () => {
          workflowPendingReplies.delete(finish);
          res.off("close", finish);
          resolve();
        };
        workflowPendingReplies.add(finish);
        res.once("close", finish);
      });
      fact.closedWhileHeld = res.destroyed;
      if (res.destroyed) return;
    }
    fact.responseSent = true;
  }
  const skillTurn =
    body.tools?.some((t) => t.function?.name === "Skill") &&
    !currentHasTool &&
    typeof currentUser?.content === "string" &&
    currentUser.content.includes("运行企业技能");
  const expertTurn =
    body.tools?.some((t) => t.function?.name === "Agent") &&
    !currentHasTool &&
    typeof currentUser?.content === "string" &&
    currentUser.content.includes("运行企业专家");
  const toolTurn = workflowSaveTurn || skillTurn || expertTurn;
  const call = workflowSaveTurn
    ? {
        index: 0,
        id: "native-workflow-save-" + modelCalls,
        type: "function",
        function: {
          name: "SaveWorkflow",
          arguments: JSON.stringify({
            name: messageText(currentUser).includes(
              "NATIVE_UI_WORKFLOW_SAVE_REJECT",
            )
              ? "native-ui-workflow-rejected"
              : "native-ui-workflow",
            description: "Native UI two-step workflow",
            scope: "project",
            script: workflowScript,
          }),
        },
      }
    : {
        index: 0,
        id: (expertTurn ? "native-expert-" : "native-skill-") + modelCalls,
        type: "function",
        function: {
          name: expertTurn ? "Agent" : "Skill",
          arguments: JSON.stringify(
            expertTurn
              ? {
                  description: "Native enterprise expert",
                  prompt: "NATIVE_ENTERPRISE_EXPERT_CHILD",
                  subagent_type: enterpriseExpert?.name,
                }
              : { skill: "enterprise:" + enterpriseAsset?.id },
          ),
        },
      };
  const output = workflowActor
    ? `NATIVE_UI_STEP_${workflowStep}_DONE`
    : "原生企业资产联动完成。";
  if (body.stream) {
    res.setHeader("content-type", "text/event-stream");
    if (toolTurn)
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
      for (const content of workflowActor
        ? [output]
        : ["原生企业资产", "联动完成。"])
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
            message: toolTurn
              ? { role: "assistant", content: null, tool_calls: [call] }
              : { role: "assistant", content: output },
            finish_reason: toolTurn ? "tool_calls" : "stop",
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
    if (adminSnapshot?.serve(req, res)) return;
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
app.addHook("onResponse", async (req, reply) => {
  const routeTemplate = req.routeOptions.url ?? null;
  const pathOnly = req.raw.url?.split(/[?#]/u, 1)[0];
  traffic.push({
    method: req.method,
    path: routeTemplate,
    routeTemplate,
    pathname: pathOnly?.startsWith("/") ? pathOnly : null,
    status: reply.statusCode,
  });
});
const password = randomBytes(24).toString("hex");
if (experienceMode)
  await writeFile(
    join(root, "browser-login.json"),
    JSON.stringify({ email: "desktop-owner@example.test", password }),
    { mode: 0o600, flag: "wx" },
  );
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
  ...(dynamicWorkflowMode === "alwaysOn" ? { contextWindow: 500000 } : {}),
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
const initialLimitAmounts = {
  department:
    dynamicWorkflowMode === "alwaysOn" || experienceMode ? 3000000 : 200000,
  member:
    dynamicWorkflowMode === "alwaysOn" || experienceMode ? 3000000 : 150000,
};
const departmentLimitAcknowledgement = await api(p + "/limits", "PUT", {
  subjectType: "department",
  subjectId: dA.id,
  amount: initialLimitAmounts.department,
});
const memberLimitAcknowledgement = await api(p + "/limits", "PUT", {
  subjectType: "member",
  subjectId: member.id,
  amount: initialLimitAmounts.member,
});
let workflowTestLimits;
if (dynamicWorkflowMode === "alwaysOn") {
  const limits = await api(p + "/limits");
  const department = limits.find(
    (row) => row.subject_type === "department" && row.subject_id === dA.id,
  );
  const memberLimit = limits.find(
    (row) => row.subject_type === "member" && row.subject_id === member.id,
  );
  if (
    departmentLimitAcknowledgement.ok !== true ||
    memberLimitAcknowledgement.ok !== true ||
    department?.amount !== initialLimitAmounts.department ||
    memberLimit?.amount !== initialLimitAmounts.member
  )
    throw Error("Native workflow test limits did not match the limits API");
  workflowTestLimits = {
    at: new Date().toISOString(),
    fixtureName,
    mode: dynamicWorkflowMode,
    configuredVia: "tenant limits PUT and GET APIs",
    verifiedByGet: true,
    department: { subjectId: dA.id, amount: department.amount },
    member: { subjectId: member.id, amount: memberLimit.amount },
  };
  await writeFile(
    join(evidence, "initial-test-limits.json"),
    JSON.stringify(workflowTestLimits, null, 2),
    { mode: 0o600 },
  );
}
const bobPassword = randomBytes(24).toString("hex");
await api(p + "/members", "POST", {
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
  `require('./env-guard.cjs');const {app}=require('electron');require('node:fs').writeFileSync(${JSON.stringify(join(process.cwd(), evidence, "native-runtime-info.json"))},JSON.stringify({pid:process.pid,isPackaged:app.isPackaged,appPath:app.getAppPath(),helpFallbackPath:require('node:path').join(app.getAppPath(),'../../config/default.json'),dynamicWorkflowMode:process.env.ZCODE_DYNAMIC_WORKFLOW_MODE??null}),{mode:0o600});app.setAsDefaultProtocolClient=()=>false;import(${JSON.stringify(pathToFileURL(join(appRoot, "out/main/index.js")).href)});`,
);
// 未打包的 Main 会搜索开发环境文件；拷贝正式产物到隔离根，不能借源目录启动。
const outSnapshot = await copyNativeOutSnapshot({
  source: join(client, "packages/desktop/out"),
  ownedRoot: runtimeRoot,
});
await writeFile(
  join(evidence, "native-out-snapshot.json"),
  JSON.stringify(outSnapshot, null, 2),
  { mode: 0o600 },
);
const mainHash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const mainEntrySha256 = mainHash(
  await readFile(join(appRoot, "out/main/index.js")),
);
if (
  mainEntrySha256 !==
  mainHash(await readFile(join(client, "packages/desktop/out/main/index.js")))
)
  throw Error("Copied production Main differs from source artifact");
await writeFile(
  join(appRoot, "env-guard.cjs"),
  `const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),url=require('node:url');
const roots=${JSON.stringify([process.cwd(), client])};
const report=${JSON.stringify(join(process.cwd(), evidence, "runtime-env-guard.json"))};
const state={active:true,pid:process.pid,blockedSourceEnvironmentReads:0};
const record=()=>fs.writeFileSync(report,JSON.stringify(state),{mode:0o600});
const blocked=file=>{try{const p=file instanceof URL?url.fileURLToPath(file):typeof file==='string'?path.resolve(file):'';return roots.includes(path.dirname(p))&&path.basename(p).startsWith('.env')}catch{return false}};
const refuse=()=>{state.blockedSourceEnvironmentReads++;record();return Object.assign(Error('Native fixture excludes source environment files'),{code:'ENOENT'})};
for(const [obj,key]of [[fs,'readFileSync'],[fsp,'readFile']]){const original=obj[key];obj[key]=function(file,...args){if(blocked(file)){const error=refuse();if(key==='readFile')return Promise.reject(error);throw error}return Reflect.apply(original,this,[file,...args])}};
const exists=fs.existsSync;fs.existsSync=function(file){if(blocked(file)){state.blockedSourceEnvironmentReads++;record();return false}return Reflect.apply(exists,this,[file])};
require('node:module').syncBuiltinESMExports();record();`,
  { mode: 0o600 },
);
for (const name of ["bundled-agents", "node_modules"])
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
  runtimeRoot,
  appRoot,
  helpLocalConfig,
  cert,
  certSpkiSha256,
  clientExperienceMode: experienceMode ?? null,
  ...(adminSnapshot ? { adminStaticSnapshot: adminSnapshot.manifest } : {}),
  home,
  modelId: model.id,
  mainEntrySha256,
  dynamicWorkflowMode: dynamicWorkflowMode ?? null,
  ...(workflowTestLimits ? { workflowTestLimits } : {}),
  copiedProductionMain: true,
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
async function expertCreate() {
  const name = "native-enterprise-expert";
  const created = await api(p + "/assets", "POST", {
    name,
    kind: "expert",
    scope: { all: true },
    content: {
      instructions: "NATIVE_APPROVED_ENTERPRISE_EXPERT_V1",
      profession: "Native acceptance expert",
    },
  });
  enterpriseExpert = { ...created, name };
  for (const operation of ["review", "publish"])
    await api(p + "/assets/" + enterpriseExpert.id + "/" + operation, "POST", {
      version: 1,
      ...(operation === "review" ? { approved: true } : {}),
    });
  // 只在隔离测试根内放同名个人对照，不改用户或项目真实配置。
  for (const storage of [".uwork", ".zcode"]) {
    const agents = join(home, storage, "agents");
    await mkdir(agents, { recursive: true, mode: 0o700 });
    await writeFile(
      join(agents, name + ".md"),
      `---\nname: ${name}\ndescription: Personal shadow must not replace approved expert\n---\nNATIVE_PERSONAL_SHADOW_MUST_NOT_REPLACE_ENTERPRISE`,
      { mode: 0o600 },
    );
  }
}
async function launch() {
  if (electron) throw Error("Already launched");
  electron = spawn(
    runtime.electron,
    [
      appRoot,
      ...(dynamicWorkflowMode === "alwaysOn"
        ? ["--open-workspace", workflowWorkspacePath]
        : []),
      "--remote-debugging-port=" + cdpPort,
    ],
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
        ZCODE_BASE_URL: origin,
        ...(dynamicWorkflowMode === "alwaysOn"
          ? { ZCODE_DYNAMIC_WORKFLOW_MODE: dynamicWorkflowMode }
          : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const { createWriteStream } = await import("node:fs");
  const log = createWriteStream(evidence + "/electron.log", {
    mode: 0o600,
    ...(dynamicWorkflowMode === "alwaysOn" ? { flags: "a" } : {}),
  });
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
async function stopNative() {
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
  if (dynamicWorkflowMode === "alwaysOn") {
    await writeFile(
      join(evidence, `native-stop-${child.pid}.json`),
      JSON.stringify({
        pid: child.pid,
        exitCode: child.exitCode,
        signalCode: child.signalCode,
      }),
      { mode: 0o600 },
    );
  }
}
async function saveWorkflowProof(name) {
  if (!/^[a-z0-9-]+$/.test(name)) throw Error("Invalid workflow proof name");
  const usage = await api(p + "/usage");
  await writeFile(
    join(evidence, name + "-workflow-proof.json"),
    JSON.stringify(
      {
        modelCalls,
        workflowFacts,
        workflowPendingReplies: workflowPendingReplies.size,
        traffic,
        modelRequests,
        ledger: usage.items.map((row) => ({
          id: row.id,
          status: row.status,
          amount: row.amount,
          inputTokens: row.inputTokens,
          outputTokens: row.outputTokens,
        })),
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
}
async function saveExperienceProof(name) {
  if (!/^[a-z0-9-]+$/.test(name)) throw Error("Invalid experience proof name");
  const configurations = {};
  for (const kind of ["scenes", "help", "desktop", "plugin-store"])
    configurations[kind] = await api(p + "/configurations/" + kind);
  const usage = await api(p + "/usage");
  await writeFile(
    join(evidence, name + "-experience-proof.json"),
    JSON.stringify(
      {
        modelCalls,
        configurations,
        traffic,
        modelRequests,
        ledger: usage.items.map((row) => ({
          id: row.id,
          status: row.status,
          amount: row.amount,
          inputTokens: row.inputTokens,
          outputTokens: row.outputTokens,
        })),
      },
      null,
      2,
    ),
    { mode: 0o600 },
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
  await attempt(stopNative);
  if (dynamicWorkflowMode === "alwaysOn")
    await attempt(() => saveWorkflowProof("final"));
  if (experienceMode) await attempt(() => saveExperienceProof("final"));
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
    JSON.stringify(
      {
        modelCalls,
        traffic,
        modelRequests,
        ...(dynamicWorkflowMode === "alwaysOn" ? { workflowFacts } : {}),
      },
      null,
      2,
    ),
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
    else if (
      c.op === "stopNative" &&
      (dynamicWorkflowMode === "alwaysOn" || experienceMode)
    )
      await stopNative();
    else if (
      c.op === "workflowPauseSecond" &&
      dynamicWorkflowMode === "alwaysOn"
    )
      workflowHoldSecond = true;
    else if (
      c.op === "workflowReleaseSecond" &&
      dynamicWorkflowMode === "alwaysOn"
    ) {
      workflowHoldSecond = false;
      for (const deliver of [...workflowPendingReplies]) deliver();
    } else if (
      c.op === "workflowSnapshot" &&
      dynamicWorkflowMode === "alwaysOn"
    )
      await saveWorkflowProof(c.name);
    else if (c.op === "experienceSnapshot" && experienceMode)
      await saveExperienceProof(c.name);
    else if (c.op === "pauseConfiguration") configurationPaused = true;
    else if (c.op === "resumeConfiguration") {
      configurationPaused = false;
      for (const deliver of configurationReplies) deliver();
    } else if (c.op === "draft") await saveDraft(c.kind, c.data);
    else if (c.op === "publish") await publishDraft(c.kind);
    else if (c.op === "configure") await configure(c.kind, c.data);
    else if (c.op === "assetCreate") await assetCreate();
    else if (c.op === "expertCreate") await expertCreate();
    else if (c.op === "expertRevoke")
      expertDenyPolicy = await api(p + "/policies", "POST", {
        name: "Native expert revoke",
        family: "expert",
        mode: "deny",
        resourceIds: [enterpriseExpert.id],
        scope: { all: true },
      });
    else if (c.op === "expertRestore")
      await api(p + "/policies/" + expertDenyPolicy.id, "DELETE");
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
          ...(dynamicWorkflowMode === "alwaysOn"
            ? {
                workflowFacts,
                workflowPendingReplies: workflowPendingReplies.size,
              }
            : {}),
          assetId: enterpriseAsset?.id,
          expertId: enterpriseExpert?.id,
          expertName: enterpriseExpert?.name,
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
    else if (c.op === "renameModel") {
      if (typeof c.name !== "string" || !c.name.trim() || c.name.length > 200)
        throw Error("Invalid fixture model name");
      const rows = await api(p + "/models");
      const current = rows.find((row) => row.id === model.id);
      if (!current) throw Error("Owned fixture model missing");
      await api(p + "/models/" + model.id, "PUT", {
        ...current.data,
        name: c.name.trim(),
        scope: current.scope,
        enabled: current.enabled,
        revision: current.revision,
      });
    } else if (c.op === "disableModel")
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
