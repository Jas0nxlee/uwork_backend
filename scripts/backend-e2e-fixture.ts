import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import type { WecomProvider } from "../src/wecom.js";
import type { createApp as CreateApp } from "../src/app.js";

export interface WholeBackendAccount {
  name: string;
  email: string;
  password: string;
  tenantId?: string;
  userId?: string;
}
export interface FixtureStart {
  kind: "start";
  requestId: number;
  database: string;
  masterKey: string;
  port: number;
  initialize: boolean;
  accounts: WholeBackendAccount[];
  sandboxSocket?: string;
  sandboxImage?: string;
}
export type FixtureCommand =
  | FixtureStart
  | {
      kind: "shutdown" | "backup" | "dump-requests";
      requestId: number;
      destination?: string;
    }
  | { kind: "inject-retention-clock"; requestId: number; tenantId: string };

let app: Awaited<ReturnType<typeof CreateApp>> | undefined;
const loadBuilt = (name: string) =>
  import(pathToFileURL(resolve("dist", `${name}.js`)).href);
let database = "";
const requests = new Map<string, number>();
const provider: WecomProvider = {
  identity: async (_config, _credential, code) => {
    if (code !== "whole-wecom-code")
      throw new Error("Controlled WeCom rejected code");
    return "whole-wecom-user";
  },
  directory: async () => ({
    departments: [
      { id: "whole-wecom-dept", name: "whole-wecom-synced", parentId: null },
    ],
    members: [
      {
        id: "whole-wecom-user",
        name: "whole-wecom-member",
        departmentId: "whole-wecom-dept",
        active: true,
      },
    ],
  }),
};

async function command(message: FixtureCommand) {
  if (message.kind === "start") {
    database = message.database;
    const { createApp } = await loadBuilt("app");
    app = await createApp({
      database,
      masterKey: Buffer.from(message.masterKey, "hex"),
      publicUrl: `http://uwork-whole-ui.localhost:${message.port}`,
      allowPrivateUpstreams: true,
      worker: true,
      logger: false,
      wecomProvider: provider,
      ...(message.sandboxSocket
        ? {
            sandboxSocket: message.sandboxSocket,
            sandboxImage: message.sandboxImage,
          }
        : {}),
    });
    app!.addHook("onResponse", async (request, reply) => {
      const key = `${request.method} ${request.routeOptions.url ?? "<unmatched>"} ${reply.statusCode}`;
      requests.set(key, (requests.get(key) ?? 0) + 1);
    });
    if (message.initialize) {
      const { bootstrap } = await loadBuilt("identity");
      for (const account of message.accounts) {
        const initialized = await bootstrap(app!.services.db, {
          name: account.name,
          email: account.email,
          password: account.password,
        });
        account.tenantId = initialized.tenantId;
        account.userId = initialized.userId;
      }
    }
    const url = await app!.listen({ host: "127.0.0.1", port: message.port });
    return { url, accounts: message.accounts, pid: process.pid };
  }
  if (!app) throw new Error("Fixture is not running");
  if (message.kind === "dump-requests") return Object.fromEntries(requests);
  if (message.kind === "backup") {
    const { backupDatabase } = await loadBuilt("db");
    if (!message.destination) throw new Error("Missing backup destination");
    await backupDatabase(database, message.destination);
    return { backedUp: true };
  }
  if (message.kind === "inject-retention-clock") {
    // 唯一运行中SQL故障注入：只将HTTP创建的合成事件移到留存截止点之前。
    const result = app.services.db.run(
      "UPDATE client_events SET created_at=? WHERE tenant_id=? AND event_key LIKE 'whole-retention-%'",
      Date.now() - 8 * 86400000,
      message.tenantId,
    );
    return { agedSyntheticEvents: Number(result.changes) };
  }
  await app.close();
  app = undefined;
  return { closed: true };
}

if (process.send) {
  let chain = Promise.resolve();
  process.on("message", (message: FixtureCommand) => {
    chain = chain.then(async () => {
      try {
        const value = await command(message);
        process.send?.({ requestId: message.requestId, ok: true, value });
        if (message.kind === "shutdown") process.disconnect?.();
      } catch (error) {
        process.send?.({
          requestId: message.requestId,
          ok: false,
          error: error instanceof Error ? error.message : "fixture_failure",
        });
      }
    });
  });
  const stop = () => {
    void app?.close().finally(() => process.exit(0));
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  process.on("disconnect", () => {
    if (app) stop();
  });
}
