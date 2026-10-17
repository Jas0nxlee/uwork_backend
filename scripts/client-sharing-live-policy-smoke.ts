import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { createServer } from "node:http";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { test, type TestContext } from "node:test";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/identity.js";

// Tests the existing SPEC-client-policy / uwork-conversation-sharing contracts.
// No new sharing policy, external account integration or cloud implementation.
type Row = Record<string, unknown>;
const evidence = resolve("evidence/client-sharing-live-policy-20261017");
const clientRoot = resolve("clients/uwork");
let fixtureSequence = 0;
const source = (path: string) =>
  import(pathToFileURL(join(clientRoot, "packages/services/src", path)).href);
const deferred = () => {
  let resolveValue!: () => void;
  const promise = new Promise<void>((done) => {
    resolveValue = done;
  });
  return { promise, resolve: resolveValue };
};

async function fixture(t: TestContext, withOwnedArtifact = false) {
  const fixtureId = ++fixtureSequence;
  const directory = await mkdtemp(join(tmpdir(), "uwork-sharing-live-"));
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
    const ownedDirectoryAbsent = await stat(directory).then(
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
      JSON.stringify(
        {
          ownedDirectoryAbsent,
          cleanupErrors: failures.length,
          resourceCleanupSteps: cleanup.length,
        },
        null,
        2,
      ) + "\n",
    );
    assert.equal(failures.length, 0, "all owned sharing resources close");
    assert.equal(ownedDirectoryAbsent, true);
  });
  const [
    identityModule,
    lifecycle,
    storeModule,
    backendModule,
    policyModule,
    httpModule,
    serviceModule,
    apiModule,
    networkModule,
    localArtifactModule,
  ] = await Promise.all([
    source("enterprise-identity/enterpriseIdentityService.ts"),
    source("enterprise-identity/identityServiceLifecycle.ts"),
    source("enterprise-identity/identitySessionStore.ts"),
    source("enterprise-identity/uworkBackendSession.ts"),
    source("conversation-share/uworkPublicationPolicy.ts"),
    source("conversation-share/conversationShareHttpClient.ts"),
    source("conversation-share/conversationShareService.ts"),
    source("providers/api/nodeApiClient.ts"),
    source("providers/api/nodeApiNetwork.ts"),
    source("conversation-share/conversationShareArtifactSource.ts"),
  ]);
  const options = {
    database: join(directory, "backend.sqlite"),
    masterKey: randomBytes(32),
    publicUrl: "http://localhost:3000",
    worker: false,
  };
  const tenantLabels = new Map<string, string>();
  const policyHttp: {
    action: unknown;
    channel: unknown;
    target: unknown;
    status: number;
    allowed: boolean;
    tenant: string;
    origin: "fixture-control" | "actual-host-policy";
    errorCode?: unknown;
  }[] = [];
  const instrument = (target: Awaited<ReturnType<typeof createApp>>) =>
    target.addHook("onSend", async (req, reply, payload) => {
      if (req.url.split("?")[0] === "/api/client/authorize") {
        const body = req.body as Row;
        const response = (
          typeof payload === "string" ? JSON.parse(payload) : {}
        ) as Row;
        const token = req.headers.authorization?.startsWith("Bearer ")
          ? req.headers.authorization.slice(7)
          : "";
        const actor = target.services.db.get<{ tenant_id: string }>(
          "SELECT tenant_id FROM sessions WHERE hash=?",
          createHash("sha256").update(token).digest("hex"),
        );
        policyHttp.push({
          action: body.action,
          channel: body.channel ?? "local",
          target: body.target ?? "",
          status: reply.statusCode,
          allowed: response.allowed === true,
          tenant:
            tenantLabels.get(String(response.tenantId ?? actor?.tenant_id)) ??
            "unavailable",
          origin:
            req.headers["x-uwork-controlled-probe"] === "control"
              ? "fixture-control"
              : "actual-host-policy",
          ...(response.error
            ? { errorCode: (response.error as Row).code }
            : {}),
        });
      }
      return payload;
    });
  let app = await createApp(options);
  instrument(app);
  let origin = await app.listen({ host: "127.0.0.1", port: 0 });
  cleanup.push(async () => {
    app.server.closeAllConnections();
    await app.close();
  });
  const backendChecks: { label: string; status: number }[] = [];
  const secretTokens = new Set<string>();
  async function api(
    label: string,
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
        connection: "close",
        "x-uwork-controlled-probe": "control",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    assert.equal(response.status, expected, label);
    const text = await response.text();
    backendChecks.push({ label, status: response.status });
    return (text ? JSON.parse(text) : {}) as Row;
  }
  const password = "Synthetic-sharing-password!";
  const a = await bootstrap(app.services.db, {
    name: "Sharing A",
    email: "share-owner-a@example.test",
    password,
  });
  const b = await bootstrap(app.services.db, {
    name: "Sharing B",
    email: "share-owner-b@example.test",
    password,
  });
  tenantLabels.set(a.tenantId, "A");
  tenantLabels.set(b.tenantId, "B");
  const login = async (email: string, tenantId?: string) => {
    const response = await api(
      "real-interactive-login",
      "POST",
      "/api/auth/login",
      "",
      { email, password, ...(tenantId ? { tenantId } : {}) },
    );
    const token = String(response.token);
    secretTokens.add(token);
    return token;
  };
  const ownerA = await login("share-owner-a@example.test"),
    ownerB = await login("share-owner-b@example.test");
  const pa = `/api/tenants/${a.tenantId}`,
    pb = `/api/tenants/${b.tenantId}`;
  const alice = await api(
    "create-controlled-sharing-member",
    "POST",
    `${pa}/members`,
    ownerA,
    {
      name: "Alice",
      email: "sharing-alice@example.test",
      password,
      role: "member",
      seat: true,
    },
    201,
  );
  // Synthetic fixture setup only: no enterprise synchronization is contacted.
  app.services.db.run(
    "INSERT INTO members(tenant_id,user_id,role,seat) VALUES(?,?,'member',1)",
    b.tenantId,
    String(alice.id),
  );
  const privateA = await login("sharing-alice@example.test", a.tenantId);
  let selectedSession = {
    token: privateA,
    issuerOrigin: origin,
    expiresAt: Date.now() + 60000,
    profile: {
      id: String(alice.id),
      tenantId: a.tenantId,
      provider: "wecom",
      displayName: "Synthetic Alice",
    },
  };
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
  const callback = "https://fixture.example.test/callback",
    state = "controlled-sharing-state";
  const identity = identityModule.createEnterpriseIdentityService({
    credentials,
    sessionStore,
    adapter: {
      listOrganizations: () => [{ id: a.tenantId }, { id: b.tenantId }],
      resolveOrganization: () => ({ id: selectedSession.profile.tenantId }),
      start: async () => ({
        id: state,
        callbackUrl: callback,
        authorizationUrl: `https://fixture.example.test/login?state=${state}`,
        expiresAt: Date.now() + 60000,
      }),
      complete: async () => selectedSession,
      restore: async () => selectedSession,
    },
  });
  cleanup.push(async () => {
    await identityModule.disposeEnterpriseIdentityService(identity);
    values.clear();
  });
  async function installSelectedOwner() {
    if (lifecycle.readEnterpriseIdentityAuthority(identity)?.session)
      await identity.logout();
    const attempt = await identity.beginLogin();
    await identity.completeLogin(
      attempt.id,
      `${callback}?code=controlled&state=${state}`,
    );
  }
  await installSelectedOwner();
  const backendSession = backendModule.createUWorkBackendSession({
    resolveConfig: async () => ({ backend: "uwork", apiBaseUrl: origin }),
    readAuthority: () => lifecycle.readEnterpriseIdentityAuthority(identity),
    readPersistedSession: () => sessionStore.read(),
  });
  const policy = policyModule.createUWorkPublicationPolicy(backendSession);
  const externalA = randomBytes(24).toString("hex"),
    externalB = randomBytes(24).toString("hex");
  let externalOwner: "A" | "B" = "A";
  let tokenHook: (() => Promise<void>) | undefined,
    requestHook: ((phase: string) => Promise<void>) | undefined;
  let proxyHook: (() => Promise<void>) | undefined,
    pendingConfirm = false;
  const requests: {
    phase: string;
    method: string;
    owner: "A" | "B";
    bytes: number;
    mode?: string;
  }[] = [];
  const preparations = new Map<
    string,
    { mode: string; owner: "A" | "B"; artifacts: number }
  >();
  const publications: {
    id: string;
    owner: "A" | "B";
    mode: string;
    bytes: number;
    currentOwnerContentMatched: boolean;
    artifactRows: number;
    artifactHashesMatched: boolean;
  }[] = [];
  const uploads: {
    id: string;
    owner: "A" | "B";
    bytes: number;
    fileBytes: number;
    checksumMatched: boolean;
  }[] = [];
  const artifactText = withOwnedArtifact
    ? "# G08 owned production artifact\nActual local stat/read/hash and multipart bytes.\n"
    : "a";
  const artifactPath = join(directory, "report.md");
  if (withOwnedArtifact) await writeFile(artifactPath, artifactText);
  const productionArtifactSource =
    localArtifactModule.createLocalConversationShareArtifactSource();
  let localArtifactStats = 0,
    localArtifactReads = 0,
    fileChangeQueries = 0;
  let privateCredentialForwarded = false,
    invalidExternalCredential = false;
  const external = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const bytes = Buffer.concat(chunks),
      text = bytes.toString();
    for (const token of secretTokens)
      if (
        req.headers.authorization?.includes(token) ||
        req.url?.includes(token) ||
        text.includes(token)
      )
        privateCredentialForwarded = true;
    const owner =
      req.headers.authorization === `Bearer ${externalA}`
        ? "A"
        : req.headers.authorization === `Bearer ${externalB}`
          ? "B"
          : undefined;
    if (!owner) {
      invalidExternalCredential = true;
      res.writeHead(401).end();
      return;
    }
    const path = req.url ?? "",
      phase = path.endsWith("capabilities")
        ? "capabilities"
        : path.endsWith("confirm")
          ? "confirm"
          : path.endsWith("artifacts")
            ? "upload"
            : "prepare";
    const body =
      phase === "prepare" || phase === "confirm"
        ? (JSON.parse(text) as Row)
        : {};
    requests.push({
      phase,
      method: req.method ?? "",
      owner,
      bytes: bytes.length,
      ...(phase === "prepare" ? { mode: String(body.access_mode) } : {}),
    });
    let data: Row;
    if (phase === "capabilities")
      data = {
        schema_version: 1,
        ttl_ms: 60000,
        max_rows: 100,
        max_payload_bytes: 100000,
        max_artifact_count: 10,
        max_artifact_bytes: 100000,
        max_total_artifact_bytes: 100000,
        access_modes: ["private", "public_readonly", "public_importable"],
        allowed_artifacts: withOwnedArtifact
          ? [{ type: "md", extensions: ["md"], mime_types: ["text/markdown"] }]
          : [{ type: "text", extensions: ["txt"], mime_types: ["text/plain"] }],
      };
    else if (phase === "prepare") {
      const id = `preparation-${preparations.size + 1}`;
      preparations.set(id, {
        mode: String(body.access_mode),
        owner,
        artifacts: Number(body.artifact_count),
      });
      data = {
        preparation_id: id,
        access_mode: body.access_mode,
        expires_at: Date.now() + 60000,
        status: "preparing",
      };
    } else {
      const id = path.split("/")[3]!,
        prepared = preparations.get(id)!;
      assert.ok(prepared, "controlled preparation must exist");
      assert.equal(
        prepared.owner,
        owner,
        "external OAuth account owns its preparation independently of UWork",
      );
      if (phase === "upload") {
        const form = await new Response(bytes, {
          headers: { "content-type": String(req.headers["content-type"]) },
        }).formData();
        const descriptor = JSON.parse(String(form.get("descriptor"))) as Row;
        const file = form.get("file");
        assert.ok(
          file instanceof Blob,
          "an actual multipart file reached the controlled service",
        );
        const fileBytes = Buffer.from(await file.arrayBuffer());
        assert.equal(fileBytes.toString(), artifactText);
        const checksumMatched =
          createHash("sha256").update(fileBytes).digest("hex") ===
          descriptor.sha256;
        assert.equal(checksumMatched, true);
        uploads.push({
          id,
          owner,
          bytes: bytes.length,
          fileBytes: fileBytes.length,
          checksumMatched,
        });
        data = {
          artifact_id: descriptor.artifact_id,
          size_bytes: fileBytes.length,
          sha256: createHash("sha256").update(fileBytes).digest("hex"),
          status: "uploaded",
          safety_status: "safe",
        };
      } else if (pendingConfirm) {
        pendingConfirm = false;
        await requestHook?.("pending-confirm");
        if (!res.destroyed)
          res
            .writeHead(409, { "content-type": "application/json" })
            .end(JSON.stringify({ code: 3215, msg: "Safety check pending" }));
        return;
      } else {
        const rows = (body.projection as Row).rows as Row[];
        const currentOwnerContentMatched = rows.some(
          (row) =>
            row.kind === "userInput" &&
            row.text === `Controlled share content ${owner}`,
        );
        assert.equal(
          currentOwnerContentMatched,
          true,
          "the confirmed conversation belongs to the currently authorized controlled owner",
        );
        const artifactRows = rows.filter((row) => row.kind === "artifact");
        const artifactHashesMatched = artifactRows.every(
          (row) =>
            row.sha256 ===
              createHash("sha256").update(artifactText).digest("hex") &&
            row.sizeBytes === Buffer.byteLength(artifactText),
        );
        assert.equal(artifactRows.length, prepared.artifacts);
        assert.equal(
          artifactHashesMatched,
          true,
          "the final confirmation carries the production hash and size of the same physically uploaded file",
        );
        publications.push({
          id,
          owner,
          mode: prepared.mode,
          bytes: bytes.length,
          currentOwnerContentMatched,
          artifactRows: artifactRows.length,
          artifactHashesMatched,
        });
        data = {
          share_code: `share-${publications.length}`,
          share_url: `https://controlled-share.example.test/share/${publications.length}`,
          access_mode: prepared.mode,
          expires_at: Date.now() + 60000,
        };
      }
    }
    await requestHook?.(phase);
    if (!res.destroyed)
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ code: 0, msg: "ok", data }));
  });
  await new Promise<void>((done) => external.listen(0, "127.0.0.1", done));
  cleanup.push(async () => {
    external.closeAllConnections();
    await new Promise<void>((done) => external.close(() => done()));
  });
  const transport = networkModule.createHostApiNetworkTransport(async () => {
    await proxyHook?.();
    return {};
  });
  cleanup.push(() => transport.disposeAndWait());
  const client = new httpModule.ConversationShareHttpClient({
    apiClient: new apiModule.NodeApiClient({ fetchImpl: transport.fetch }),
    baseUrl: `http://127.0.0.1:${(external.address() as { port: number }).port}`,
    tokenProvider: async () => {
      await tokenHook?.();
      return externalOwner === "A" ? externalA : externalB;
    },
    timeoutMs: 5000,
    confirmTimeoutMs: 5000,
  });
  const hostEvents: string[] = [];
  const recordEvent = (_trace: unknown, message: string) => {
    hostEvents.push(message);
  };
  const noFiles = async () => {
    throw new Error("No file discovery expected for text publication");
  };
  let sleepHook: (() => Promise<void>) | undefined;
  const service = new serviceModule.ConversationShareService({
    client,
    publicationPolicy: policy,
    conversationWorkspaceRoot: directory,
    artifactSource: withOwnedArtifact
      ? {
          async read(input: unknown) {
            localArtifactReads++;
            return productionArtifactSource.read(input);
          },
          async stat(input: unknown) {
            localArtifactStats++;
            return productionArtifactSource.stat(input);
          },
        }
      : { read: noFiles, stat: noFiles },
    sleep: async () => {
      await sleepHook?.();
    },
    logger: {
      info: recordEvent,
      warn: recordEvent,
      debug: recordEvent,
      error: recordEvent,
    },
    zcodeAgentService: {
      conversationFileChangesV4: withOwnedArtifact
        ? async () => {
            fileChangeQueries++;
            return {
              state: "active",
              items: [{ path: artifactPath }],
              atRevision: 1,
              atLogEpoch: "controlled",
            };
          }
        : noFiles,
      conversationAttachmentReadV4: noFiles,
      conversationAttachmentStatV4: noFiles,
      conversationRowsRangeV4: async () => ({
        atSeq: withOwnedArtifact ? 3 : 2,
        atRevision: 1,
        atLogEpoch: "controlled",
        hasMore: false,
        rows: [
          {
            rowId: 1,
            turnId: "turn",
            productTurnId: "product",
            entityId: "header",
            kind: "turnHeader",
            origin: "userInput",
            state: "completedSuccess",
            startedAt: 1,
            endedAt: 2,
            createdAt: 1,
            createdAtSeq: 1,
          },
          {
            rowId: 2,
            turnId: "turn",
            productTurnId: "product",
            entityId: "message",
            kind: "userInput",
            origin: "realUser",
            text: `Controlled share content ${externalOwner}`,
            createdAt: 1,
            createdAtSeq: 2,
          },
          ...(withOwnedArtifact
            ? [
                {
                  rowId: 3,
                  turnId: "turn",
                  productTurnId: "product",
                  entityId: "assistant",
                  kind: "assistantText",
                  state: "complete",
                  text: "Created [the owned report](report.md)",
                  createdAt: 1,
                  createdAtSeq: 3,
                },
              ]
            : []),
        ],
      }),
    },
  });
  let sequence = 0;
  const publish = (
    accessMode: "private" | "public_readonly" | "public_importable" = "private",
  ) =>
    service.publish(
      {
        workspacePath: directory,
        sessionId: "controlled-sharing-conversation",
        title: "Controlled share",
        accessMode,
        selection: { kind: "all" },
        clientRequestId: `live-request-${++sequence}`,
        disclosureAcceptedAt: 1,
      },
      `live-operation-${sequence}`,
    );
  async function configure(
    kind: string,
    data: Row,
    tenant: "A" | "B" = "A",
    publishNow = true,
  ) {
    const prefix = tenant === "A" ? pa : pb,
      token = tenant === "A" ? ownerA : ownerB;
    const current = await api(
      "read-published-policy",
      "GET",
      `${prefix}/configurations/${kind}`,
      token,
    );
    const saved = await api(
      "save-policy-draft-over-http",
      "PUT",
      `${prefix}/configurations/${kind}`,
      token,
      {
        revision: current.revision,
        data: { ...(current.published as Row), ...data },
      },
    );
    if (publishNow)
      await api(
        "publish-policy-over-http",
        "POST",
        `${prefix}/configurations/${kind}/publish`,
        token,
        { revision: saved.revision },
      );
    return Number(saved.revision);
  }
  const sharing = (
    publish: "disabled" | "organization" | "internet",
    files = false,
    tenant: "A" | "B" = "A",
    publishNow = true,
  ) =>
    configure(
      "sharing",
      { publish, collaborate: "internet", files, wechat: false, wecom: false },
      tenant,
      publishNow,
    );
  const report = async (name: string, assertions: Row) => {
    assert.equal(privateCredentialForwarded, false);
    assert.equal(invalidExternalCredential, false);
    await mkdir(evidence, { recursive: true });
    await writeFile(
      join(evidence, `${name}.json`),
      JSON.stringify(
        {
          status: "passed",
          backendChecks,
          actualBackendPolicyHttp: policyHttp,
          actualHostRequests: requests,
          preparations: preparations.size,
          externalPublicationsCreated: publications,
          actualArtifactUploads: uploads,
          productionArtifactSource: {
            enabled: withOwnedArtifact,
            localArtifactStats,
            localArtifactReads,
            fileChangeQueries,
          },
          privateBackendCredentialForwarded: false,
          externalServiceIsControlledLoopback: true,
          realWecomMcpDriveOrProviderCalls: 0,
          ...assertions,
        },
        null,
        2,
      ) + "\n",
      { mode: 0o600 },
    );
  };
  return {
    get app() {
      return app;
    },
    api,
    a,
    b,
    pa,
    pb,
    alice,
    ownerA,
    ownerB,
    privateA,
    identity,
    sessionStore,
    policy,
    client,
    service,
    publish,
    sharing,
    configure,
    requests,
    preparations,
    publications,
    uploads,
    hostEvents,
    directory,
    report,
    artifactText,
    artifactPath,
    localSourceCounts: () => ({
      localArtifactStats,
      localArtifactReads,
      fileChangeQueries,
    }),
    onToken(hook?: () => Promise<void>) {
      tokenHook = hook;
    },
    onRequest(hook?: (phase: string) => Promise<void>) {
      requestHook = hook;
    },
    onProxy(hook?: () => Promise<void>) {
      proxyHook = hook;
    },
    onSleep(hook?: () => Promise<void>) {
      sleepHook = hook;
    },
    pendingOnce() {
      pendingConfirm = true;
    },
    async switchToB() {
      const switched = await api(
        "real-backend-organization-switch",
        "POST",
        "/api/auth/switch",
        selectedSession.token,
        { tenantId: b.tenantId },
      );
      const token = String(switched.token);
      secretTokens.add(token);
      selectedSession = {
        ...selectedSession,
        token,
        profile: { ...selectedSession.profile, tenantId: b.tenantId },
      };
      externalOwner = "B";
      await installSelectedOwner();
    },
    async reopen() {
      app.server.closeAllConnections();
      await app.close();
      app = await createApp(options);
      instrument(app);
      origin = await app.listen({ host: "127.0.0.1", port: 0 });
      selectedSession = { ...selectedSession, issuerOrigin: origin };
      await installSelectedOwner();
    },
  };
}

test("real file-backed sharing policy controls all public-service modes independently of cloud execution", async (t) => {
  const f = await fixture(t);
  await f.sharing("organization");
  for (const mode of [
    "private",
    "public_readonly",
    "public_importable",
  ] as const)
    await assert.rejects(() => f.publish(mode), { kind: "feature_disabled" });
  assert.equal(f.requests.length, 0);
  await f.sharing("internet", false, "A", false);
  await assert.rejects(() => f.publish(), { kind: "feature_disabled" });
  assert.equal(
    f.requests.length,
    0,
    "draft internet permission cannot publish a public-service private link",
  );
  await f.sharing("internet");
  await f.configure("assistants", {
    enabled: true,
    local: true,
    cloud: false,
    agents: false,
    mobile: false,
    scope: { all: true },
  });
  await f.api(
    "cloud-channel-denied-while-local-sharing-allowed",
    "POST",
    "/api/client/authorize",
    f.privateA,
    { action: "execution", channel: "cloud" },
    403,
  );
  for (const mode of [
    "private",
    "public_readonly",
    "public_importable",
  ] as const) {
    const result = await f.publish(mode);
    assert.equal(result.access_mode, mode);
  }
  assert.equal(f.publications.length, 3);
  assert.equal(f.requests.length, 9);
  await f.configure("assistants", { local: false, cloud: true });
  const cloudDecision = await f.api(
    "cloud-channel-permission-does-not-authorize-local-owner",
    "POST",
    "/api/client/authorize",
    f.privateA,
    { action: "share", target: "internet", channel: "cloud" },
  );
  assert.equal(cloudDecision.allowed, true);
  await assert.rejects(() => f.publish(), { kind: "feature_disabled" });
  assert.equal(
    f.requests.length,
    9,
    "the actual desktop sharing owner still requires its own local channel",
  );
  await f.configure("assistants", { local: true, cloud: false });
  await f.reopen();
  assert.equal((await f.publish()).access_mode, "private");
  assert.equal(f.publications.length, 4);
  await f.report("published-cloud-boundary", {
    modesVerified: ["private", "public_readonly", "public_importable"],
    draftCannotGrant: true,
    cloudExecutionAndLocalShareHaveDistinctChannels: true,
    publishedPolicyPersistedAfterRestart: true,
  });
});

test("real seat network and owner changes are checked at the Host's final HTTP exit", async (t) => {
  const f = await fixture(t);
  await f.sharing("internet");
  const entered = deferred(),
    release = deferred();
  f.onToken(async () => {
    entered.resolve();
    await release.promise;
  });
  const publishing = f.publish();
  const rejected = assert.rejects(publishing, { kind: "feature_disabled" });
  await entered.promise;
  await f.api(
    "revoke-seat-during-external-token-lookup",
    "PATCH",
    `${f.pa}/members/${f.alice.id}`,
    f.ownerA,
    { seat: false },
  );
  release.resolve();
  await rejected;
  f.onToken();
  assert.equal(f.requests.length, 0);
  await f.api(
    "restore-seat-for-independent-network-check",
    "PATCH",
    `${f.pa}/members/${f.alice.id}`,
    f.ownerA,
    { seat: true },
  );
  f.onProxy(async () => {
    f.onProxy();
    await f.configure("security", { allowNetwork: false });
  });
  await assert.rejects(() => f.publish(), { kind: "feature_disabled" });
  assert.equal(
    f.requests.length,
    0,
    "published network revocation after proxy IO still precedes native fetch",
  );
  await f.configure("security", {
    allowNetwork: true,
    allowedDomains: ["approved.example.test"],
  });
  await assert.rejects(() => f.publish(), { kind: "feature_disabled" });
  assert.equal(f.requests.length, 0);
  await f.configure("security", { allowedDomains: ["127.0.0.1"] });
  const ownerEntered = deferred(),
    ownerRelease = deferred();
  f.onToken(async () => {
    ownerEntered.resolve();
    await ownerRelease.promise;
  });
  const oldOwner = f.publish();
  const oldDenied = assert.rejects(oldOwner, { kind: "feature_disabled" });
  await ownerEntered.promise;
  await f.sharing("disabled", false, "B");
  await f.switchToB();
  ownerRelease.resolve();
  await oldDenied;
  f.onToken();
  await assert.rejects(() => f.publish(), { kind: "feature_disabled" });
  assert.equal(
    f.requests.length,
    0,
    "old A permission cannot publish as the new B enterprise/OAuth owner",
  );
  await f.sharing("internet", false, "B");
  assert.ok((await f.publish()).share_code);
  assert.equal(f.publications.length, 1);
  assert.equal(f.publications[0]!.owner, "B");
  await f.report("final-exit-identity-network", {
    seatRevocationBlockedBeforeDispatch: true,
    proxyAwaitNetworkRevocationBlockedBeforeDispatch: true,
    exactDomainChecked: true,
    oldOwnerCannotDonatePermissionOrContentToNewOwner: true,
  });
});

test("revocation after real preparation or confirmation records unavoidable effects and suppresses stale success", async (t) => {
  const f = await fixture(t);
  await f.sharing("internet");
  f.onRequest(async (phase) => {
    if (phase === "prepare") {
      f.onRequest();
      await f.sharing("disabled");
    }
  });
  await assert.rejects(() => f.publish(), { kind: "feature_disabled" });
  assert.equal(f.preparations.size, 1);
  assert.equal(f.publications.length, 0);
  assert.equal(
    f.requests.filter((request) => request.phase === "confirm").length,
    0,
  );
  await f.sharing("internet");
  f.pendingOnce();
  f.onSleep(async () => {
    f.onSleep();
    await f.sharing("disabled");
  });
  await assert.rejects(() => f.publish(), { kind: "feature_disabled" });
  assert.equal(f.preparations.size, 2);
  assert.equal(
    f.requests.filter((request) => request.phase === "confirm").length,
    1,
  );
  assert.equal(f.publications.length, 0);
  await f.sharing("internet");
  f.onRequest(async (phase) => {
    if (phase === "confirm") {
      f.onRequest();
      await f.sharing("disabled");
    }
  });
  const completions = f.hostEvents.filter(
    (message) => message === "conversation share publish completed",
  ).length;
  await assert.rejects(() => f.publish(), { kind: "feature_disabled" });
  assert.equal(f.preparations.size, 3);
  assert.equal(
    f.publications.length,
    1,
    "the controlled external confirm actually created a share before revocation was observed",
  );
  assert.equal(
    f.hostEvents.filter(
      (message) => message === "conversation share publish completed",
    ).length,
    completions,
    "Host never reports the stale external success",
  );
  await f.report("revocation-side-effects", {
    noConfirmationAfterRevokedPreparation: true,
    pendingSafetyRetryReauthorizes: true,
    externallyCreatedShareCannotBeClaimedRolledBack: true,
    lateSuccessSuppressed: true,
  });
});

test("real artifact HTTP client upload and confirmation each consume current files permission", async (t) => {
  const f = await fixture(t);
  await f.sharing("internet", true);
  const preparation = {
    client_request_id: "artifact-live",
    title: "Controlled artifact",
    schema_version: 1,
    access_mode: "private",
    payload_sha256: "a".repeat(64),
    artifact_count: 1,
  };
  const descriptor = {
    artifact_id: "artifact",
    logical_artifact_key: "logical",
    producer_product_turn_id: "product",
    artifact_version: 1,
    state: "current",
    ref: "zcode-artifact://share/artifact",
    artifact_type: "text",
    display_name: "controlled.txt",
    extension: "txt",
    mime_type: "text/plain",
    size_bytes: 1,
    sha256: createHash("sha256").update("a").digest("hex"),
  };
  await f.policy.run(async (authorization: unknown) => {
    const created = await f.client.createPreparation(
      preparation,
      authorization,
    );
    assert.equal(
      (
        await f.client.uploadArtifact(
          created.preparation_id,
          descriptor,
          new Blob(["a"]),
          authorization,
        )
      ).status,
      "uploaded",
    );
    await f.sharing("internet", false);
    await assert.rejects(
      () =>
        f.client.uploadArtifact(
          created.preparation_id,
          descriptor,
          new Blob(["a"]),
          authorization,
        ),
      { kind: "feature_disabled" },
    );
    assert.equal(f.uploads.length, 1);
    // Same existing HTTP client guard is used for final artifact confirmation.
    const confirm = {
      selected_product_turn_ids: ["product"],
      projection: {
        rows: [
          {
            rowId: 1,
            turnId: "turn",
            productTurnId: "product",
            entityId: "message",
            kind: "userInput",
            origin: "realUser",
            text: "Controlled",
            createdAt: 1,
            createdAtSeq: 1,
          },
        ],
      },
      integrity: {
        projection_sha256: "b".repeat(64),
        artifact_set_sha256: "c".repeat(64),
      },
      disclosure_confirmation: {
        version: 1,
        accepted_at: 1,
        acknowledged_no_secret_detection: true,
      },
    };
    await assert.rejects(
      () =>
        f.client.confirm(created.preparation_id, confirm, authorization, true),
      { kind: "feature_disabled" },
    );
  });
  assert.equal(f.preparations.size, 1);
  assert.equal(f.publications.length, 0);
  assert.equal(
    f.requests.filter((request) => request.phase === "confirm").length,
    0,
  );
  await assert.rejects(
    () =>
      f.policy.run((authorization: unknown) =>
        f.client.createPreparation(preparation, authorization),
      ),
    { kind: "feature_disabled" },
  );
  assert.equal(f.preparations.size, 1);
  await f.report("artifact-permission", {
    realMultipartUploads: 1,
    manifestAndLaterUploadAndConfirmEachReauthorized: true,
    bodyAlreadyUploadedRetainedInControlledService: true,
  });
});

test("actual service publication discovers and materializes an owned file before guarded multipart and confirmation", async (t) => {
  const f = await fixture(t, true);
  await f.sharing("internet", true);
  const published = await f.publish("public_readonly");
  assert.ok(published.share_code);
  assert.equal(f.preparations.size, 1);
  assert.equal(
    [...f.preparations.values()][0]!.artifacts,
    1,
    "production Markdown discovery creates the actual one-file manifest",
  );
  assert.equal(f.uploads.length, 1);
  assert.equal(f.uploads[0]!.fileBytes, Buffer.byteLength(f.artifactText));
  assert.equal(f.uploads[0]!.checksumMatched, true);
  assert.equal(f.publications.length, 1);
  f.onRequest(async (phase) => {
    if (phase === "prepare") {
      f.onRequest();
      await f.sharing("internet", false);
    }
  });
  await assert.rejects(() => f.publish(), { kind: "feature_disabled" });
  assert.equal(f.preparations.size, 2);
  assert.equal(
    f.uploads.length,
    1,
    "files revocation after the generated manifest prevents actual file upload",
  );
  await f.sharing("internet", true);
  f.onRequest(async (phase) => {
    if (phase === "upload") {
      f.onRequest();
      await f.sharing("internet", false);
    }
  });
  await assert.rejects(() => f.publish(), { kind: "feature_disabled" });
  assert.equal(f.preparations.size, 3);
  assert.ok(
    [...f.preparations.values()].every(
      (preparation) => preparation.artifacts === 1,
    ),
  );
  assert.equal(
    f.uploads.length,
    2,
    "already dispatched bytes are retained as an external effect",
  );
  assert.equal(f.publications.length, 1);
  assert.equal(
    f.requests.filter((request) => request.phase === "confirm").length,
    1,
    "revocation prevents both later confirmations",
  );
  assert.equal(await readFile(f.artifactPath, "utf8"), f.artifactText);
  const sourceCounts = f.localSourceCounts();
  assert.ok(sourceCounts.localArtifactReads >= 3);
  assert.ok(sourceCounts.localArtifactStats >= 3);
  assert.ok(sourceCounts.fileChangeQueries >= 3);
  await f.report("service-local-artifact", {
    actualServicePublishOwner: true,
    productionLocalArtifactSourceReadStatDelegated: true,
    descriptorAndManifestGeneratedByProductionDiscovery: true,
    actualOriginalFileBytesAndSha256Matched: true,
    noManualDescriptorOrClientUploadInThisCase: true,
    afterPreparationRevocationBlockedUpload: true,
    afterActualUploadRevocationBlockedConfirm: true,
    alreadyUploadedBytesNotClaimedRolledBack: true,
  });
});
