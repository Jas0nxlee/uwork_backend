import { z } from "zod";
import { uworkClientPresentationSchema, type UWorkClientPresentation } from "@zcode/shared";
import type { UWorkBackendSession } from "./backendSessionContract.js";

const publishedSchema = z.object({
  tenantId: z.string().min(1).max(256),
  versions: z.object({ "new-chat": z.number().int().nonnegative() }),
  configuration: z.object({
    "new-chat": z
      .object({
        welcome: z.string().max(2000),
        riskNotice: z.string().min(1).max(2000),
      })
      .strict(),
  }),
  riskPrefix: z.string().min(1).max(2000),
});

/** Stateless projection through the existing private identity scope, never an allow cache. */
export function createClientPresentationReader(backend: UWorkBackendSession) {
  return async (): Promise<UWorkClientPresentation> => {
    try {
      const result = await backend.run(async (scope) => {
        const response = await scope.request("/api/client/configuration");
        if (response.status !== 200) throw new Error("presentation_unavailable");
        const published = publishedSchema.parse(response.body);
        if (published.tenantId !== scope.tenantId) throw new Error("presentation_owner_changed");
        const projection = uworkClientPresentationSchema.parse({
          status: "ready",
          version: published.versions["new-chat"],
          ...published.configuration["new-chat"],
          riskPrefix: published.riskPrefix,
        });
        await scope.assertCurrent();
        return projection;
      });
      return result.managed ? result.value : { status: "unmanaged" };
    } catch {
      return { status: "unavailable" };
    }
  };
}
