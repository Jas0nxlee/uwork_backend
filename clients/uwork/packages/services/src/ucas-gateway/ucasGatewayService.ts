import { Emitter } from "@zcode/rpc";
import {
  ucasGatewayViewSchema,
  type UcasGatewayError,
  type UcasGatewaySyncResult,
  type UcasGatewaySubscription,
  type UcasGatewayUsageRequest,
  type UcasGatewayView,
} from "@zcode/shared";
import type { IUcasGatewayService, UcasGatewayProvisioningTarget } from "./contract.js";
import { UcasGatewayRequestError, type UcasGatewayClient } from "./ucasGatewayClient.js";
import type { UcasGatewayStore } from "./ucasGatewayStore.js";
import {
  createGatewayIdentityScope,
  createScopedGatewayClient,
  isGatewayProjectionCurrent,
  type GatewayIdentityScope,
  type GatewayIdentitySource,
} from "./gatewayIdentityScope.js";
import { createServiceLogger } from "../logger/serviceLogger.js";
import {
  resolveGatewayEndpoint as resolveEndpoint,
  ensureGatewayKey as ensureKey,
  readGatewayPlanModels as readPlanModels,
  readGatewayModelApplication,
} from "./gatewayProvisioningReads.js";
import {
  uncommittedGatewayResult,
  committedGatewayResult,
  readyGatewayProjection,
  emptyGatewayProjection,
  appliedModelsProjection,
  modelCatalogProjection,
} from "./gatewayViewProjection.js";

export interface UcasGatewayServiceOptions extends GatewayIdentitySource {
  readonly store: UcasGatewayStore;
  readonly provisioning: UcasGatewayProvisioningTarget;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly now?: () => number;
  readonly onDiagnostic?: (event: { readonly code: string; readonly reason: string }) => void;
}

export function createUcasGatewayService(
  options: UcasGatewayServiceOptions,
): IUcasGatewayService & { dispose(): void; disposeAll(): void } {
  const log = createServiceLogger("ucas-gateway");
  const now = options.now ?? Date.now;
  const changed = new Emitter<UcasGatewayView>();
  let disposed = false;
  let hydrated = false;
  let syncTask: Promise<UcasGatewaySyncResult> | null = null;
  let usageSerial = 0;
  let projectedScope: GatewayIdentityScope | null = null;
  let view: UcasGatewayView = {
    revision: 0,
    status: "signed-out",
    configured: false,
    user: null,
    endpoint: null,
    key: null,
    subscriptions: [],
    usage: null,
    models: null,
    lastSyncedAt: null,
    error: null,
  };

  const publish = (next: Omit<UcasGatewayView, "revision">): void => {
    if (disposed) return;
    const parsed = ucasGatewayViewSchema.safeParse({
      ...next,
      revision: view.revision + 1,
    });
    if (!parsed.success) {
      // 视图是不可信外部数据的投影；不合格的字段宁可丢弃也不能进入 Renderer。
      log.warn(undefined, "UCAS gateway view was rejected by its schema");
      return;
    }
    view = parsed.data;
    changed.fire(structuredClone(view));
  };
  const hydrate = async (): Promise<void> => {
    if (hydrated) return;
    hydrated = true;
    try {
      const state = await options.store.read();
      if (state) {
        publish({
          ...view,
          status: "idle",
          endpoint: state.endpoint,
          key: state.key,
          lastSyncedAt: state.lastSyncedAt,
        });
      }
    } catch {
      log.warn(undefined, "UCAS gateway state was not readable; continuing without it");
    }
  };
  const diagnostic = (code: UcasGatewayError, reason: string): UcasGatewayError => {
    options.onDiagnostic?.({ code, reason });
    log.warn(undefined, "UCAS gateway request failed", { code, reason });
    return code;
  };
  const errorCode = (error: unknown): UcasGatewayError => {
    if (error instanceof UcasGatewayRequestError) {
      if (error.kind === "unauthorized") return diagnostic("unauthorized", "unauthorized");
      if (error.kind === "network") return diagnostic("network", "network");
      return diagnostic("failed", `http-${error.status ?? 0}`);
    }
    return diagnostic("failed", "unexpected");
  };
  const signedOutResult = () => uncommittedGatewayResult(view);
  const clearIdentityProjection = (invalidScope?: GatewayIdentityScope) => {
    // 旧操作不能清掉新owner已提交的视图；失效投影才移除全部身份派生数据。
    if (
      projectedScope?.managed &&
      projectedScope.isCurrent() &&
      projectedScope.signal !== invalidScope?.signal
    )
      return;
    const managed = projectedScope?.managed || invalidScope?.managed;
    projectedScope = null;
    publish(
      emptyGatewayProjection(
        view,
        options.readIdentityAuthority?.()?.session ? "idle" : "signed-out",
        !!managed,
      ),
    );
  };
  const runSync = async (reason: string): Promise<UcasGatewaySyncResult> => {
    await hydrate();
    const session = await options.readIdentitySession();
    if (!session) {
      projectedScope = null;
      clearIdentityProjection();
      return signedOutResult();
    }
    const apiBaseUrl = await options.resolveApiBaseUrl();
    if (!apiBaseUrl) {
      publish({
        ...view,
        status: "idle",
        configured: false,
        error: "unconfigured",
      });
      return signedOutResult();
    }
    publish({ ...view, status: "syncing", configured: true, error: null });
    const backend = (await options.resolveBackend?.()) ?? "ucas";
    let scope: GatewayIdentityScope | undefined;
    try {
      scope = createGatewayIdentityScope(options, session, apiBaseUrl, backend, () => disposed);
      await scope.assertCurrent();
      const client = createScopedGatewayClient(options, session, apiBaseUrl, backend, scope);
      const user = await client.readProfile();
      await scope.assertCurrent();
      const keyInfo = await ensureKey(client);
      await scope.assertCurrent();
      const endpoint = resolveEndpoint(await client.readGatewayEndpoints());
      await scope.assertCurrent();
      const plan = await readPlanModels(client, endpoint, keyInfo.apiKey);
      await scope.assertCurrent();
      const applied = await options.provisioning.apply({
        baseUrl: endpoint.baseUrl,
        apiKey: keyInfo.apiKey,
        ...(reason === "replace-key" || client.issueDeviceCredential
          ? { replaceApiKey: true }
          : {}),
        modelIds: plan.ids,
        ...(plan.descriptors ? { managedModels: plan.descriptors } : {}),
      });
      await scope.assertCurrent();
      // Provider 确认写入后才吊销旧凭据，查询/写入失败不能破坏原本可用的配置。
      if (client.retireDeviceCredential && view.key && view.key.id !== keyInfo.key?.id)
        await client
          .retireDeviceCredential(view.key.id)
          .catch(() => log.warn(undefined, "Previous device credential could not be retired"));
      await scope.assertCurrent();
      // 套餐读取失败不阻断已完成的关键配置：视图字段要求可变数组，显式拷贝一次。
      const subscriptions: UcasGatewaySubscription[] = [
        ...(await client.readSubscriptions().catch(() => [])),
      ];
      const usage = await client
        .readUsage({
          period: view.usage?.period ?? "month",
          metric: view.usage?.metric ?? "requests",
        })
        .catch(() => null);
      await scope.assertCurrent();
      const lastSyncedAt = now();
      await options.store
        .write({
          version: 1,
          userId: user.id,
          orgId: user.orgId,
          endpoint,
          key: keyInfo.key,
          lastSyncedAt,
        })
        .catch(() => log.warn(undefined, "UCAS gateway state was not persisted"));
      await scope.assertCurrent();
      projectedScope = scope;
      publish(
        readyGatewayProjection(
          view,
          { user, endpoint, key: keyInfo.key, subscriptions, usage, lastSyncedAt },
          plan,
        ),
      );
      log.info(undefined, "UCAS gateway provisioning synced", {
        reason,
        endpoint: endpoint.source,
        authMode: keyInfo.reused ? "reused" : "generated",
      });
      return committedGatewayResult(view, applied, keyInfo.reused);
    } catch (error) {
      if (backend === "uwork" && (!scope || !scope.isCurrent())) {
        clearIdentityProjection(scope);
        return signedOutResult();
      }
      publish({
        ...view,
        status: "error",
        configured: true,
        error: errorCode(error),
      });
      return signedOutResult();
    }
  };
  const serializeSync = (reason: string): Promise<UcasGatewaySyncResult> => {
    const previous = syncTask ?? Promise.resolve();
    const task = previous
      .catch(() => undefined)
      .then(() => (disposed ? signedOutResult() : runSync(reason)));
    syncTask = task;
    const cleanup = () => {
      if (syncTask === task) syncTask = null;
    };
    void task.then(cleanup, cleanup);
    return task;
  };
  const withSession = async (
    operation: (client: UcasGatewayClient, scope: GatewayIdentityScope) => Promise<void>,
    isCurrent: () => boolean = () => true,
  ): Promise<UcasGatewayView> => {
    await hydrate();
    const session = await options.readIdentitySession();
    const apiBaseUrl = session ? await options.resolveApiBaseUrl() : undefined;
    if (!session || !apiBaseUrl) {
      if (!session) {
        projectedScope = null;
        clearIdentityProjection();
      }
      return structuredClone(view);
    }
    const backend = (await options.resolveBackend?.()) ?? "ucas";
    let scope: GatewayIdentityScope | undefined;
    try {
      scope = createGatewayIdentityScope(options, session, apiBaseUrl, backend, () => disposed);
      await scope.assertCurrent();
      if (
        scope.managed &&
        !(await isGatewayProjectionCurrent(projectedScope, view.endpoint?.baseUrl, apiBaseUrl))
      )
        clearIdentityProjection(scope);
      const client = createScopedGatewayClient(options, session, apiBaseUrl, backend, scope);
      await operation(client, scope);
      await scope.assertCurrent();
      if (!isCurrent()) return structuredClone(view);
      if (view.error !== null) publish({ ...view, error: null });
    } catch (error) {
      if (backend === "uwork" && (!scope || !scope.isCurrent())) clearIdentityProjection(scope);
      else if (isCurrent()) publish({ ...view, error: errorCode(error) });
    }
    return structuredClone(view);
  };

  return {
    onDidChange: changed.event,
    async getView() {
      await hydrate();
      const session = await options.readIdentitySession();
      if (
        projectedScope?.managed &&
        !(await isGatewayProjectionCurrent(
          projectedScope,
          view.endpoint?.baseUrl,
          await options.resolveApiBaseUrl(),
        ))
      )
        clearIdentityProjection(projectedScope);
      if (!session && view.status !== "signed-out") {
        projectedScope = null;
        publish(emptyGatewayProjection(view, "signed-out"));
      } else if (session && view.status === "signed-out") {
        publish({
          ...view,
          status: "idle",
          configured: Boolean(await options.resolveApiBaseUrl()),
        });
      }
      return structuredClone(view);
    },
    sync(reason) {
      return serializeSync(reason);
    },
    refreshUsage(request: UcasGatewayUsageRequest) {
      // 服务端统计是慢聚合：连续切换周期/指标时，响应可能乱序返回。
      // 只接受最后一次请求的结果，避免旧周期数据把新选择覆盖回去（界面表现为来回闪动）。
      const serial = ++usageSerial;
      return withSession(
        async (client, scope) => {
          const usage = await client.readUsage(request);
          await scope.assertCurrent();
          if (serial !== usageSerial) return;
          publish({
            ...view,
            status: view.status === "signed-out" ? "ready" : view.status,
            usage,
          });
        },
        () => serial === usageSerial,
      );
    },
    async refreshModels() {
      return withSession(async (client, scope) => {
        await hydrate();
        const endpoint = view.endpoint;
        if (!endpoint && !scope.managed) return;
        const plan = await client.readPlanModels();
        const local = new Set(await options.provisioning.listModels());
        await scope.assertCurrent();
        publish(modelCatalogProjection(view, plan, local));
      });
    },
    async applyModels() {
      await hydrate();
      const session = await options.readIdentitySession();
      if (!session) {
        projectedScope = null;
        clearIdentityProjection();
        return signedOutResult();
      }
      const apiBaseUrl = await options.resolveApiBaseUrl();
      if (!apiBaseUrl) return signedOutResult();
      const backend = (await options.resolveBackend?.()) ?? "ucas";
      let scope: GatewayIdentityScope | undefined;
      try {
        scope = createGatewayIdentityScope(options, session, apiBaseUrl, backend, () => disposed);
        await scope.assertCurrent();
        const endpoint = view.endpoint,
          ids = view.models?.available ?? [];
        const currentProjection =
          !scope.managed ||
          (await isGatewayProjectionCurrent(projectedScope, endpoint?.baseUrl, apiBaseUrl));
        // 模型缓存是投影，不是写权限；换用户/组织后重新走同一同步owner获取目录。
        if (
          !endpoint ||
          !currentProjection ||
          ids.length === 0 ||
          (scope.managed &&
            (view.user?.id !== session.profile.id || view.user.orgId !== session.profile.tenantId))
        )
          return serializeSync("models");
        const models = await readGatewayModelApplication(
          scope.managed
            ? createScopedGatewayClient(options, session, apiBaseUrl, backend, scope)
            : undefined,
          ids,
        );
        await scope.assertCurrent();
        const applied = await options.provisioning.apply({
          baseUrl: endpoint.baseUrl,
          modelIds: models.ids,
          ...(models.descriptors ? { managedModels: models.descriptors } : {}),
        });
        await scope.assertCurrent();
        projectedScope = scope;
        publish(appliedModelsProjection(view, models.ids));
        return committedGatewayResult(view, applied, false, true);
      } catch (error) {
        if (backend === "uwork" && (!scope || !scope.isCurrent())) clearIdentityProjection(scope);
        else publish({ ...view, error: errorCode(error) });
        return signedOutResult();
      }
    },
    replaceApiKey() {
      return serializeSync("replace-key");
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      changed.dispose();
    },
    disposeAll() {
      disposed = true;
      changed.dispose();
    },
  };
}
