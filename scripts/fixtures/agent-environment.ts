import assert from "node:assert/strict";
import { createApp, type AppOptions } from "../../src/app.js";
import { bootstrap } from "../../src/identity.js";

export async function agentEnvironment(options: AppOptions, baseUrl: string) {
  const app = await createApp({ ...options, allowPrivateUpstreams: true });
  try {
    const { tenantId, userId } = await bootstrap(app.services.db, {
      name: "Controlled Agent verification",
      email: "owner@example.test",
      password: "controlled-password-long",
    });
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        email: "owner@example.test",
        password: "controlled-password-long",
      },
    });
    assert.equal(login.statusCode, 200);
    const headers = { authorization: `Bearer ${login.json().token}` },
      path = `/api/tenants/${tenantId}`;
    const credential = await app.inject({
      method: "POST",
      url: `${path}/credentials`,
      headers,
      payload: { name: "Synthetic model", value: "synthetic-only" },
    });
    assert.equal(credential.statusCode, 201, credential.body);
    const model = await app.inject({
      method: "POST",
      url: `${path}/models`,
      headers,
      payload: {
        name: "Controlled",
        upstreamModel: "controlled",
        baseUrl,
        credentialId: credential.json().id,
        scope: { all: true },
        supportsTools: true,
        maxOutputTokens: 256,
      },
    });
    assert.equal(model.statusCode, 201, model.body);
    const agent = await app.inject({
      method: "POST",
      url: `${path}/agents`,
      headers,
      payload: {
        name: "Controlled code Agent",
        modelId: model.json().id,
        instructions: "Use only the isolated code tool",
        scope: { all: true },
        sandbox: true,
        maxTurns: 4,
        maxToolCalls: 3,
        toolTimeoutMs: 5000,
        maxOutputTokens: 256,
      },
    });
    assert.equal(agent.statusCode, 201, agent.body);
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: `${path}/agents/${agent.json().id}/publish`,
          headers,
          payload: { version: 1 },
        })
      ).statusCode,
      200,
    );
    const security = async (allowSandbox: boolean) => {
      const old = (
        await app.inject({ url: `${path}/configurations/security`, headers })
      ).json();
      const draft = await app.inject({
        method: "PUT",
        url: `${path}/configurations/security`,
        headers,
        payload: { revision: old.revision, data: { allowSandbox } },
      });
      assert.equal(draft.statusCode, 200, draft.body);
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: `${path}/configurations/security/publish`,
            headers,
            payload: { revision: draft.json().revision },
          })
        ).statusCode,
        200,
      );
    };
    await security(true);
    const enqueue = async (input: string, timeoutMs = 10000) => {
      const response = await app.inject({
        method: "POST",
        url: `${path}/runs`,
        headers,
        payload: { agentId: agent.json().id, input, timeoutMs },
      });
      assert.equal(response.statusCode, 202, response.body);
      return response.json().id as string;
    };
    return {
      app,
      tenantId,
      userId,
      headers,
      path,
      modelId: model.json().id as string,
      agentId: agent.json().id as string,
      security,
      enqueue,
    };
  } catch (error) {
    await app.close();
    throw error;
  }
}
