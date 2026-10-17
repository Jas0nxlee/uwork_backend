import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { AgentProfile } from "@zcode/core";
import type {
  EnterpriseSkillsCatalogPort,
  EnterpriseToolAuthorizationPort,
  Logger,
  TraceContext,
} from "@zcode/contracts";
import type { EnterpriseExpertReference } from "@zcode/shared";

const EXPERT_FILE = "expert.json";
const MAX_EXPERT_BYTES = 1024 * 1024;
const OPERATION_TIMEOUT_MS = 70000;
const RESERVED_PROFILE_NAMES = new Set(["general-purpose", "Explore"]);

/** Body schema mirrors the backend expert content; unknown fields fail closed. */
const expertBodySchema = z
  .object({
    instructions: z.string().min(1).max(100000),
    profession: z.string().max(256).optional(),
    modelId: z.string().max(256).optional(),
  })
  .strict();

export interface EnterpriseExpertProfileInput {
  authorization?: EnterpriseToolAuthorizationPort;
  catalog?: EnterpriseSkillsCatalogPort;
  logger?: Logger;
  sessionId: string;
  signal?: AbortSignal;
  traceContext: TraceContext;
  workspaceIdentity?: string;
  workspacePath: string;
}

/**
 * Enterprise experts into the existing subagent owner: 专家资产映射为该进程内的
 * AgentProfile，正文只在校验/准入后读取，不落盘、不被本地同名 profile 覆盖。
 */
export async function loadEnterpriseExpertProfiles(
  input: EnterpriseExpertProfileInput,
): Promise<AgentProfile[]> {
  const { authorization, catalog } = input;
  // 未受管（无企业端口）时保持原有独立行为，不发起任何反向 RPC。
  if (!authorization || !catalog) return [];
  const signal = AbortSignal.any([
    AbortSignal.timeout(OPERATION_TIMEOUT_MS),
    ...(input.signal ? [input.signal] : []),
  ]);
  const profiles: AgentProfile[] = [];
  try {
    const value = await catalog.readCatalog(
      {
        sessionId: input.sessionId,
        workspacePath: input.workspacePath,
        workspaceIdentity: input.workspaceIdentity,
        traceContext: input.traceContext,
      },
      signal,
    );
    if (value.status !== "ready") {
      if (value.status === "denied")
        input.logger?.warn("Enterprise expert catalog denied", {
          code: value.code,
          module: "bootstrap.enterprise-experts",
        });
      return [];
    }
    const claimed = new Set<string>();
    for (const expert of value.experts) {
      const name = expert.name.trim();
      // 内置名与重复展示名不能被企业资产占用或静默二选一。
      if (!name || RESERVED_PROFILE_NAMES.has(name) || claimed.has(name)) {
        input.logger?.warn("Enterprise expert name rejected", {
          code: RESERVED_PROFILE_NAMES.has(name)
            ? "enterprise_expert_name_reserved"
            : "enterprise_expert_name_unusable",
          module: "bootstrap.enterprise-experts",
        });
        continue;
      }
      const body = await readExpertBody(expert, value.ownerKey, input, signal);
      if (!body) continue;
      claimed.add(name);
      profiles.push({
        name,
        // profession 只是展示描述；缺失时退回资产名称，不伪造其他能力声明。
        description: body.profession ?? name,
        source: "enterprise",
        systemPrompt: body.instructions,
      });
    }
  } catch (error) {
    // 端口不可用、超时或取消都不能升级为“企业专家已加载”，也不能阻断启动。
    input.logger?.warn("Enterprise expert catalog unavailable", {
      code: signal.aborted ? "enterprise_expert_cancelled" : "enterprise_expert_unavailable",
      error: error instanceof Error ? error.message : String(error),
      module: "bootstrap.enterprise-experts",
    });
  }
  return profiles;
}

async function readExpertBody(
  expert: EnterpriseExpertReference,
  ownerKey: string,
  input: EnterpriseExpertProfileInput,
  signal: AbortSignal,
): Promise<{ instructions: string; profession?: string } | undefined> {
  const admit = () =>
    input.authorization!.authorize(
      {
        toolName: "EnterpriseExpertLoad",
        toolCallId: crypto.randomUUID(),
        sessionId: input.sessionId,
        workspacePath: input.workspacePath,
        workspaceIdentity: input.workspaceIdentity,
        workingDirectory: input.workspacePath,
        phase: "asset_load",
        ownerKey,
        input: {},
        asset: {
          key: expert.key,
          asset: { ...expert.asset },
          directory: expert.directory,
        },
        capability: {
          permission: "skill",
          sideEffectScope: "none",
          readOnly: true,
          destructive: false,
          assetGuarded: true,
        },
        traceContext: { ...input.traceContext },
      },
      signal,
    );
  const before = await admit();
  if (!before.allowed) return undefined;
  const content = await readFile(join(expert.directory, EXPERT_FILE), "utf8");
  signal.throwIfAborted();
  if (Buffer.byteLength(content) > MAX_EXPERT_BYTES) return undefined;
  const parsed = expertBodySchema.safeParse(JSON.parse(content));
  // 读取后再对齐绑定校验和，准入与读取之间被替换的正文不能进入 profile。
  if (
    !parsed.success ||
    createHash("sha256").update(JSON.stringify(parsed.data)).digest("hex") !== expert.asset.checksum
  )
    return undefined;
  const after = await admit();
  if (!after.allowed) return undefined;
  return parsed.data;
}
