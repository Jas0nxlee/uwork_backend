import type { IEnterpriseIdentityService } from "./contract.js";
import type { EnterpriseIdentitySession } from "@zcode/shared";

const disposers = new WeakMap<IEnterpriseIdentityService, () => Promise<void>>();
export interface EnterpriseIdentityAuthority {
  readonly generation: number;
  readonly revision: number;
  readonly session: EnterpriseIdentitySession | null;
  readonly signal: AbortSignal;
}
const authorities = new WeakMap<IEnterpriseIdentityService, () => EnterpriseIdentityAuthority>();

/** Node 内部端口：同步读取所有者的撤销代际，不经过可能仍待写入的持久化会话。 */
export function registerIdentityServiceAuthority(
  service: IEnterpriseIdentityService,
  read: () => EnterpriseIdentityAuthority,
): void {
  authorities.set(service, read);
}
export function readEnterpriseIdentityAuthority(
  service: IEnterpriseIdentityService,
): EnterpriseIdentityAuthority | undefined {
  return authorities.get(service)?.();
}

/** 只释放仍属于该 promise 的单次操作引用，不让迟到任务清掉较新的操作。 */
export function releaseIdentityOperation<T>(task: Promise<T>, release: () => void): Promise<T> {
  void task.finally(release).catch(() => {});
  return task;
}

/** 注册 Node owner 的资源回收，不能暴露为 Renderer RPC。 */
export function registerIdentityServiceDisposer(
  service: IEnterpriseIdentityService,
  dispose: () => Promise<void>,
): void {
  disposers.set(service, dispose);
}

export async function disposeEnterpriseIdentityService(
  service: IEnterpriseIdentityService,
): Promise<void> {
  await disposers.get(service)?.();
  disposers.delete(service);
  authorities.delete(service);
}
