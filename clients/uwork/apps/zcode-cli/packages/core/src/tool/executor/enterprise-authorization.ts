import {
  CoreErrorType,
  createCoreError,
  type EnterpriseToolAuthorizationRequest,
  type TraceContext,
} from "@zcode/contracts";
import type { ExecutableToolCall, ToolEntry, ToolExecutionResult } from "../types.js";
import type { ToolExecutorDeps } from "./types.js";
import { createErrorResult } from "./errors.js";
import { emitPermissionDenied, emitToolCallError } from "./events.js";

export interface EnterpriseExecutionScope {
  workingDirectory: string;
  workspaceRoot: string;
  workspaceIdentity?: string;
}

export function captureEnterpriseExecutionScope(deps: ToolExecutorDeps): EnterpriseExecutionScope {
  return {
    workingDirectory: deps.getWorkingDirectory(),
    workspaceRoot: deps.getWorkspaceRoot(),
    workspaceIdentity: deps.workspaceIdentity,
  };
}
export function matchesEnterpriseExecutionScope(
  deps: ToolExecutorDeps,
  scope: EnterpriseExecutionScope,
) {
  const current = captureEnterpriseExecutionScope(deps);
  return (
    current.workingDirectory === scope.workingDirectory &&
    current.workspaceRoot === scope.workspaceRoot &&
    current.workspaceIdentity === scope.workspaceIdentity
  );
}
export function snapshotEnterpriseInput(input: unknown): unknown {
  try {
    return structuredClone(input);
  } catch {
    throw createCoreError(CoreErrorType.PermissionDenied, "enterprise_input_unsupported", {
      recoverable: true,
    });
  }
}

export async function authorizeEnterpriseTool(input: {
  deps: ToolExecutorDeps;
  entry: ToolEntry;
  toolCall: ExecutableToolCall;
  executionInput: unknown;
  scope: EnterpriseExecutionScope;
  traceContext: TraceContext;
  phase: EnterpriseToolAuthorizationRequest["phase"];
  signal?: AbortSignal;
}): Promise<ToolExecutionResult | undefined> {
  const port = input.deps.permissionService.enterpriseAuthorization;
  if (!port) return undefined;
  let code = "enterprise_policy_unavailable";
  try {
    input.signal?.throwIfAborted();
    // 企业裁决读取静态注册能力，不把 Bash 的只读优化或 MCP 注解升级成安全豁免。
    const decision = await port.authorize(
      {
        toolName: input.entry.metadata.name,
        toolCallId: input.toolCall.id,
        sessionId: input.deps.sessionId,
        workspacePath: input.scope.workspaceRoot,
        workspaceIdentity: input.scope.workspaceIdentity,
        workingDirectory: input.scope.workingDirectory,
        input: snapshotEnterpriseInput(input.executionInput),
        phase: input.phase,
        capability: {
          permission: input.entry.metadata.mcpPresentation
            ? "mcp"
            : input.entry.permission.permission,
          sideEffectScope: input.entry.permission.sideEffectScope,
          readOnly: input.entry.metadata.readOnly,
          destructive: input.entry.metadata.destructive,
          networkGuarded: input.deps.httpClientPort?.enterpriseNetworkGuarded === true,
          assetGuarded:
            input.entry.metadata.name === "Skill" &&
            !input.entry.metadata.mcpPresentation &&
            input.deps.skillPort?.enterpriseAssetGuarded === true,
        },
        traceContext: input.traceContext,
      },
      input.signal,
    );
    input.signal?.throwIfAborted();
    if (!matchesEnterpriseExecutionScope(input.deps, input.scope))
      code = "enterprise_execution_context_changed";
    else if (decision?.allowed === true) return undefined;
    else if (typeof decision?.code === "string" && /^[a-z_]{1,80}$/.test(decision.code))
      code = decision.code;
  } catch {
    /* 外部身份/网络异常不能泄露请求或凭据，也不能回退到 yolo 放行。 */
  }
  const cancelled = input.signal?.aborted === true;
  const error = createCoreError(
    cancelled ? CoreErrorType.ToolCancelled : CoreErrorType.PermissionDenied,
    cancelled ? "Enterprise authorization cancelled" : code,
    {
      context: {
        code: cancelled ? "enterprise_authorization_cancelled" : code,
        source: "enterprise-policy",
      },
      recoverable: true,
    },
  );
  await emitPermissionDenied(input.deps, input.toolCall, error.message, input.traceContext);
  const result = createErrorResult(input.toolCall, error);
  await emitToolCallError(
    input.deps,
    input.toolCall.id,
    input.traceContext,
    input.traceContext.turnId ?? input.deps.turnId,
    result.error,
  );
  return result;
}
