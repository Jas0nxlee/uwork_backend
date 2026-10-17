import { z } from "zod";
import type { UWorkBackendSession } from "../enterprise-identity/backendSessionContract.js";
import {
  uworkSecuritySchema,
  UWorkBackendSessionError,
} from "../enterprise-identity/backendSessionContract.js";
import { ConversationShareClientError } from "./conversationShareHttpClient.js";

export interface ConversationSharePublicationAuthorization {
  authorize(files: boolean, target?: string): Promise<AbortSignal | undefined>;
}
export interface ConversationSharePublicationPolicy {
  run<T>(
    operation: (authorization: ConversationSharePublicationAuthorization) => Promise<T>,
  ): Promise<T>;
}
const decisionSchema = z.object({
  allowed: z.literal(true),
  tenantId: z.string().min(1).max(256),
  security: uworkSecuritySchema,
  sharing: z
    .object({
      publish: z.enum(["disabled", "organization", "internet"]),
      collaborate: z.enum(["disabled", "organization", "internet"]),
      files: z.boolean(),
      wechat: z.boolean(),
      wecom: z.boolean(),
    })
    .strict(),
});
function denied(): never {
  throw new ConversationShareClientError({
    kind: "feature_disabled",
    message: "Enterprise sharing authorization is unavailable",
  });
}

/** 分享沿用同一身份所有者，不能把旧允许或 private 模式当成组织隔离证据。 */
export function createUWorkPublicationPolicy(
  backend: UWorkBackendSession,
): ConversationSharePublicationPolicy {
  return {
    async run(operation) {
      try {
        const result = await backend.run(async (scope) => {
          const authorization: ConversationSharePublicationAuthorization = {
            async authorize(files, target) {
              const response = await scope.request("/api/client/authorize", {
                action: "share",
                target: "internet",
              });
              const parsed = decisionSchema.safeParse(response.body);
              if (
                response.status !== 200 ||
                !parsed.success ||
                parsed.data.tenantId !== scope.tenantId ||
                parsed.data.sharing.publish !== "internet" ||
                (files && !parsed.data.sharing.files)
              )
                denied();
              if (target !== undefined) {
                let url: URL;
                try {
                  url = new URL(target);
                } catch {
                  denied();
                }
                if (
                  !["https:", "http:"].includes(url.protocol) ||
                  url.username ||
                  url.password ||
                  url.hash ||
                  !parsed.data.security.allowNetwork ||
                  (parsed.data.security.allowedDomains.length > 0 &&
                    !parsed.data.security.allowedDomains.includes(url.hostname))
                )
                  denied();
              }
              await scope.assertCurrent();
              return scope.signal;
            },
          };
          await authorization.authorize(false);
          return operation(authorization);
        });
        if (result.managed) return result.value;
        return await operation({
          async authorize() {
            // 未受管状态也逐次重查；发布中途切换到受管配置必须重新开始。
            const latest = await backend.run(async () => denied());
            if (latest.managed) denied();
            return undefined;
          },
        });
      } catch (error) {
        if (error instanceof UWorkBackendSessionError) denied();
        throw error;
      }
    },
  };
}
