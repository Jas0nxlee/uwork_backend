import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/identity.js";
import { routes } from "./route-source.js";

/**
 * 每个改状态的管理端端点都必须留下审计事实。
 *
 * 例外只有两类，且必须在这里显式列出：
 * - 客户端入口（/api/client/*、/v1/*）：按凭证/账本与终端事件记录，不写管理审计；
 * - 审计写在被调用服务内部的端点（如 runtime.enqueue/cancel、wecom.sync、连接器 RPC）。
 */
const auditedInService: Record<string, string> = {
  "/api/tenants/:x/runs": "runtime.enqueue",
  "/api/tenants/:x/runs/:x/cancel": "runtime.cancel",
  "/api/tenants/:x/wecom/sync": "wecom.directory.sync",
};

test("every mutating admin route either audits itself or names the service that does", () => {
  const missing: string[] = [];
  for (const route of routes()) {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(route.method)) continue;
    if (
      route.path.startsWith("/api/auth/") ||
      route.path.startsWith("/api/client/") ||
      route.path.startsWith("/v1/")
    )
      continue;
    if (route.calls.includes("audit")) continue;
    const normalized = route.path.replace(/:[a-zA-Z0-9_]+/g, ":x");
    const owner = auditedInService[normalized];
    if (owner && route.calls.includes(owner)) continue;
    missing.push(`${route.file}: ${normalized}`);
  }
  assert.deepEqual(
    missing,
    [],
    `改状态端点缺少审计事实（或未登记服务内审计）：\n${missing.join("\n")}`,
  );
});

test("previously unaudited operations now leave audit facts behind", async (t) => {
  const app = await createApp({
    database: ":memory:",
    masterKey: Buffer.alloc(32, 21),
    publicUrl: "http://localhost:3000",
  });
  t.after(() => app.close());
  const db = app.services.db;
  const { tenantId } = await bootstrap(db, {
    name: "Audit",
    email: "owner@example.test",
    password: "test-password-long",
  });
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email: "owner@example.test", password: "test-password-long" },
  });
  const headers = { authorization: `Bearer ${login.json().token}` };
  const p = `/api/tenants/${tenantId}`;
  const actions = () =>
    db
      .all<{
        action: string;
        target: string | null;
      }>(
        "SELECT action,target FROM audit WHERE tenant_id=? ORDER BY created_at",
        tenantId,
      )
      .map((row) => row.action);

  const categoryResponse = await app.inject({
    method: "POST",
    url: `${p}/categories`,
    headers,
    payload: { name: "Controlled", kind: "skill" },
  });
  assert.equal(categoryResponse.statusCode, 201, categoryResponse.body);
  const category = categoryResponse.json().id;
  assert.equal(
    (
      await app.inject({
        method: "DELETE",
        url: `${p}/categories/${category}`,
        headers,
      })
    ).statusCode,
    204,
  );
  assert.ok(actions().includes("asset.category.delete"));

  const datasetResponse = await app.inject({
    method: "POST",
    url: `${p}/datasets`,
    headers,
    payload: {
      name: "Controlled",
      cases: [{ input: "hello", expected: "hello" }],
    },
  });
  assert.equal(datasetResponse.statusCode, 201, datasetResponse.body);
  const dataset = datasetResponse.json().id;
  assert.equal(
    (
      await app.inject({
        method: "DELETE",
        url: `${p}/datasets/${dataset}`,
        headers,
      })
    ).statusCode,
    204,
  );
  assert.ok(actions().includes("evaluation.dataset.delete"));

  const device = (
    await app.inject({
      method: "POST",
      url: "/api/auth/device-tokens",
      headers,
      payload: { ttlHours: 1 },
    })
  ).json();
  assert.equal(
    (
      await app.inject({
        method: "DELETE",
        url: `/api/auth/device-tokens/${device.id}`,
        headers,
      })
    ).statusCode,
    204,
  );
  assert.ok(actions().includes("identity.device-token.revoke"));

  // 组织切换在同一组织内也会留下审计事实（会话被轮换）。
  const switched = await app.inject({
    method: "POST",
    url: "/api/auth/switch",
    headers,
    payload: { tenantId },
  });
  assert.equal(switched.statusCode, 200, switched.body);
  assert.ok(actions().includes("identity.switch"));
  // 切换组织会轮换会话：后续请求必须使用新令牌。
  headers.authorization = `Bearer ${switched.json().token}`;

  // 取消运行中的评测必须留痕；已完成/不存在的评测不产生噪音。
  const agent = await app.inject({
    method: "POST",
    url: `${p}/agents`,
    headers,
    payload: {
      name: "Controlled",
      modelId: (
        await app.inject({
          method: "POST",
          url: `${p}/models`,
          headers,
          payload: {
            name: "Controlled",
            upstreamModel: "test",
            baseUrl: "https://upstream.example.test/v1",
            credentialId: (
              await app.inject({
                method: "POST",
                url: `${p}/credentials`,
                headers,
                payload: { name: "Upstream", value: "synthetic-only" },
              })
            ).json().id,
            scope: { all: true },
            maxOutputTokens: 32,
          },
        })
      ).json().id,
      instructions: "Controlled",
      scope: { all: true },
      maxOutputTokens: 32,
    },
  });
  assert.equal(agent.statusCode, 201, agent.body);
  // 评测只接受已发布 Agent。
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `${p}/agents/${agent.json().id}/publish`,
        headers,
        payload: { version: 1 },
      })
    ).statusCode,
    200,
  );
  const evaluation = await app.inject({
    method: "POST",
    url: `${p}/evaluations`,
    headers,
    payload: {
      agentId: agent.json().id,
      // 前一个数据集已在删除审计里验证过，这里单独建一个用于评测。
      datasetId: (
        await app.inject({
          method: "POST",
          url: `${p}/datasets`,
          headers,
          payload: {
            name: "Controlled evaluation",
            cases: [{ input: "hello", expected: "hello" }],
          },
        })
      ).json().id,
    },
  });
  // 评测创建返回 202（已入队执行）。
  assert.equal(evaluation.statusCode, 202, evaluation.body);
  const before = actions().filter(
    (action) => action === "evaluation.cancel",
  ).length;
  await app.inject({
    method: "POST",
    url: `${p}/evaluations/${evaluation.json().id}/cancel`,
    headers,
  });
  await app.inject({
    method: "POST",
    url: `${p}/evaluations/${evaluation.json().id}/cancel`,
    headers,
  });
  assert.ok(
    actions().filter((action) => action === "evaluation.cancel").length >=
      before + 1,
    "取消评测必须写入审计事实",
  );
});
