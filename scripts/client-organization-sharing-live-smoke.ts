import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { test, type TestContext } from "node:test";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/identity.js";

/**
 * 自有后台受管组织分享的真实 HTTP 闭环。
 *
 * 覆盖 SPEC-enterprise-sharing.md「实现与验证次序」第 5 步中不依赖真实企微的部分：真实
 * Host 源码经私有 BackendSession 发布 → 同企业另一成员在真实 HTTP Cookie 会话下只读查看
 * → 他企业/未登录/终端凭据拒绝 → 策略关闭、撤销、成员停用后逐次拒绝。
 *
 * 身份适配器与企微 provider 是受控替身；分享能力、存储、授权、Cookie 与浏览页都是真实实现。
 * 真实企业微信、公网出口、外部网盘与已安装 Native/三平台仍不在本脚本范围内。
 */
type Row = Record<string, unknown>;
interface PublicationAuthorization {
  authorize(files: boolean, target?: string): Promise<AbortSignal | undefined>;
  readonly managedScope?: unknown;
}
const evidence = resolve(
  process.env.UWORK_ORGANIZATION_SHARING_EVIDENCE ??
    "evidence/client-organization-sharing-20261018",
);
const clientRoot = resolve(process.env.UWORK_CLIENT_PATH ?? "clients/uwork");
let fixtureSequence = 0;
const source = (path: string) =>
  import(pathToFileURL(join(clientRoot, "packages/services/src", path)).href);
const password = "Controlled-organization-sharing-1";
const textBytes = Buffer.from("controlled organization attachment\n", "utf8");
// 1x1 透明 PNG；后端只按声明类型/长度/摘要存储，不做恶意软件扫描。
const pngBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AARAwB/wD7yQKlAAAAAElFTkSuQmCC",
  "base64",
);
const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

/**
 * 投影必须与上传的 descriptor 引用闭包一致：每个附件既要有 artifact 行，也要在被引用处
 * 出现；后端会拒绝摘要正确但错接附件的确认。
 */
function projectionRows(artifacts: Row[], text: string) {
  const base = {
    turnId: "turn",
    productTurnId: "product",
    createdAt: 1,
  };
  const rows: Row[] = [
    {
      ...base,
      rowId: 1,
      entityId: "input",
      kind: "userInput",
      origin: "realUser",
      text,
      createdAtSeq: 1,
      ...(artifacts.length === 0
        ? {}
        : {
            attachments: artifacts.map((artifact, index) => ({
              ref: artifact.ref,
              fileName: artifact.display_name,
              mime: artifact.mime_type,
              bytes: artifact.size_bytes,
              ...(index > 0 && artifact.artifact_type === "image"
                ? { previewRef: artifact.ref }
                : {}),
            })),
          }),
    },
    {
      ...base,
      rowId: 2,
      entityId: "answer",
      kind: "assistantText",
      state: "complete",
      text: "答案正文",
      createdAtSeq: 2,
    },
  ];
  for (const artifact of artifacts)
    rows.push({
      ...base,
      rowId: rows.length + 1,
      entityId: `artifact-${String(artifact.artifact_id)}`,
      createdAtSeq: rows.length + 1,
      kind: "artifact",
      artifactVersionId: artifact.artifact_id,
      logicalArtifactKey: artifact.logical_artifact_key,
      displayName: artifact.display_name,
      artifactType: artifact.artifact_type,
      mimeType: artifact.mime_type,
      sizeBytes: artifact.size_bytes,
      sha256: artifact.sha256,
      ref: artifact.ref,
      state: "current",
    });
  return rows;
}

/** 先占位再释放，让 PUBLIC_URL 与真实监听 origin 一致，Cookie/Origin 校验才是真实语义。 */
async function unusedOwnedPort() {
  const reservation = createServer();
  await new Promise<void>((resolve_, reject) => {
    reservation.once("error", reject);
    reservation.listen(0, "127.0.0.1", resolve_);
  });
  const address = reservation.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve_, reject) =>
    reservation.close((error) => (error ? reject(error) : resolve_())),
  );
  return address.port;
}

async function fixture(t: TestContext) {
  const fixtureId = ++fixtureSequence;
  const directory = await mkdtemp(
    join(tmpdir(), "uwork-organization-sharing-"),
  );
  const cleanup: (() => Promise<unknown> | unknown)[] = [
    () => rm(directory, { recursive: true, force: true }),
  ];
  t.after(async () => {
    const failures: unknown[] = [];
    for (const close of cleanup.reverse()) {
      try {
        await close();
      } catch (error) {
        failures.push(error);
      }
    }
    const directoryAbsent = await stat(directory).then(
      () => false,
      (error: unknown) =>
        !!error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT",
    );
    await mkdir(evidence, { recursive: true });
    await writeFile(
      join(evidence, `cleanup-${fixtureId}.json`),
      `${JSON.stringify({ directoryAbsent, failures: failures.length, steps: cleanup.length }, null, 2)}\n`,
    );
    assert.equal(failures.length, 0, "所有自有资源都关闭");
    assert.equal(directoryAbsent, true);
  });
  const [
    identityModule,
    lifecycle,
    storeModule,
    backendModule,
    policyModule,
    httpModule,
    integrityModule,
  ] = await Promise.all([
    source("enterprise-identity/enterpriseIdentityService.ts"),
    source("enterprise-identity/identityServiceLifecycle.ts"),
    source("enterprise-identity/identitySessionStore.ts"),
    source("enterprise-identity/uworkBackendSession.ts"),
    source("conversation-share/uworkPublicationPolicy.ts"),
    source("conversation-share/conversationShareHttpClient.ts"),
    source("conversation-share/conversationShareIntegrity.ts"),
  ]);
  // 真实文件库与真实 TCP；worker 关闭以免后台巡检干扰断言。
  const port = await unusedOwnedPort();
  const publicUrl = `http://127.0.0.1:${port}`;
  const app = await createApp({
    database: join(directory, "backend.sqlite"),
    masterKey: randomBytes(32),
    publicUrl,
    worker: false,
  });
  const origin = await app.listen({ host: "127.0.0.1", port });
  cleanup.push(async () => {
    app.server.closeAllConnections();
    await app.close();
  });

  const checks: { label: string; status: number }[] = [];
  const secretTokens = new Set<string>();
  const request = async (
    label: string,
    method: string,
    path: string,
    options: {
      token?: string;
      cookie?: string;
      body?: unknown;
      expected?: number;
    } = {},
  ) => {
    const response = await fetch(origin + path, {
      method,
      signal: AbortSignal.timeout(10000),
      headers: {
        connection: "close",
        // 真实后台要求写入请求带同源 Origin；Cookie 会话与浏览器行为一致。
        ...(["GET", "HEAD"].includes(method) ? {} : { origin }),
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
        ...(options.cookie ? { cookie: options.cookie } : {}),
        ...(options.body === undefined
          ? {}
          : { "content-type": "application/json" }),
      },
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
    });
    checks.push({ label, status: response.status });
    assert.equal(
      response.status,
      options.expected ?? 200,
      `${label}: ${await response.clone().text()}`,
    );
    return response;
  };
  const ownerA = await bootstrap(app.services.db, {
    name: "Organization A",
    email: "organization-owner-a@example.test",
    password,
  });
  const ownerB = await bootstrap(app.services.db, {
    name: "Organization B",
    email: "organization-owner-b@example.test",
    password,
  });
  const login = async (email: string, tenantId?: string) => {
    const response = await request(
      "real-interactive-login",
      "POST",
      "/api/auth/login",
      {
        body: { email, password, ...(tenantId ? { tenantId } : {}) },
      },
    );
    const token = String((await response.json()).token);
    secretTokens.add(token);
    return token;
  };
  const tokenA = await login("organization-owner-a@example.test"),
    tokenB = await login("organization-owner-b@example.test");
  const prefixA = `/api/tenants/${ownerA.tenantId}`;
  const configure = async (kind: string, patch: Row) => {
    const current = await (
      await request(
        "read-published-policy",
        "GET",
        `${prefixA}/configurations/${kind}`,
        {
          token: tokenA,
        },
      )
    ).json();
    const saved = await (
      await request(
        "save-policy-draft",
        "PUT",
        `${prefixA}/configurations/${kind}`,
        {
          token: tokenA,
          body: {
            revision: current.revision,
            data: { ...current.published, ...patch },
          },
        },
      )
    ).json();
    await request(
      "publish-policy",
      "POST",
      `${prefixA}/configurations/${kind}/publish`,
      {
        token: tokenA,
        body: { revision: saved.revision },
      },
    );
  };
  await configure("sharing", {
    publish: "organization",
    collaborate: "organization",
    files: true,
  });
  await configure("security", { allowFilesystem: true });
  // 无席位成员：组织内查看不要求模型席位。
  const reader = await (
    await request("create-member-without-seat", "POST", `${prefixA}/members`, {
      token: tokenA,
      body: {
        name: "Organization Reader",
        email: "organization-reader@example.test",
        password,
        role: "member",
        seat: false,
      },
      expected: 201,
    })
  ).json();
  const cookieLogin = async () => {
    const response = await request(
      "real-cookie-login",
      "POST",
      "/api/auth/login",
      {
        body: {
          email: "organization-reader@example.test",
          password,
          tenantId: ownerA.tenantId,
          delivery: "cookie",
        },
      },
    );
    const body = (await response.json()) as Row;
    assert.equal(body.token, undefined, "Cookie 交付不得返回 Token");
    const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0]!;
    assert.match(cookie, /^uwork_session=/u);
    secretTokens.add(cookie.slice("uwork_session=".length));
    return cookie;
  };
  const deviceToken = String(
    (
      await (
        await request("issue-device-token", "POST", "/api/auth/device-tokens", {
          token: tokenA,
          body: {},
          expected: 201,
        })
      ).json()
    ).token,
  );
  secretTokens.add(deviceToken);

  // 真实 Host 私有身份所有者：适配器是受控替身，传输/ fencing/额度都是真实实现。
  const values = new Map<string, string>();
  const credentials = {
    load: async (key: string) => values.get(key) ?? null,
    save: async (key: string, value: string) => {
      values.set(key, value);
    },
    delete: async (key: string) => {
      values.delete(key);
    },
  };
  const sessionStore = storeModule.createSharedIdentitySessionStore(
    credentials,
    async (operation: () => Promise<unknown>) => operation(),
  );
  let authoritySession = {
    token: tokenA,
    issuerOrigin: origin,
    expiresAt: Date.now() + 3600000,
    profile: {
      id: ownerA.userId,
      tenantId: ownerA.tenantId,
      provider: "wecom",
      displayName: "Controlled Owner A",
    },
  };
  const callback = "https://controlled-wecom.example.test/callback",
    state = "controlled-organization-state";
  const identity = identityModule.createEnterpriseIdentityService({
    credentials,
    sessionStore,
    adapter: {
      listOrganizations: () => [
        { id: ownerA.tenantId },
        { id: ownerB.tenantId },
      ],
      resolveOrganization: () => ({ id: authoritySession.profile.tenantId }),
      start: async () => ({
        id: state,
        callbackUrl: callback,
        authorizationUrl: `https://controlled-wecom.example.test/login?state=${state}`,
        expiresAt: Date.now() + 60000,
      }),
      complete: async () => authoritySession,
      restore: async () => authoritySession,
    },
  });
  cleanup.push(async () => {
    await identityModule.disposeEnterpriseIdentityService(identity);
    values.clear();
  });
  const backendSession = backendModule.createUWorkBackendSession({
    resolveConfig: async () => ({ backend: "uwork", apiBaseUrl: origin }),
    readAuthority: () => lifecycle.readEnterpriseIdentityAuthority(identity),
    readPersistedSession: () => sessionStore.read(),
  });
  const ports = policyModule.createUWorkSharePorts(backendSession);
  const legacyUsage = { oauth: 0, apiClient: 0, defaultFetch: 0 };
  const client = new httpModule.ConversationShareHttpClient({
    managedTransport: ports.managedTransport,
    baseUrl: "https://legacy-public-share.example.test/api/v1",
    apiClient: {
      async request() {
        legacyUsage.apiClient += 1;
        throw new Error("受管分享不得走旧 ApiClient");
      },
    },
    tokenProvider: async () => {
      legacyUsage.oauth += 1;
      throw new Error("受管分享不得走旧 OAuth Token");
    },
    timeoutMs: 10000,
    confirmTimeoutMs: 10000,
  });
  const installOwner = async () => {
    if (lifecycle.readEnterpriseIdentityAuthority(identity)?.session)
      await identity.logout();
    const attempt = await identity.beginLogin();
    await identity.completeLogin(
      attempt.id,
      `${callback}?code=controlled&state=${state}`,
    );
  };
  await installOwner();
  return {
    app,
    origin,
    checks,
    request,
    tokenA,
    tokenB,
    deviceToken,
    prefixA,
    configure,
    readerId: String(reader.id),
    cookieLogin,
    client,
    ports,
    integrityModule,
    legacyUsage,
    secretTokens,
    ownerA,
    ownerB,
    selectOwnerB: async () => {
      authoritySession = {
        ...authoritySession,
        token: tokenB,
        profile: {
          id: ownerB.userId,
          tenantId: ownerB.tenantId,
          provider: "wecom",
          displayName: "Controlled Owner B",
        },
      };
      await installOwner();
    },
    selectOwnerA: async () => {
      authoritySession = {
        ...authoritySession,
        token: tokenA,
        profile: {
          id: ownerA.userId,
          tenantId: ownerA.tenantId,
          provider: "wecom",
          displayName: "Controlled Owner A",
        },
      };
      await installOwner();
    },
    async publish(options: {
      clientRequestId: string;
      rows?: Row[];
      artifacts?: Row[];
      text?: string;
    }) {
      // 动态导入的客户端源码在这里是 any；显式标注保持回调参数与项目 strict 设置一致。
      return ports.publicationPolicy.run(
        async (authorization: PublicationAuthorization) => {
          const capabilities = await client.getCapabilities(authorization);
          assert.deepEqual(capabilities.access_modes, ["organization"]);
          const artifacts = (options.artifacts ?? []) as {
            artifact_id: string;
            [key: string]: unknown;
          }[];
          const rows =
            options.rows ??
            projectionRows(
              artifacts as unknown as Row[],
              options.text ?? "Controlled organization content",
            );
          const confirmRequest =
            integrityModule.buildConversationShareConfirmRequest({
              selected_product_turn_ids: ["product"],
              projection: { rows },
              disclosure_confirmation: {
                version: 1,
                accepted_at: Date.now(),
                acknowledged_no_secret_detection: true,
              },
              artifacts,
            } as never);
          const preparation = await client.createPreparation(
            {
              client_request_id: options.clientRequestId,
              title: "Controlled organization share",
              schema_version: 1,
              access_mode: "organization",
              payload_sha256:
                integrityModule.sha256ConversationShareJson(confirmRequest),
              artifact_count: artifacts.length,
            } as Row,
            authorization,
          );
          const uploaded: unknown[] = [];
          for (const artifact of artifacts) {
            const bytes =
              artifact.artifact_type === "image" ? pngBytes : textBytes;
            uploaded.push(
              await client.uploadArtifact(
                preparation.preparation_id,
                artifact,
                new Blob([Uint8Array.from(bytes)], {
                  type: String(artifact.mime_type),
                }),
                authorization,
              ),
            );
          }
          const record = await client.confirm(
            preparation.preparation_id,
            confirmRequest,
            authorization,
            artifacts.length > 0,
          );
          return { record, capabilities, uploaded, confirmRequest };
        },
      );
    },
  };
}

const artifactDescriptor = (input: {
  id: string;
  type: "text" | "image";
  name: string;
  extension: string;
  mime: string;
  bytes: Buffer;
}) => ({
  artifact_id: input.id,
  logical_artifact_key: input.id,
  producer_product_turn_id: "product",
  artifact_version: 1,
  state: "current",
  ref: `zcode-artifact://share/${input.id}`,
  artifact_type: input.type,
  display_name: input.name,
  extension: input.extension,
  mime_type: input.mime,
  size_bytes: input.bytes.byteLength,
  sha256: sha(input.bytes),
});

test("real HTTP organization publishing through the managed Host port stays readable by another unseated member", async (t) => {
  const f = await fixture(t);
  const text = artifactDescriptor({
    id: "report",
    type: "text",
    name: "report.txt",
    extension: "txt",
    mime: "text/plain",
    bytes: textBytes,
  });
  const preview = artifactDescriptor({
    id: "preview-card",
    type: "image",
    name: "card.png",
    extension: "png",
    mime: "image/png",
    bytes: pngBytes,
  });
  const rows = projectionRows([text, preview], "受管组织分享正文");
  const { record, capabilities, uploaded } = await f.publish({
    clientRequestId: "controlled-request-1",
    rows,
    artifacts: [text, preview],
  });
  assert.equal(record.access_mode, "organization");
  assert.equal(record.share_url, `${f.origin}/share/${record.share_code}`);
  assert.equal(capabilities.access_modes.length, 1);
  assert.equal(uploaded.length, 2);
  assert.equal(
    f.legacyUsage.oauth + f.legacyUsage.apiClient,
    0,
    "受管发布不得触碰旧 OAuth/API 通路",
  );

  // 同企业无席位成员：真实 Cookie 会话只读查看。
  const cookie = await f.cookieLogin();
  const previewResponse = await f.request(
    "member-cookie-preview",
    "GET",
    `/api/client/shares/${record.share_code}/preview`,
    { cookie },
  );
  const previewBody = (await previewResponse.json()) as Row;
  assert.equal(
    (previewBody.share as Row).title,
    "Controlled organization share",
  );
  assert.equal((previewBody.share as Row).access_mode, "organization");
  assert.equal(previewBody.can_revoke, false, "普通成员不能撤销他人分享");
  assert.equal((previewBody.rows as Row[]).length, rows.length);
  assert.equal(
    (previewBody.artifacts as Row[]).length,
    2,
    "预览必须回显完整 descriptor 集合",
  );

  // Host 只读附件走同源有限 JSON 端口，字节/长度/摘要逐项复核。
  const pngArtifact = (previewBody.artifacts as Row[]).find(
    (artifact) => artifact.artifact_id === preview.artifact_id,
  )!;
  const managed = await f.client.downloadManagedArtifact(
    String(pngArtifact.url),
    pngArtifact,
  );
  assert.equal(managed.managed, true);
  const downloaded = (
    managed as { managed: true; value: { bytes: Uint8Array } }
  ).value.bytes;
  assert.equal(Buffer.from(downloaded).equals(pngBytes), true);

  // 浏览器同源 Cookie 下载：强制附件与 nosniff。
  const content = await f.request(
    "member-cookie-content",
    "GET",
    `/api/client/shares/${record.share_code}/artifacts/${text.artifact_id}/content`,
    { cookie },
  );
  assert.equal(content.headers.get("content-type"), "application/octet-stream");
  assert.equal(content.headers.get("x-content-type-options"), "nosniff");
  assert.match(
    content.headers.get("content-disposition") ?? "",
    /^attachment;/u,
  );
  assert.equal(
    Buffer.from(await content.arrayBuffer()).equals(textBytes),
    true,
  );

  // 浏览页是自有同源只读页；未认证时只有登录入口，不含正文。
  const page = await f.request(
    "anonymous-viewer-page",
    "GET",
    `/share/${record.share_code}`,
  );
  const html = await page.text();
  assert.match(html, /data-testid="share-viewer"/u);
  assert.equal(
    html.includes("受管组织分享正文"),
    false,
    "浏览页不得内嵌分享正文",
  );
  assert.match(
    page.headers.get("content-security-policy") ?? "",
    /default-src 'none'/u,
  );

  // 只读语义：受管导入在任何本地写入之前被明确拒绝。
  await assert.rejects(
    () =>
      f.client.assertImportAllowed(String(record.share_code), {
        schema_version: 1,
        client_request_id: "controlled-import-1",
      }),
    (error: { kind?: string }) => error.kind === "import_not_allowed",
  );
  assert.equal(
    f.legacyUsage.oauth + f.legacyUsage.apiClient,
    0,
    "只读查看同样不得回退旧 OAuth/API 通路",
  );
  await mkdir(evidence, { recursive: true });
  await writeFile(
    join(evidence, "organization-publish.json"),
    `${JSON.stringify({ status: "passed", checks: f.checks, artifacts: 2, rows: rows.length }, null, 2)}\n`,
  );
});

test("real HTTP organization reads stay closed for other tenants, anonymous, device, revoked and closed-policy states", async (t) => {
  const f = await fixture(t);
  const text = artifactDescriptor({
    id: "report",
    type: "text",
    name: "report.txt",
    extension: "txt",
    mime: "text/plain",
    bytes: textBytes,
  });
  const { record } = await f.publish({
    clientRequestId: "controlled-request-closure",
    text: "受管组织分享正文",
    artifacts: [text],
  });
  const path = `/api/client/shares/${record.share_code}/preview`;
  const artifactPath = `/api/client/shares/${record.share_code}/artifacts/${text.artifact_id}`;
  let cookie = await f.cookieLogin();
  const beforeFilesClosed = await (
    await f.request("member-cookie-preview", "GET", path, { cookie })
  ).json();
  await f.request("cross-tenant-member-denied", "GET", path, {
    token: f.tokenB,
    expected: 404,
  });
  await f.request("anonymous-denied", "GET", path, { expected: 401 });
  await f.request("device-token-denied", "GET", path, {
    token: f.deviceToken,
    expected: 403,
  });
  await f.request(
    "unknown-code-denied",
    "GET",
    `/api/client/shares/${"a".repeat(32)}/preview`,
    {
      token: f.tokenA,
      expected: 404,
    },
  );
  await f.request(
    "continuation-denied",
    "POST",
    `/api/client/shares/${record.share_code}/continuation`,
    {
      cookie,
      body: { schema_version: 1, client_request_id: "controlled-continuation" },
      expected: 403,
    },
  );
  const loginContext = await f.request(
    "anonymous-login-context",
    "GET",
    `/api/auth/shares/${record.share_code}/context`,
  );
  assert.deepEqual(await loginContext.json(), { tenantId: f.ownerA.tenantId });

  // 文件权限关闭后：正文与 descriptor 仍可读，字节读取再授权时拒绝。
  await f.configure("sharing", { files: false });
  const withoutFiles = await (
    await f.request("preview-after-files-closed", "GET", path, { cookie })
  ).json();
  assert.equal(
    (withoutFiles.artifacts as Row[]).length,
    1,
    "关闭 files 后预览仍回显原 descriptor 元数据",
  );
  assert.equal(
    (withoutFiles.integrity as Row).artifact_set_sha256,
    (beforeFilesClosed.integrity as Row).artifact_set_sha256,
    "访问策略变化不得重写附件集合摘要",
  );
  await f.request("files-closed-artifact-json-denied", "GET", artifactPath, {
    cookie,
    expected: 403,
  });
  await f.request(
    "files-closed-content-denied",
    "GET",
    `${artifactPath}/content`,
    {
      cookie,
      expected: 403,
    },
  );
  await f.configure("sharing", { files: true });
  await f.request("files-restored-artifact-json", "GET", artifactPath, {
    cookie,
  });

  // 成员停用与退出：后续正文请求按当前成员判定拒绝。
  f.app.services.db.run(
    "UPDATE members SET status='disabled' WHERE tenant_id=? AND user_id=?",
    f.ownerA.tenantId,
    f.readerId,
  );
  await f.request("disabled-member-denied", "GET", path, {
    cookie,
    expected: 401,
  });
  f.app.services.db.run(
    "UPDATE members SET status='active' WHERE tenant_id=? AND user_id=?",
    f.ownerA.tenantId,
    f.readerId,
  );
  await f.request("member-restored", "GET", path, { cookie });
  await f.request("member-logout", "POST", "/api/auth/logout", {
    cookie,
    body: {},
    expected: 204,
  });
  await f.request("logged-out-member-denied", "GET", path, {
    cookie,
    expected: 401,
  });
  cookie = await f.cookieLogin();
  await f.request("member-relogin-restored", "GET", path, { cookie });

  // 发布权限整体关闭：正文与附件都拒绝，但发布者仍能撤销自己的既有内容。
  await f.configure("sharing", { publish: "disabled" });
  await f.request("publish-disabled-denied", "GET", path, {
    cookie,
    expected: 403,
  });
  await f.request(
    "owner-can-still-revoke",
    "DELETE",
    `/api/client/shares/${record.share_code}`,
    { token: f.tokenA, expected: 204 },
  );
  await f.configure("sharing", { publish: "organization" });
  await f.request("revoked-share-absent", "GET", path, {
    cookie,
    expected: 404,
  });
  await f.request("revoked-artifact-absent", "GET", artifactPath, {
    cookie,
    expected: 404,
  });
  await f.request("revoked-content-absent", "GET", `${artifactPath}/content`, {
    cookie,
    expected: 404,
  });
  const rows = f.app.services.db.get<{ n: number }>(
    "SELECT count(*) AS n FROM conversation_shares WHERE share_code=? AND status='revoked'",
    record.share_code,
  )!;
  assert.equal(rows.n, 1, "撤销后保留不可读的墓碑记录");
  await mkdir(evidence, { recursive: true });
  await writeFile(
    join(evidence, "organization-closure.json"),
    `${JSON.stringify({ status: "passed", checks: f.checks }, null, 2)}\n`,
  );
});

test("real HTTP organization publishing carries a bounded large projection and rejects oversized ones", async (t) => {
  const f = await fixture(t);
  // 300 KiB 投影：超过普通 64 KiB 请求上限，仍在 confirm 的 1 MiB 预算内。
  const large = "x".repeat(300 * 1024);
  const { record } = await f.publish({
    clientRequestId: "controlled-request-large",
    text: large,
  });
  const cookie = await f.cookieLogin();
  const preview = await (
    await f.request(
      "large-preview",
      "GET",
      `/api/client/shares/${record.share_code}/preview`,
      {
        cookie,
      },
    )
  ).json();
  assert.equal(
    (((preview.rows as Row[])[0] as Row).text as string).length,
    large.length,
  );
  // 超过 1 MiB 的确认体在客户端私有端口被拒绝，不会到达后端。
  const oversized = await f
    .publish({
      clientRequestId: "controlled-request-too-large",
      text: "y".repeat(1024 * 1024 + 4096),
    })
    .then(
      () => null,
      (error: unknown) => error as { kind?: string; status?: number },
    );
  assert.equal(oversized?.status, undefined, "超界请求不得依赖后端状态码兜底");
  assert.ok(
    ["limit_exceeded", "feature_disabled"].includes(oversized?.kind ?? ""),
    `超界请求必须以封闭的分享错误结束：${oversized?.kind}`,
  );
  const persisted = f.app.services.db.get<{ n: number }>(
    "SELECT count(*) AS n FROM conversation_shares WHERE status='confirmed'",
  )!.n;
  assert.equal(persisted, 1, "被拒绝的超界发布不得留下第二个可读分享");
  await mkdir(evidence, { recursive: true });
  await writeFile(
    join(evidence, "organization-bounds.json"),
    `${JSON.stringify({ status: "passed", checks: f.checks, largeBytes: large.length }, null, 2)}\n`,
  );
});
