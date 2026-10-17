import {
  ucasGatewayModelsSchema,
  ucasGatewaySyncResultSchema,
  type UcasGatewaySyncResult,
  type UcasGatewayView,
} from "@zcode/shared";

interface AppliedProvisioning {
  apiKeyApplied: boolean;
  hasApiKey: boolean;
  modelsAdded: number;
  modelsSkipped: number;
}

/** 纯数据投影不持有身份或业务状态；所有发布仍由Gateway唯一owner执行。 */
export function uncommittedGatewayResult(view: UcasGatewayView): UcasGatewaySyncResult {
  return {
    view: structuredClone(view),
    committed: false,
    apiKeyApplied: false,
    apiKeyReused: false,
    providerHasApiKey: false,
    modelsAdded: 0,
    modelsSkipped: 0,
  };
}

export function committedGatewayResult(
  view: UcasGatewayView,
  applied: AppliedProvisioning,
  apiKeyReused: boolean,
  modelsOnly = false,
): UcasGatewaySyncResult {
  return ucasGatewaySyncResultSchema.parse({
    view: structuredClone(view),
    committed: true,
    apiKeyApplied: !modelsOnly && applied.apiKeyApplied,
    apiKeyReused,
    providerHasApiKey: applied.hasApiKey,
    modelsAdded: applied.modelsAdded,
    modelsSkipped: applied.modelsSkipped,
  });
}

export function readyGatewayProjection(
  current: UcasGatewayView,
  facts: Pick<
    UcasGatewayView,
    "user" | "endpoint" | "key" | "subscriptions" | "usage" | "lastSyncedAt"
  >,
  plan: { ids: readonly string[]; unrestricted: boolean; hasSubscription: boolean },
): Omit<UcasGatewayView, "revision"> {
  return {
    ...current,
    ...facts,
    status: "ready",
    configured: true,
    models: ucasGatewayModelsSchema.parse({
      available: [...plan.ids],
      unrestricted: plan.unrestricted,
      hasSubscription: plan.hasSubscription,
      appliedCount: plan.ids.length,
      pendingCount: 0,
    }),
    error: null,
  };
}

export function emptyGatewayProjection(
  current: UcasGatewayView,
  status: "signed-out" | "idle",
  clearEndpoint = false,
): Omit<UcasGatewayView, "revision"> {
  return {
    ...current,
    status,
    endpoint: clearEndpoint ? null : current.endpoint,
    user: null,
    key: null,
    subscriptions: [],
    usage: null,
    models: null,
    error: null,
  };
}

export function appliedModelsProjection(
  current: UcasGatewayView,
  ids: readonly string[],
): Omit<UcasGatewayView, "revision"> {
  return {
    ...current,
    models: current.models
      ? { ...current.models, available: [...ids], appliedCount: ids.length, pendingCount: 0 }
      : current.models,
  };
}
export function modelCatalogProjection(
  current: UcasGatewayView,
  plan: { models: readonly string[]; unrestricted: boolean; hasSubscription: boolean },
  local: ReadonlySet<string>,
): Omit<UcasGatewayView, "revision"> {
  const pending = plan.models.filter((id) => !local.has(id)).length;
  return {
    ...current,
    models: ucasGatewayModelsSchema.parse({
      available: plan.models,
      unrestricted: plan.unrestricted,
      hasSubscription: plan.hasSubscription,
      appliedCount: plan.models.length - pending,
      pendingCount: pending,
    }),
  };
}
