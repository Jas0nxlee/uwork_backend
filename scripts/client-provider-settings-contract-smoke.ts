import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fixture } from "../tests/fixtures.js";

test("actual Provider Settings admits only published personal policy and retains private Gateway provisioning", async (t) => {
  const root = resolve(process.env.UWORK_CLIENT_PATH ?? "clients/uwork");
  const source = (path: string) =>
    import(pathToFileURL(join(root, "packages/services/src", path)).href);
  const [runtimeModule, sessionModule, policyModule, facadeModule] =
    await Promise.all([
      source("model-provider/providerRuntime.ts"),
      source("enterprise-identity/uworkBackendSession.ts"),
      source("model-provider/uworkProviderSettingsPolicy.ts"),
      source("model-provider/providerFacadeServices.ts"),
    ]);
  const f = await fixture(t, "https://upstream.example.test/v1");
  const origin = await f.app.listen({ host: "127.0.0.1", port: 0 });
  const issued = await f.app.inject({
    method: "POST",
    url: "/api/auth/device-tokens",
    headers: f.headers,
    payload: { ttlHours: 1 },
  });
  assert.equal(issued.statusCode, 201, issued.body);
  const record = {
    revision: 1,
    session: {
      token: issued.json().token,
      issuerOrigin: origin,
      expiresAt: Date.now() + 60000,
      profile: {
        id: f.userId,
        tenantId: f.tenantId,
        provider: "wecom",
        displayName: "Controlled",
      },
    },
  };
  const controller = new AbortController();
  const backend = sessionModule.createUWorkBackendSession({
    resolveConfig: async () => ({ backend: "uwork", apiBaseUrl: origin }),
    readAuthority: () => ({
      ...record,
      generation: 1,
      signal: controller.signal,
    }),
    readPersistedSession: async () => record,
  });
  const directory = await mkdtemp(join(tmpdir(), "uwork-provider-contract-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const runtime = runtimeModule.createProviderRuntime({
    zcodeBuiltinFilePath: join(root, "config/provider/zcode-builtin.json"),
    personalFilePath: join(directory, "personal.json"),
    personalPollingIntervalMs: false,
    watch: false,
    settingsPolicy: policyModule.createUWorkProviderSettingsPolicy(
      () => backend,
    ),
  });
  t.after(() => runtime.dispose());
  await runtime.start();
  const service = runtime.providerSettings;
  const config = {
    api: {
      type: "openai-chat-completions",
      baseUrl: "https://personal.example.test/v1",
    },
    access: { type: "api-key", apiKey: "controlled-personal" },
  };
  const create = () =>
    service.createPersonalProvider({
      providerName: "Enterprise-looking name grants no exemption",
      initialConfig: config,
    });
  await assert.rejects(create, { code: "enterprise_personal_models_denied" });
  const configure = async (models: boolean, publish = true) => {
    const current = (
      await f.app.inject({
        url: `${f.p}/configurations/personal`,
        headers: f.headers,
      })
    ).json();
    const saved = await f.app.inject({
      method: "PUT",
      url: `${f.p}/configurations/personal`,
      headers: f.headers,
      payload: {
        revision: current.revision,
        data: { ...current.published, models },
      },
    });
    assert.equal(saved.statusCode, 200, saved.body);
    if (publish) {
      const result = await f.app.inject({
        method: "POST",
        url: `${f.p}/configurations/personal/publish`,
        headers: f.headers,
        payload: { revision: saved.json().revision },
      });
      assert.equal(result.statusCode, 200, result.body);
    }
  };
  await configure(true, false);
  await assert.rejects(create, { code: "enterprise_personal_models_denied" });
  await configure(true);
  const created = await create();
  await service.addPersonalModel(created.providerId, "controlled-model", {});
  assert.ok(
    await service.resolveModelConfig({
      providerId: created.providerId,
      modelId: "controlled-model",
    }),
  );
  const before = await readFile(join(directory, "personal.json"), "utf8");
  await configure(false);
  await assert.rejects(
    () => service.savePersonalProviderOverlay(created.providerId, config),
    { code: "enterprise_personal_models_denied" },
  );
  await assert.rejects(
    () =>
      service.resolveModelConfig({
        providerId: created.providerId,
        modelId: "controlled-model",
      }),
    { code: "enterprise_personal_models_denied" },
  );
  assert.equal(
    await readFile(join(directory, "personal.json"), "utf8"),
    before,
  );
  await assert.rejects(
    () =>
      service.applyUcasGatewayProvisioning({
        baseUrl: "https://personal.example.test/v1",
      }),
    { code: "enterprise_personal_models_denied" },
  );
  const privatePort = facadeModule.providerSettingsTrustedGatewayProvisioning;
  assert.equal(Reflect.get(service, String(privatePort)), undefined);
  await service[privatePort]({
    baseUrl: `${origin}/v1`,
    apiKey: "controlled-managed",
    modelIds: ["managed-model"],
  });
  assert.ok(
    await service.resolveModelConfig({
      providerId: "ucas",
      modelId: "managed-model",
    }),
  );
});
