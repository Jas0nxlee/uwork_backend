import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/identity.js";
import {
  clientExperienceSchemas,
  isEditableClientTemplateCron,
} from "../src/client-experience.js";

type Row = Record<string, unknown>;
type Schema = { parse(value: unknown): unknown };
const fixture = JSON.parse(
  await readFile("tests/fixtures/client-experience.json", "utf8"),
) as {
  defaults: Row;
  published: Row;
  cron: { accepted: string[]; rejected: string[] };
};
const load = (path: string) =>
  import(pathToFileURL(resolve("clients/uwork", path)).href);
const client = (await load(
  "packages/shared/src/uwork-client-experience.ts",
)) as Record<string, Schema>;
const formatter = (await load(
  "packages/ui/src/settings/automationFormat.ts",
)) as { canVisualizeCronInAutomationEditor(value: string): boolean };
const validation = (await load(
  "packages/services/src/session/automationCronValidation.ts",
)) as { isValidCronExpr(value: string): boolean };
const names = {
  scenes: "uworkScenesConfigurationSchema",
  help: "uworkHelpConfigurationSchema",
  desktop: "uworkDesktopConfigurationSchema",
  "plugin-store": "uworkPluginStoreConfigurationSchema",
};
const directory = await mkdtemp(join(tmpdir(), "uwork-experience-contract-"));
const app = await createApp({
  database: join(directory, "backend.sqlite"),
  masterKey: randomBytes(32),
  publicUrl: "http://localhost:3016",
  worker: false,
});
const http: Array<{ method: string; route: string; status: number }> = [];
app.addHook("onResponse", async (request, reply) => {
  http.push({
    method: request.method,
    route: request.routeOptions.url ?? "unmatched",
    status: reply.statusCode,
  });
});
let port = 0;
try {
  const password = randomBytes(24).toString("hex");
  const owner = await bootstrap(app.services.db, {
    name: "Owned experience contract",
    email: "experience-contract@example.test",
    password,
  });
  const origin = await app.listen({ host: "127.0.0.1", port: 0 });
  port = Number(new URL(origin).port);
  assert.notEqual(port, 3000);
  let token = "";
  const request = async (path: string, method = "GET", payload?: unknown) => {
    const response = await fetch(origin + path, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(payload === undefined
          ? {}
          : { "content-type": "application/json" }),
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(response.status, 200, `${method} ${path}`);
    return (await response.json()) as Row;
  };
  token = String(
    (
      await request("/api/auth/login", "POST", {
        email: "experience-contract@example.test",
        password,
      })
    ).token,
  );
  const snapshots: Row[] = [];
  for (const kind of Object.keys(names) as Array<keyof typeof names>) {
    const schema = client[names[kind]];
    assert.ok(schema, names[kind]);
    const path = `/api/tenants/${owner.tenantId}/configurations/${kind}`;
    const before = await request("/api/client/configuration");
    assert.deepEqual(
      schema.parse((before.configuration as Row)[kind]),
      fixture.defaults[kind],
    );
    const saved = await request(path, "PUT", {
      revision: 0,
      data: fixture.published[kind],
    });
    const draftOnly = await request("/api/client/configuration");
    assert.deepEqual(
      (draftOnly.configuration as Row)[kind],
      fixture.defaults[kind],
    );
    await request(path + "/publish", "POST", { revision: saved.revision });
    const published = await request("/api/client/configuration");
    const data = schema.parse((published.configuration as Row)[kind]);
    assert.deepEqual(
      data,
      clientExperienceSchemas[kind].parse(fixture.published[kind]),
    );
    assert.equal((published.versions as Row)[kind], 1);
    snapshots.push({ kind, version: 1, validatedByActualClientBoundary: true });
  }
  const cron = [];
  for (const expression of [
    ...fixture.cron.accepted,
    ...fixture.cron.rejected,
    "0 */24 * * *",
    "0 9 */31 * *",
  ]) {
    const actualClient =
      formatter.canVisualizeCronInAutomationEditor(expression) &&
      validation.isValidCronExpr(expression);
    const server = isEditableClientTemplateCron(expression);
    assert.equal(server, actualClient, expression);
    cron.push({ expression, accepted: server });
  }
  assert.equal(
    app.services.db.get<{ n: number }>("SELECT count(*) n FROM ledger")?.n,
    0,
  );
  await mkdir("evidence/client-experience-20261017", { recursive: true });
  await writeFile(
    "evidence/client-experience-20261017/contract-http.json",
    JSON.stringify(
      {
        status: "passed",
        boundary:
          "actual isolated disk/TCP backend to actual vendored boundary schemas and actual UI builder/Croner; not private Host/Native acceptance",
        snapshots,
        cron,
        http,
        modelCalls: 0,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      status: "passed",
      kinds: snapshots.length,
      cronCases: cron.length,
      httpResponses: http.length,
      modelCalls: 0,
    }),
  );
} finally {
  await app.close();
  const closed = await new Promise<boolean>((done) => {
    const socket = createConnection(port, "127.0.0.1");
    socket.once("error", () => done(true));
    socket.once("connect", () => {
      socket.destroy();
      done(false);
    });
  });
  assert.ok(closed);
  await rm(directory, { recursive: true, force: true });
  console.log(
    JSON.stringify({
      cleanup: "passed",
      backendPortClosed: closed,
      ownedDirectoryRemoved: true,
    }),
  );
}
