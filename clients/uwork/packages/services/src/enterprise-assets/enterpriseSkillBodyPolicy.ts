import { randomUUID } from "node:crypto";
import {
  UWorkBackendSessionError,
  type UWorkBackendSession,
} from "../enterprise-identity/backendSessionContract.js";
import type { ISkillsService } from "../skills/skills.js";
import { EnterpriseAssetStoreError } from "./contract.js";
import { readHostSkillPolicy } from "./hostBackendAssets.js";

const READ_TIMEOUT_MS = 70000;
function requirePersonal(policy: Awaited<ReturnType<typeof readHostSkillPolicy>>) {
  if (!policy.allowFilesystem) throw new EnterpriseAssetStoreError("enterprise_filesystem_denied");
  if (!policy.personalSkills || !policy.dangerousSkills)
    throw new EnterpriseAssetStoreError("enterprise_personal_skills_denied");
}
function read<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve()
      .then(() => {
        signal.throwIfAborted();
        return work();
      })
      .then(
        (value) => {
          signal.removeEventListener("abort", abort);
          resolve(value);
        },
        (error) => {
          signal.removeEventListener("abort", abort);
          reject(error);
        },
      );
  });
}

/** Legacy list also contains bodies; both existing outlets must stay within one private identity scope. */
export function withEnterpriseSkillBodyPolicy(
  service: ISkillsService,
  backendSession: UWorkBackendSession,
): ISkillsService {
  const guarded = async <T>(work: () => Promise<T>): Promise<T> => {
    const traceId = randomUUID();
    let result: { managed: false } | { managed: true; value: T };
    try {
      result = await backendSession.run(
        async (scope) => {
          requirePersonal(await readHostSkillPolicy(scope));
          const value = await read(work, scope.signal);
          requirePersonal(await readHostSkillPolicy(scope));
          return value;
        },
        { traceId, signal: AbortSignal.timeout(READ_TIMEOUT_MS) },
      );
    } catch (error) {
      const code =
        (error instanceof EnterpriseAssetStoreError || error instanceof UWorkBackendSessionError) &&
        /^enterprise_[a-z_]{1,64}$/.test(error.code)
          ? error.code
          : "enterprise_skill_read_failed";
      throw new EnterpriseAssetStoreError(code, traceId);
    }
    return result.managed ? result.value : work();
  };
  return {
    ...service,
    list(params) {
      const captured = structuredClone(params);
      return guarded(() => service.list(captured));
    },
    buildPromptContext(params) {
      const captured = structuredClone(params);
      return guarded(() => service.buildPromptContext(captured));
    },
  };
}
