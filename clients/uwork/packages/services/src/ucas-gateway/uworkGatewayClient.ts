import { z } from "zod";
import {
  ucasGatewayUserSchema,
  ucasGatewaySubscriptionSchema,
  ucasGatewayUsageStatsSchema,
  ucasGatewayKeySchema,
} from "@zcode/shared";
import {
  UcasGatewayRequestError,
  readJson,
  type UcasGatewayClient,
  type UcasGatewayClientOptions,
} from "./ucasGatewayClient.js";
export function createUWorkGatewayClient(options: UcasGatewayClientOptions): UcasGatewayClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const send = async (path: string, method = "GET", body?: unknown) => {
    // 自有不透明会话必须绑定签发 origin；配置换地址不能把旧凭据试发给新服务。
    if (options.issuerOrigin !== new URL(options.apiBaseUrl).origin)
      throw new UcasGatewayRequestError("unauthorized");
    let response: Response;
    try {
      response = await fetchImpl(new URL(path, options.apiBaseUrl), {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(options.timeoutMs ?? 20000),
        headers: {
          authorization: `Bearer ${options.token}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new UcasGatewayRequestError("network");
    }
    if (!response.ok)
      throw new UcasGatewayRequestError(
        response.status === 401 || response.status === 403 ? "unauthorized" : "http",
        response.status,
      );
    return readJson(response);
  };
  const issue = async () => {
    const raw = z.object({ id: z.string(), token: z.string(), expiresAt: z.number() }).parse(
      await send("/api/auth/device-tokens", "POST", {
        ttlHours: 24,
      }),
    );
    return {
      key: ucasGatewayKeySchema.parse({
        id: raw.id,
        alias: "UWork",
        maskedKey: "device-credential",
        status: "active",
      }),
      apiKey: raw.token,
    };
  };
  return {
    issueDeviceCredential: issue,
    async retireDeviceCredential(keyId) {
      await send(`/api/auth/device-tokens/${encodeURIComponent(keyId)}`, "DELETE");
    },
    async readProfile() {
      const me = z
        .object({
          user: z.object({ id: z.string(), name: z.string(), email: z.string().nullable() }),
          tenant: z.object({ id: z.string() }),
          role: z.string(),
        })
        .parse(await send("/api/auth/me"));
      return ucasGatewayUserSchema.parse({
        id: me.user.id,
        orgId: me.tenant.id,
        name: me.user.name,
        role: me.role === "owner" ? "super_admin" : me.role === "admin" ? "org_admin" : "user",
        wecomUserId: null,
        email: me.user.email,
        avatar: null,
        department: null,
        position: null,
        monthlyBudgetUsd: null,
      });
    },
    async listKeys() {
      return [];
    },
    generateKey: () => issue(),
    async revealKey() {
      throw new UcasGatewayRequestError("invalid");
    },
    async readGatewayEndpoints() {
      return { publicBaseUrl: new URL("/v1", options.apiBaseUrl).href, internalBaseUrl: null };
    },
    async readSubscriptions() {
      return [ucasGatewaySubscriptionSchema.parse(await send("/api/client/entitlement"))];
    },
    async readUsage(input) {
      const params = new URLSearchParams({ period: input.period, metric: input.metric });
      return ucasGatewayUsageStatsSchema.parse(await send(`/api/client/usage?${params}`));
    },
    async readPlanModels() {
      const raw = z
        .object({ data: z.array(z.object({ id: z.string() })) })
        .parse(await send("/v1/models"));
      return { models: raw.data.map((m) => m.id), unrestricted: false, hasSubscription: true };
    },
    async listEndpointModels() {
      const raw = z
        .object({ data: z.array(z.object({ id: z.string() })) })
        .parse(await send("/v1/models"));
      return raw.data.map((m) => m.id);
    },
  };
}
