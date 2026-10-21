import assert from "node:assert/strict";
import type { AdminUiCasePorts, Row } from "./admin-ui-case.js";

export async function runAdminConfigurationCase(p: AdminUiCasePorts) {
  const path = p.prefix + "/configurations/new-chat";
  const initial = await p.api(path);
  const canonicalClient = async () => {
    const body = await p.api("/api/client/configuration");
    assert.equal(typeof body.fetchedAt, "number");
    delete body.fetchedAt;
    return body;
  };
  const initialClient = await canonicalClient();
  const db = p.app.services.db;
  const resources = db.all<Row>("SELECT * FROM resources ORDER BY id");
  const read = () => p.api(path);
  const client = async () =>
    (await p.api("/api/client/configuration")).configuration as Row;
  const originalWelcome = (initial.published as Row).welcome;
  p.control.configurationWelcome = originalWelcome;
  await p.saveControl();
  await p.run("configuration-save-a");
  assert.equal((await read()).revision, 1);
  assert.equal(((await read()).draft as Row).welcome, "OWNED_CONFIGURATION_A");
  assert.deepEqual(await canonicalClient(), initialClient);
  await p.run("configuration-publish-saved-a");
  assert.equal(
    ((await client())["new-chat"] as Row).welcome,
    "OWNED_CONFIGURATION_A",
  );
  assert.equal((await read()).version, 1);
  await p.run("configuration-save-c");
  assert.equal(((await read()).draft as Row).welcome, "OWNED_CONFIGURATION_C");
  assert.equal(
    ((await client())["new-chat"] as Row).welcome,
    "OWNED_CONFIGURATION_A",
  );
  await p.run("configuration-discard");
  const current = await read();
  assert.equal(current.revision, 4);
  assert.deepEqual(current.draft, current.published);
  await p.run("configuration-edit-stale-d");
  await p.api(path, "PUT", {
    revision: current.revision,
    data: { ...(current.draft as Row), welcome: "OWNED_CONFIGURATION_E" },
  });
  await p.run("configuration-stale-save-rejected");
  assert.equal(((await read()).draft as Row).welcome, "OWNED_CONFIGURATION_E");
  assert.equal(
    ((await client())["new-chat"] as Row).welcome,
    "OWNED_CONFIGURATION_A",
  );
  await p.run("configuration-reload-e");
  await p.run("configuration-publish-e");
  assert.equal(
    ((await client())["new-chat"] as Row).welcome,
    "OWNED_CONFIGURATION_E",
  );
  assert.equal((await read()).version, 2);
  await p.run("configuration-page-reloaded");
  const history = db.all<Row>(
    "SELECT version,data FROM configuration_history WHERE kind='new-chat' ORDER BY version",
  );
  assert.deepEqual(
    history.map((r) => [
      r.version,
      (JSON.parse(String(r.data)) as Row).welcome,
    ]),
    [
      [1, "OWNED_CONFIGURATION_A"],
      [2, "OWNED_CONFIGURATION_E"],
    ],
  );
  assert.deepEqual(
    db.all<Row>("SELECT * FROM resources ORDER BY id"),
    resources,
  );
  assert.equal(db.get<{ n: number }>("SELECT count(*) n FROM ledger")!.n, 0);
  assert.equal(p.supplier.length, 0);
  const etags = p.facts.configurationEtags as string[];
  assert.equal(etags.length, 6);
  assert.equal(etags[0], etags[1]);
  assert.notEqual(etags[1], etags[2]);
  assert.equal(etags[2], etags[3]);
  assert.equal(etags[3], etags[4]);
  assert.notEqual(etags[4], etags[5]);
  const writes = p.traffic.filter(
    (r) =>
      r.source === "browser" &&
      r.method !== "GET" &&
      String(r.route).includes("/configurations/"),
  );
  assert.deepEqual(
    writes.map((r) => [r.method, r.status]),
    [
      ["PUT", 200],
      ["POST", 200],
      ["PUT", 200],
      ["DELETE", 200],
      ["PUT", 409],
      ["POST", 200],
    ],
  );
  p.facts.configuration = {
    draftDoesNotPublish: true,
    unsavedEditDoesNotPublish: true,
    discardRestoresPublished: true,
    staleRevisionPreservesServerAndEditor: true,
    publishedVersions: [1, 2],
    historyOnlySavedPublications: true,
    zeroModelLedgerDelta: true,
  };
  p.facts.status = "passed";
}
