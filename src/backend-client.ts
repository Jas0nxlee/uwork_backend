import { z } from "zod";
export class BackendClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`UWork backend: ${code}`);
  }
}
const modelSchema = z.object({
  id: z.string(),
  name: z.string(),
  context_window: z.number(),
  max_output_tokens: z.number(),
});
const assetSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(["skill", "expert", "connector", "playbook", "instruction"]),
  version: z.number().int(),
  checksum: z.string(),
  distributed: z.boolean(),
});
export const snapshotSchema = z.object({
  tenantId: z.string(),
  versions: z.record(z.string(), z.number().int()),
  configuration: z.record(z.string(), z.unknown()),
  security: z.object({
    allowShell: z.boolean(),
    allowFilesystem: z.boolean(),
    allowNetwork: z.boolean(),
    dangerousSkills: z.boolean(),
    allowedDomains: z.array(z.string()),
  }),
  riskPrefix: z.string(),
});
export type ClientSnapshot = z.infer<typeof snapshotSchema>;
export interface HostConfigurationPorts {
  applyModels(input: {
    baseUrl: string;
    deviceToken: string;
    models: z.infer<typeof modelSchema>[];
  }): Promise<void>;
  applyAssets(input: {
    assets: z.infer<typeof assetSchema>[];
    download: (id: string) => Promise<unknown>;
  }): Promise<void>;
  applyPolicy(snapshot: ClientSnapshot): Promise<void>;
}
/** Host-owned adapter. Tokens come from the identity owner and never enter UI projections. */
export class UWorkBackendClient {
  private base: URL;
  constructor(
    baseUrl: string,
    private readToken: () => Promise<string>,
    private fetchImpl: typeof fetch = fetch,
  ) {
    this.base = new URL(baseUrl);
    if (
      this.base.username ||
      this.base.password ||
      this.base.search ||
      this.base.hash ||
      this.base.pathname !== "/" ||
      (this.base.protocol !== "https:" &&
        !["localhost", "127.0.0.1", "[::1]"].includes(this.base.hostname))
    )
      throw new Error(
        "Backend requires an HTTPS origin (loopback HTTP is allowed for development)",
      );
  }
  private async send(
    path: string,
    method = "GET",
    body?: unknown,
    signal?: AbortSignal,
  ) {
    const token = await this.readToken();
    const response = await this.fetchImpl(new URL(path, this.base), {
      method,
      redirect: "error",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
        : AbortSignal.timeout(30000),
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.body)
      throw new BackendClientError(response.status, "EMPTY_RESPONSE");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const r = await reader.read();
        if (r.done) break;
        bytes += r.value.length;
        if (bytes > 2 * 1024 * 1024) {
          await reader.cancel();
          throw new BackendClientError(response.status, "RESPONSE_LIMIT");
        }
        chunks.push(r.value);
      }
    } finally {
      reader.releaseLock();
    }
    const raw = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    if (!response.ok) {
      const e = z
        .object({ error: z.object({ code: z.string() }) })
        .safeParse(raw);
      throw new BackendClientError(
        response.status,
        e.success ? e.data.error.code : "HTTP_ERROR",
      );
    }
    return raw;
  }
  async models(signal?: AbortSignal) {
    return z
      .object({ data: z.array(modelSchema) })
      .parse(await this.send("/v1/models", "GET", undefined, signal)).data;
  }
  async assets(signal?: AbortSignal) {
    return z
      .object({ items: z.array(assetSchema) })
      .parse(await this.send("/api/client/assets", "GET", undefined, signal))
      .items;
  }
  async configuration(signal?: AbortSignal) {
    return snapshotSchema.parse(
      await this.send("/api/client/configuration", "GET", undefined, signal),
    );
  }
  download(assetId: string, version?: number) {
    if (
      version !== undefined &&
      (!Number.isSafeInteger(version) || version < 1)
    )
      throw new Error("Asset version must be a positive safe integer");
    return this.send(
      `/api/client/assets/${encodeURIComponent(assetId)}/download${version === undefined ? "" : `?version=${version}`}`,
    );
  }
  async authorizeAsset(
    assetId: string,
    version: number,
    checksum: string,
    signal?: AbortSignal,
  ) {
    return z.object({ allowed: z.boolean() }).parse(
      await this.send(
        "/api/client/authorize",
        "POST",
        {
          action: "asset",
          target: assetId,
          assetVersion: version,
          assetChecksum: checksum,
        },
        signal,
      ),
    ).allowed;
  }
  async authorize(
    action: "execution" | "shell" | "filesystem" | "network" | "share",
    target: string,
    stricter?: {
      allowShell?: boolean;
      allowFilesystem?: boolean;
      allowNetwork?: boolean;
    },
  ) {
    return z.object({ allowed: z.boolean() }).parse(
      await this.send("/api/client/authorize", "POST", {
        action,
        target,
        stricter,
      }),
    ).allowed;
  }
  event(
    eventKey: string,
    type:
      | "configuration.applied"
      | "asset.installed"
      | "asset.removed"
      | "execution.denied"
      | "client.error",
    data: { resourceId?: string; version?: number; code?: string },
  ) {
    return this.send("/api/client/events", "POST", { eventKey, type, data });
  }
  async synchronize(ports: HostConfigurationPorts, signal?: AbortSignal) {
    const snapshot = await this.configuration(signal);
    const models = await this.models(signal);
    const assets = await this.assets(signal);
    signal?.throwIfAborted();
    await ports.applyPolicy(snapshot);
    await ports.applyModels({
      baseUrl: new URL("/v1", this.base).href,
      deviceToken: await this.readToken(),
      models,
    });
    await ports.applyAssets({ assets, download: (id) => this.download(id) });
    await this.event(
      `configuration:${JSON.stringify(snapshot.versions)}`.slice(0, 128),
      "configuration.applied",
      {},
    );
    return {
      modelCount: models.length,
      assetCount: assets.length,
      versions: snapshot.versions,
    };
  }
}
