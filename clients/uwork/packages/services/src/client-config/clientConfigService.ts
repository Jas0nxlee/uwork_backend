import { clientConfigReadOptionsSchema, type UWorkClientPresentation } from "@zcode/shared";
import type { IClientConfigService } from "./clientConfig.js";

/** The existing facade is a stateless display adapter to the private identity owner. */
export function createClientConfigService(dependencies: {
  readClientPresentation: () => Promise<UWorkClientPresentation>;
}): IClientConfigService {
  return {
    async getSnapshot(options = {}) {
      clientConfigReadOptionsSchema.parse(options);
      const view = await dependencies.readClientPresentation();
      if (view.status === "unmanaged") return { pluginStoreOrder: null };
      if (view.status !== "ready") throw new Error("enterprise_client_plugin_store_unavailable");
      const feature = view.pluginStore;
      if (feature.status !== "ready")
        throw new Error(`enterprise_client_plugin_store_${feature.status}`);
      return { pluginStoreOrder: structuredClone(feature.data.order) };
    },
  };
}
