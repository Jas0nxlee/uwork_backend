import type { Db } from "./db.js";
import { currentActor, requirePermission } from "./access.js";
import { fail, now, type Actor } from "./core.js";
import { getResource } from "./resources.js";
import { allowedResource, type ModelData } from "./models.js";
import { assertExecution, effectiveSecurity } from "./policy.js";
import { visibleAssets, publishedAsset, contentSchemas } from "./assets.js";
import { agentDataSchema, type AgentData, type Run } from "./agent-contract.js";
import type { ConnectorBinding } from "./connector-service.js";
import { activeSubscription } from "./entitlements.js";

export function authorizedAgent(db: Db, actor: Actor, agentId: string) {
  const agent = getResource<AgentData>(db, actor.tenantId, "agent", agentId);
  if (
    !agent.enabled ||
    agent.status !== "published" ||
    !agent.published_version ||
    !allowedResource(db, actor, "agent", agent)
  )
    fail(403, "AGENT_DENIED", "智能体未发布或未授权");
  return agent;
}
export function agentRunContext(db: Db, runId: string) {
  const run = db.get<Run>("SELECT * FROM runs WHERE id=?", runId);
  if (!run || run.status !== "running" || run.cancel_requested)
    fail(499, "CANCELLED", "父运行已停止或请求取消");
  if (now() >= (run.started_at ?? run.created_at) + run.timeout_ms)
    fail(408, "TIMEOUT", "父运行时间预算已耗尽");
  const actor = currentActor(db, run.tenant_id, run.user_id);
  requirePermission(actor, "execute");
  activeSubscription(db, actor.tenantId);
  authorizedAgent(db, actor, run.agent_id);
  const version = db.get<{ data: string }>(
    "SELECT data FROM resource_versions WHERE resource_id=? AND version=?",
    run.agent_id,
    run.agent_version,
  );
  if (!version) fail(409, "VERSION_UNAVAILABLE", "智能体版本不可用");
  const agent = agentDataSchema.parse(JSON.parse(version.data));
  const model = getResource<ModelData>(
    db,
    actor.tenantId,
    "model",
    agent.modelId,
  );
  if (!allowedResource(db, actor, "model", model))
    fail(403, "MODEL_DENIED", "模型不可用或未授权");
  assertExecution(db, actor, "agents", model.data.baseUrl);
  if (
    agent.sandbox &&
    (!model.data.supportsTools || !effectiveSecurity(db, actor).allowSandbox)
  )
    fail(403, "AGENT_TOOLS_DENIED", "模型或企业未允许智能体隔离工具");
  const assets = visibleAssets(db, actor, "agent");
  const connectors: ConnectorBinding[] = [];
  let system = agent.instructions;
  for (const assetId of agent.assetIds) {
    const asset = assets.find((item) => item.id === assetId);
    if (!asset) fail(403, "ASSET_DENIED", "智能体资源已撤销授权");
    const published = publishedAsset(db, asset);
    if (published.kind === "connector") {
      if (!model.data.supportsTools)
        fail(403, "AGENT_TOOLS_DENIED", "模型未允许连接器工具");
      const content = published.content as {
        url: string;
        credentialId?: string;
      };
      assertExecution(db, actor, "agents", content.url);
      if (
        content.credentialId &&
        !db.get(
          "SELECT id FROM credentials WHERE tenant_id=? AND id=? AND revoked=0",
          actor.tenantId,
          content.credentialId,
        )
      )
        fail(403, "CONNECTOR_DENIED", "连接器凭据不可用");
      const pinned = db.get<{ asset_version: number }>(
        "SELECT asset_version FROM run_connectors WHERE run_id=? AND asset_id=?",
        runId,
        assetId,
      );
      if (pinned && pinned.asset_version !== asset.published_version)
        fail(409, "CONNECTOR_VERSION_CHANGED", "连接器发布版本已变更");
      connectors.push({ id: assetId, version: asset.published_version! });
    } else if (published.kind === "skill") {
      const skill = contentSchemas.skill.parse(published.content);
      if (skill.highRisk && !effectiveSecurity(db, actor).dangerousSkills)
        fail(403, "HIGH_RISK_SKILL", "高风险技能已被企业禁止");
      system += `\n\n${skill.files.find((file) => file.path === "SKILL.md")!.content}`;
    } else if (published.kind === "playbook")
      system += `\n\n${contentSchemas.playbook.parse(published.content).markdown}`;
    else if (published.kind === "expert")
      system += `\n\n${contentSchemas.expert.parse(published.content).instructions}`;
    else
      system += `\n\n${contentSchemas.instruction.parse(published.content).instructions}`;
  }
  return { run, actor, agent, model, system, connectors };
}
