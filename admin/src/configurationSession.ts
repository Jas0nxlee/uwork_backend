import { api } from "./api.js";

export type ConfigurationAction = "save" | "publish" | "discard";
export interface ConfigurationSnapshot {
  readonly status: "loading" | "ready" | "error";
  readonly data: unknown;
  readonly revision: number | null;
  readonly version: number | null;
  readonly busy: boolean;
  readonly error: string;
}
interface SessionOptions {
  readonly base: string;
  readonly kind: string;
  readonly notify: (message: string) => void;
  readonly prepare?: (data: unknown) => unknown;
  readonly request?: (
    path: string,
    method?: string,
    body?: unknown,
  ) => Promise<unknown>;
}
const empty = (busy = false): ConfigurationSnapshot => ({
  status: "loading",
  data: null,
  revision: null,
  version: null,
  busy,
  error: "",
});
const message = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

/** 一个keyed表单的唯一草稿owner；固定URL，异步结果必须仍属于本次激活代次。 */
export function createConfigurationSession(options: SessionOptions) {
  const path = `${options.base}/configurations/${options.kind}`;
  const request = options.request ?? api;
  const prepare = options.prepare ?? ((data: unknown) => data);
  let snapshot = empty(),
    epoch = 0,
    readSequence = 0,
    active = false;
  const listeners = new Set<() => void>();
  const publish = (next: ConfigurationSnapshot) => {
    snapshot = Object.freeze(next);
    for (const listener of listeners) listener();
  };
  const current = (lease: number) => active && lease === epoch;
  const read = async (lease: number, busy = false): Promise<boolean> => {
    if (!current(lease)) return false;
    const sequence = ++readSequence;
    publish(empty(busy));
    try {
      const reply = await request(path);
      if (!current(lease) || sequence !== readSequence) return false;
      if (
        !reply ||
        typeof reply !== "object" ||
        !("draft" in reply) ||
        !("revision" in reply) ||
        !("version" in reply) ||
        !Number.isSafeInteger(reply.revision) ||
        Number(reply.revision) < 0 ||
        !Number.isSafeInteger(reply.version) ||
        Number(reply.version) < 0
      )
        throw new Error("配置响应格式不正确，请重新加载");
      const data = prepare(reply.draft);
      publish({
        status: "ready",
        data,
        revision: Number(reply.revision),
        version: Number(reply.version),
        busy: false,
        error: "",
      });
      return true;
    } catch (error) {
      if (current(lease) && sequence === readSequence)
        publish({
          ...empty(),
          status: "error",
          error: message(error, "加载失败"),
        });
      return false;
    }
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    activate() {
      const lease = ++epoch;
      active = true;
      void read(lease);
      return () => {
        if (lease !== epoch) return;
        active = false;
        epoch++;
        readSequence++;
        publish(empty());
      };
    },
    reload: () =>
      !active || snapshot.busy ? Promise.resolve(false) : read(epoch),
    edit(data: unknown) {
      if (active && snapshot.status === "ready" && !snapshot.busy)
        publish({ ...snapshot, data, error: "" });
    },
    async action(action: ConfigurationAction): Promise<boolean> {
      if (
        !active ||
        snapshot.status !== "ready" ||
        snapshot.busy ||
        snapshot.revision === null
      )
        return false;
      if (action === "publish" && snapshot.revision === 0) return false;
      const lease = epoch,
        before = snapshot;
      let submitted = false;
      try {
        const data = action === "save" ? prepare(before.data) : undefined;
        publish({ ...before, busy: true, error: "" });
        if (action === "save")
          await request(path, "PUT", { revision: before.revision, data });
        if (action === "publish")
          await request(`${path}/publish`, "POST", {
            revision: before.revision,
          });
        if (action === "discard") await request(`${path}/draft`, "DELETE");
        submitted = true;
        // 旧请求可在原租户完成；失去scope后不能追补读取或发送新界面的toast。
        if (!current(lease)) return true;
        const loaded = await read(lease, true);
        if (!current(lease)) return true;
        if (loaded)
          options.notify(
            action === "publish"
              ? "配置已发布"
              : action === "save"
                ? "草稿已保存"
                : "已恢复已发布配置",
          );
        else
          publish({
            ...snapshot,
            error: `操作已提交，但重新加载失败。${snapshot.error}`,
          });
        return true;
      } catch (error) {
        if (current(lease))
          publish({
            ...before,
            busy: false,
            error: message(error, "操作失败"),
          });
        return submitted;
      } finally {
        if (current(lease) && snapshot.busy)
          publish({ ...snapshot, busy: false });
      }
    },
  };
}
