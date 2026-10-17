import type { GatewayIdentityScope } from "./gatewayIdentityScope.js";
import { isGatewayProjectionCurrent } from "./gatewayIdentityScope.js";
import {
  clearRejectedGatewayCatalog,
  isGatewayAuthorizationRejection,
  stageEmptyGatewayCatalog,
} from "./gatewayProvisioningReads.js";
import type { UcasGatewayProvisioningTarget } from "./contract.js";

export interface GatewayProjectionScope extends GatewayIdentityScope {
  readonly identityScope: GatewayIdentityScope;
  isAdmitted(): boolean;
}
/** Gateway内部投影顺序器；只有数字代次，身份仍全部由原identity lease提供。 */
export function createGatewayProjectionAdmission(options: {
  provisioning: UcasGatewayProvisioningTarget;
  clearProjection(scope?: GatewayIdentityScope): void;
  publishFailure(error: unknown, backend: string, partial: boolean): void;
  onRejection(): void;
  onClearFailure(): void;
}) {
  let generation = 0;
  const bind = (
    identityScope: GatewayIdentityScope,
    captured = generation,
  ): GatewayProjectionScope => {
    const isAdmitted = () => !identityScope.managed || captured === generation;
    const check = () => {
      if (!isAdmitted()) throw new Error("Gateway projection admission changed");
    };
    return {
      ...identityScope,
      identityScope,
      isAdmitted,
      isCurrent: () => isAdmitted() && identityScope.isCurrent(),
      async assertCurrent() {
        check();
        await identityScope.assertCurrent();
        check();
      },
    };
  };
  return {
    advance: () => ++generation,
    isCurrent: (captured: number) => captured === generation,
    bind,
    async prepare(
      scope: GatewayProjectionScope,
      projected: GatewayIdentityScope | null,
      endpoint: string | undefined,
      apiBaseUrl: string,
    ) {
      await scope.assertCurrent();
      if (scope.managed && !(await isGatewayProjectionCurrent(projected, endpoint, apiBaseUrl))) {
        if (!scope.isCurrent()) throw new Error("Gateway projection admission changed");
        options.clearProjection(scope.identityScope);
        await stageEmptyGatewayCatalog(options.provisioning, scope, apiBaseUrl);
      }
      await scope.assertCurrent();
    },
    async fail(
      error: unknown,
      initial: GatewayProjectionScope | undefined,
      apiBaseUrl: string,
      backend: string,
      partial = false,
    ) {
      let scope = initial,
        rejected = false;
      // 过时失败不能清新快照，也不能让旧clear在新fullsync后落盘。
      if (scope && !scope.isAdmitted()) return;
      if (scope?.managed && scope.isCurrent() && isGatewayAuthorizationRejection(error)) {
        generation++;
        options.onRejection();
        scope = bind(scope.identityScope);
        // 已知拒绝立即撤投影，不让磁盘候选清理等待期间仍公开ready。
        options.publishFailure(error, backend, partial);
        rejected = true;
      }
      await clearRejectedGatewayCatalog(options.provisioning, scope, apiBaseUrl, error).catch(
        () => {
          if (scope?.isCurrent()) options.onClearFailure();
        },
      );
      if (scope && !scope.isAdmitted()) return;
      if (backend === "uwork" && (!scope || !scope.isCurrent()))
        options.clearProjection(scope?.identityScope);
      else if (!rejected) options.publishFailure(error, backend, partial);
    },
  };
}
