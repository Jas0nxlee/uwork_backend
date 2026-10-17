import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fixture } from "../tests/fixtures.js";

test("actual Host sharing obeys published backend policy through its existing identity owner", async (t) => {
  const root = resolve(
    process.env.UWORK_CLIENT_PATH ?? "clients/uwork",
  );
  const source = (path: string) =>
    import(pathToFileURL(join(root, "packages/services/src", path)).href);
  const [
    identityModule,
    lifecycle,
    storeModule,
    backendModule,
    policyModule,
    httpModule,
    shareModule,
    apiModule,
    networkModule,
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
  ]);
  const f = await fixture(t, "https://upstream.example.test/v1");
  const origin = await f.app.listen({ host: "127.0.0.1", port: 0 });
  const device = (
    await f.app.inject({
      method: "POST",
      url: "/api/auth/device-tokens",
      headers: f.headers,
      payload: { ttlHours: 1 },
    })
  ).json();
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
  const session = {
    token: device.token,
    issuerOrigin: origin,
    expiresAt: Date.now() + 60000,
    profile: {
      id: f.userId,
      tenantId: f.tenantId,
      provider: "wecom",
      displayName: "Controlled",
    },
  };
  const callback = "https://auth.example.test/callback",
    state = "controlled-state";
  const identity = identityModule.createEnterpriseIdentityService({
    credentials,
    sessionStore,
    adapter: {
      listOrganizations: () => [{ id: f.tenantId }],
      resolveOrganization: () => ({ id: f.tenantId }),
      start: async () => ({
        id: state,
        callbackUrl: callback,
        authorizationUrl: `https://login.example.test/?state=${state}`,
        expiresAt: Date.now() + 60000,
      }),
      complete: async () => session,
      restore: async () => session,
    },
  });
  t.after(() => identityModule.disposeEnterpriseIdentityService(identity));
  const attempt = await identity.beginLogin();
  await identity.completeLogin(
    attempt.id,
    `${callback}?code=controlled-code&state=${state}`,
  );
  const backend = backendModule.createUWorkBackendSession({
    resolveConfig: async () => ({ backend: "uwork", apiBaseUrl: origin }),
    readAuthority: () => lifecycle.readEnterpriseIdentityAuthority(identity),
    readPersistedSession: () => sessionStore.read(),
  });
  const policy = policyModule.createUWorkPublicationPolicy(backend);
  const configure = async (
    publish: "internet" | "disabled",
    publishNow = true,
  ) => {
    const current = (
      await f.app.inject({
        url: `${f.p}/configurations/sharing`,
        headers: f.headers,
      })
    ).json();
    const saved = await f.app.inject({
      method: "PUT",
      url: `${f.p}/configurations/sharing`,
      headers: f.headers,
      payload: {
        revision: current.revision,
        data: { ...current.published, publish, files: false },
      },
    });
    assert.equal(saved.statusCode, 200, saved.body);
    if (publishNow) {
      const published = await f.app.inject({
        method: "POST",
        url: `${f.p}/configurations/sharing/publish`,
        headers: f.headers,
        payload: { revision: saved.json().revision },
      });
      assert.equal(published.statusCode, 200, published.body);
    }
    return saved.json().revision as number;
  };
  const requests: string[] = [];
  let duringRequest: (() => Promise<void>) | undefined;
  const external = createServer(async (req, res) => {
    for await (const _chunk of req) {
      void _chunk;
    }
    assert.equal(req.headers.authorization, "Bearer external-synthetic");
    assert.notEqual(req.headers.authorization, `Bearer ${device.token}`);
    requests.push(req.url!);
    await duringRequest?.();
    if (res.destroyed) return;
    const data = req.url!.endsWith("capabilities")
      ? {
          schema_version: 1,
          ttl_ms: 60000,
          max_rows: 100,
          max_payload_bytes: 100000,
          max_artifact_count: 10,
          max_artifact_bytes: 100000,
          max_total_artifact_bytes: 100000,
          access_modes: ["private", "public_readonly", "public_importable"],
          allowed_artifacts: [],
        }
      : req.url!.endsWith("confirm")
        ? {
            share_code: "controlled",
            share_url: "https://share.example.test/share/controlled",
            access_mode: "private",
            expires_at: Date.now() + 60000,
          }
        : {
            preparation_id: "controlled",
            access_mode: "private",
            expires_at: Date.now() + 60000,
            status: "preparing",
          };
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ code: 0, msg: "ok", data }));
  });
  await new Promise<void>((done) => external.listen(0, "127.0.0.1", done));
  t.after(() => {
    external.closeAllConnections();
    external.close();
  });
  const network = networkModule.createHostApiNetworkTransport(async () => ({}));
  t.after(() => network.disposeAndWait());
  const client = new httpModule.ConversationShareHttpClient({
    apiClient: new apiModule.NodeApiClient({ fetchImpl: network.fetch }),
    baseUrl: `http://127.0.0.1:${(external.address() as { port: number }).port}`,
    tokenProvider: async () => "external-synthetic",
  });
  const directory = await mkdtemp(join(tmpdir(), "uwork-sharing-contract-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const noFiles = async () => {
    throw new Error("No controlled artifacts expected");
  };
  const service = new shareModule.ConversationShareService({
    client,
    publicationPolicy: policy,
    conversationWorkspaceRoot: directory,
    artifactSource: { read: noFiles, stat: noFiles },
    zcodeAgentService: {
      conversationFileChangesV4: noFiles,
      conversationAttachmentReadV4: noFiles,
      conversationAttachmentStatV4: noFiles,
      conversationRowsRangeV4: async () => ({
        atSeq: 2,
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
            text: "Controlled content",
            createdAt: 1,
            createdAtSeq: 2,
          },
        ],
      }),
    },
  });
  const publish = () =>
    service.publish(
      {
        workspacePath: directory,
        sessionId: "controlled-session",
        title: "Controlled share",
        accessMode: "private",
        selection: { kind: "all" },
        clientRequestId: "controlled-request",
        disclosureAcceptedAt: 1,
      },
      "controlled-operation",
    );
  await assert.rejects(publish, { kind: "feature_disabled" });
  const revision = await configure("internet", false);
  await assert.rejects(publish, { kind: "feature_disabled" });
  assert.equal(
    requests.length,
    0,
    "saved draft cannot authorize an external publication",
  );
  const published = await f.app.inject({
    method: "POST",
    url: `${f.p}/configurations/sharing/publish`,
    headers: f.headers,
    payload: { revision },
  });
  assert.equal(published.statusCode, 200, published.body);
  assert.equal((await publish()).share_code, "controlled");
  assert.equal(requests.length, 3);
  await assert.rejects(
    () =>
      policy.run((authorization: unknown) =>
        client.createPreparation(
          {
            client_request_id: "artifact-request",
            title: "File",
            schema_version: 1,
            access_mode: "private",
            payload_sha256: "a".repeat(64),
            artifact_count: 1,
          },
          authorization,
        ),
      ),
    { kind: "feature_disabled" },
  );
  assert.equal(
    requests.length,
    3,
    "files=false prevents the manifest from leaving the Host",
  );
  duringRequest = async () => {
    if (requests.at(-1) === "/shares/preparations") await configure("disabled");
  };
  await assert.rejects(publish, { kind: "feature_disabled" });
  assert.equal(
    requests.length,
    5,
    "revocation during preparation prevents a final confirmation",
  );
  await configure("internet");
  duringRequest = () => identity.logout();
  await assert.rejects(publish);
  assert.equal(
    requests.length,
    6,
    "late logout cannot continue to prepare or confirm",
  );
});
