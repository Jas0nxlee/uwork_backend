// 管理端真实浏览器的独占夹具；初始跨组织成员是准备数据，账本只由真实 HTTP 生成。
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { access, chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/identity.js";

type Row = Record<string, unknown>;
const root = resolve(process.env.UWORK_ADMIN_SLICES_ROOT ?? "");
const evidence = resolve(process.env.UWORK_ADMIN_SLICES_EVIDENCE ?? "");
const port = Number(process.env.UWORK_ADMIN_SLICES_PORT);
assert.ok(root.includes("uwork-admin-slices-"));
assert.ok(
  evidence.startsWith(
    resolve("evidence/admin-organization-usage-browser-20261017") + "/",
  ),
);
assert.ok(Number.isInteger(port) && port > 1024 && port !== 3000);
await mkdir(root, { recursive: true, mode: 0o700 });
await chmod(root, 0o700);
await mkdir(evidence, { recursive: true });
const save = async (file: string, value: unknown) => {
  const temporary = file + ".tmp";
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", {
    mode: 0o600,
  });
  await rename(temporary, file);
};
const password = randomBytes(24).toString("base64url");
const vendorSecret = randomBytes(32).toString("base64url");
const providerReceipts: Row[] = [];
const provider = createServer(async (req, res) => {
  try {
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/v1/chat/completions");
    assert.equal(req.headers.authorization, `Bearer ${vendorSecret}`);
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString()) as Row;
    const usage =
      body.model === "filtered"
        ? [11, 3]
        : body.model === "other"
          ? [7, 2]
          : [5, 1];
    providerReceipts.push({
      ordinal: providerReceipts.length + 1,
      model: body.model,
      inputTokens: usage[0],
      outputTokens: usage[1],
    });
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            message: { role: "assistant", content: "Owned fixture completion" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: usage[0], completion_tokens: usage[1] },
      }),
    );
  } catch {
    res.writeHead(400).end('{"error":"controlled_fixture_request_rejected"}');
  }
});
await new Promise<void>((done) => provider.listen(0, "127.0.0.1", done));
const providerPort = (provider.address() as { port: number }).port;
const browserUrl = `http://uwork-admin-slices.localhost:${port}`;
const origin = `http://127.0.0.1:${port}`;
const app = await createApp({
  database: join(root, "backend.sqlite"),
  masterKey: randomBytes(32),
  publicUrl: browserUrl,
  allowPrivateUpstreams: true,
  worker: false,
});
const httpReceipts: Row[] = [];
app.addHook("onResponse", async (req, reply) => {
  httpReceipts.push({
    method: req.method,
    path: req.url,
    status: reply.statusCode,
  });
});
let closing: Promise<void> | undefined;
let stopTimer: ReturnType<typeof setInterval> | undefined;
const ledger = () =>
  app.services.db.all<Row>(
    "SELECT id,tenant_id,user_id,department_id,application,model_id,status,amount,input_tokens,output_tokens FROM ledger ORDER BY created_at,id",
  );
async function close() {
  if (closing) return closing;
  closing = (async () => {
    clearInterval(stopTimer);
    await save(join(evidence, "fixture-final.json"), {
      http: httpReceipts,
      supplier: providerReceipts,
      ledger: ledger(),
    });
    app.server.closeAllConnections();
    await app.close();
    provider.closeAllConnections();
    await new Promise<void>((done) => provider.close(() => done()));
    await save(join(root, "fixture-stopped.json"), {
      backendClosed: !app.server.listening,
      supplierClosed: !provider.listening,
    });
  })();
  return closing;
}
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });

try {
  const email = "admin-shared@example.test";
  const a = await bootstrap(app.services.db, {
    name: "SHARED-ADMIN",
    email,
    password,
  });
  const b = await bootstrap(app.services.db, {
    name: "B-ONLY-MEMBER",
    email: "admin-b-only@example.test",
    password,
  });
  // 与既有用户链路夹具一致：仅准备同一用户的第二成员关系；不模拟外部企业同步成功。
  app.services.db.run(
    "INSERT INTO members(tenant_id,user_id,role,seat) VALUES(?,?,'admin',1)",
    b.tenantId,
    a.userId,
  );
  await app.listen({ host: "127.0.0.1", port });
  async function api(
    method: string,
    path: string,
    token = "",
    body?: unknown,
    expected = 200,
  ) {
    const response = await fetch(origin + path, {
      method,
      signal: AbortSignal.timeout(10000),
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    assert.equal(
      response.status,
      expected,
      `${method} ${path} returned ${response.status}`,
    );
    return (response.status === 204 ? {} : await response.json()) as Row;
  }
  const login = async (accountEmail: string, tenantId: string) =>
    String(
      (
        await api("POST", "/api/auth/login", "", {
          email: accountEmail,
          password,
          tenantId,
        })
      ).token,
    );
  const ownerA = await login(email, a.tenantId);
  const ownerB = await login("admin-b-only@example.test", b.tenantId);
  const pa = `/api/tenants/${a.tenantId}`,
    pb = `/api/tenants/${b.tenantId}`;
  await api("PATCH", pa, ownerA, { name: "SLICES-ORGANIZATION-A" });
  await api("PATCH", pb, ownerB, { name: "SLICES-ORGANIZATION-B" });
  const depA1 = await api(
    "POST",
    pa + "/departments",
    ownerA,
    { name: "A-DEPARTMENT-ONE" },
    201,
  );
  const depA2 = await api(
    "POST",
    pa + "/departments",
    ownerA,
    { name: "A-DEPARTMENT-TWO" },
    201,
  );
  const depB = await api(
    "POST",
    pb + "/departments",
    ownerB,
    { name: "B-DEPARTMENT-ONLY" },
    201,
  );
  await api("PATCH", `${pa}/members/${a.userId}`, ownerA, {
    departmentId: depA1.id,
  });
  await api("PATCH", `${pb}/members/${a.userId}`, ownerB, {
    departmentId: depB.id,
  });
  await api("PATCH", `${pb}/members/${b.userId}`, ownerB, {
    departmentId: depB.id,
  });
  const member = await api(
    "POST",
    pa + "/members",
    ownerA,
    {
      name: "A-ONLY-MEMBER",
      email: "admin-a-only@example.test",
      password,
      role: "member",
      seat: true,
      departmentId: depA2.id,
    },
    201,
  );
  async function model(prefix: string, token: string, label: string) {
    const credential = await api(
      "POST",
      prefix + "/credentials",
      token,
      { name: "Local controlled reference", value: vendorSecret },
      201,
    );
    return api(
      "POST",
      prefix + "/models",
      token,
      {
        name: label,
        upstreamModel: label,
        baseUrl: `http://127.0.0.1:${providerPort}/v1`,
        credentialId: credential.id,
        scope: { all: true },
        maxOutputTokens: 64,
        inputRate: 1000,
        outputRate: 1000,
      },
      201,
    );
  }
  const filtered = await model(pa, ownerA, "filtered"),
    other = await model(pa, ownerA, "other"),
    bModel = await model(pb, ownerB, "b-only");
  const memberSession = await login("admin-a-only@example.test", a.tenantId);
  for (const [token, modelId] of [
    [ownerA, filtered.id],
    [memberSession, filtered.id],
    [memberSession, other.id],
    [ownerB, bModel.id],
  ] as const)
    await api("POST", "/v1/chat/completions", token, {
      model: modelId,
      messages: [{ role: "user", content: "Owned local metering fixture" }],
      max_tokens: 32,
    });
  const rows = ledger();
  assert.equal(rows.length, 4);
  assert.ok(rows.every((r) => r.status === "settled"));
  assert.equal(providerReceipts.length, 4);
  assert.equal(
    rows
      .filter((r) => r.tenant_id === a.tenantId)
      .reduce((sum, r) => sum + Number(r.amount), 0),
    37,
  );
  await save(join(evidence, "fixture-seed.json"), {
    supplier: providerReceipts,
    ledger: rows,
    users: { shared: a.userId, aOnly: member.id, bOnly: b.userId },
    departments: { a1: depA1.id, a2: depA2.id, b: depB.id },
  });
  const html = await (await fetch(origin)).text();
  const jsPath = /src="([^"]+\.js)"/.exec(html)?.[1];
  assert.ok(jsPath, "production admin asset must exist");
  const staticJs = await (await fetch(origin + jsPath)).arrayBuffer();
  const sharedB = await login(email, b.tenantId);
  await save(join(root, "credentials.json"), {
    email,
    password,
    verificationSessions: { [a.tenantId]: ownerA, [b.tenantId]: sharedB },
  });
  await save(join(evidence, "fixture-public.json"), {
    status: "ready",
    browserUrl: browserUrl + "/",
    root,
    pid: process.pid,
    backendPort: port,
    supplierPort: providerPort,
    tenantA: a.tenantId,
    tenantB: b.tenantId,
    filteredModel: filtered.id,
    otherModel: other.id,
    bModel: bModel.id,
    staticJs: {
      path: jsPath,
      sha256: createHash("sha256").update(Buffer.from(staticJs)).digest("hex"),
    },
    initialSupplierCalls: providerReceipts.length,
  });
  await writeFile(join(root, "ready"), "ready\n", { mode: 0o600 });
  // 只输出无身份/凭据的信息。Browser driver从0700临时根读取合成登录材料。
  console.log("Owned admin organization/usage fixture ready");
  // 测试宿主先请求正常关闭并等待证据落盘，避免运行器对SIGTERM的提前收尾截断异步文件写入。
  stopTimer = setInterval(() => {
    void access(join(root, "stop")).then(
      () => close().then(() => process.exit(0)),
      () => {},
    );
  }, 100);
} catch (error) {
  await save(join(evidence, "fixture-error.json"), {
    error: error instanceof Error ? error.message : "fixture failed",
  });
  await close();
  process.exitCode = 1;
}
