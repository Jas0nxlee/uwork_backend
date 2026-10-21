// Test observation only: borrow the owned fixture's existing synchronous Db.all.
// Never construct Db, open a database, mutate business state, or infer UI application.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export const MAC_STAGE_SELECTS = Object.freeze({
  member:
    "SELECT tenant_id,user_id,role,department_id,status,seat FROM members WHERE tenant_id=? AND user_id=?",
  sessions:
    "SELECT kind,count(*) AS count,min(created_at) AS first_created_at,max(created_at) AS last_created_at,min(expires_at) AS min_expires_at,max(expires_at) AS max_expires_at FROM sessions WHERE tenant_id=? AND user_id=? AND expires_at>? GROUP BY kind ORDER BY kind",
  subscription:
    "SELECT seats,credits,starts_at,ends_at,metering FROM subscriptions WHERE tenant_id=?",
  memberLimit:
    "SELECT amount FROM limits WHERE tenant_id=? AND subject_type='member' AND subject_id=?",
  configurations:
    "SELECT kind,version,revision,published FROM configurations WHERE tenant_id=? ORDER BY kind",
  policies:
    "SELECT id,family,priority,enabled,scope,data,created_at FROM policies WHERE tenant_id=? ORDER BY id",
  models:
    "SELECT id,tenant_id,name,revision,enabled,status,data,scope FROM resources WHERE tenant_id=? AND kind='model' ORDER BY id",
  ledger:
    "SELECT id,tenant_id,user_id,department_id,request_key,application,model_id,period,amount,reserved,status,input_tokens,output_tokens,created_at,settled_at FROM ledger WHERE tenant_id=? AND user_id=? ORDER BY id",
  traces:
    "SELECT id,tenant_id,user_id,application,model_id,status,input_tokens,output_tokens,error_code,created_at FROM traces WHERE tenant_id=? AND user_id=? ORDER BY id",
  gatewayCalls:
    "SELECT tenant_id,user_id,request_key,created_at,result IS NOT NULL AS has_result FROM gateway_calls WHERE tenant_id=? AND user_id=? ORDER BY request_key",
});

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
export function macStageDigest(value) {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
const pick = (row, keys) =>
  Object.fromEntries(keys.map((key) => [key, row[key]]));
function owner(row, actor) {
  assert.equal(row.tenant_id, actor.tenantId);
  assert.equal(row.user_id, actor.userId);
}
function read(db, name, args) {
  const rows = db.all(MAC_STAGE_SELECTS[name], ...args);
  assert.ok(
    Array.isArray(rows),
    "Snapshot queries must be synchronous, SELECT-only",
  );
  return rows;
}
const ledgerKeys = [
  "id",
  "tenant_id",
  "user_id",
  "department_id",
  "application",
  "model_id",
  "period",
  "amount",
  "reserved",
  "status",
  "input_tokens",
  "output_tokens",
  "created_at",
  "settled_at",
];
const traceKeys = [
  "id",
  "tenant_id",
  "user_id",
  "application",
  "model_id",
  "status",
  "input_tokens",
  "output_tokens",
  "error_code",
  "created_at",
];

export function captureMacBackendStage(db, context) {
  assert.equal(context.authority, "owned-fixture-existing-db");
  assert.match(context.phase, /^[a-z][a-z0-9-]{0,63}$/);
  assert.ok(Number.isSafeInteger(context.sampledAt) && context.sampledAt > 0);
  assert.ok(
    Array.isArray(context.actors) &&
      context.actors.length >= 1 &&
      context.actors.length <= 3,
  );
  assert.equal(
    new Set(context.actors.map((a) => a.label)).size,
    context.actors.length,
  );
  assert.equal(
    new Set(context.actors.map((a) => JSON.stringify([a.tenantId, a.userId])))
      .size,
    context.actors.length,
    "Isolation labels must identify distinct actor/tenant pairs",
  );
  const actors = {};
  for (const actor of context.actors) {
    assert.match(actor.label, /^[a-z][a-z0-9-]{0,31}$/);
    for (const id of [actor.tenantId, actor.userId])
      assert.ok(typeof id === "string" && id.length > 0 && id.length <= 128);
    const scope = [actor.tenantId, actor.userId];
    const member = read(db, "member", scope);
    assert.equal(member.length, 1);
    owner(member[0], actor);
    const sessions = read(db, "sessions", [...scope, context.sampledAt]).map(
      (row) =>
        pick(row, [
          "kind",
          "count",
          "first_created_at",
          "last_created_at",
          "min_expires_at",
          "max_expires_at",
        ]),
    );
    const configurations = read(db, "configurations", [actor.tenantId]).map(
      (row) => ({
        kind: row.kind,
        version: row.version,
        revision: row.revision,
        publishedDigest: macStageDigest(JSON.parse(row.published)),
      }),
    );
    const policies = read(db, "policies", [actor.tenantId]).map((row) => ({
      ...pick(row, ["id", "family", "priority", "enabled", "created_at"]),
      scopeDigest: macStageDigest(JSON.parse(row.scope)),
      dataDigest: macStageDigest(JSON.parse(row.data)),
    }));
    const tenantModelDefinitions = read(db, "models", [actor.tenantId]).map(
      (row) => {
        assert.equal(row.tenant_id, actor.tenantId);
        const data = JSON.parse(row.data);
        return {
          ...pick(row, ["id", "revision", "enabled", "status"]),
          scopeDigest: macStageDigest(JSON.parse(row.scope)),
          nameDigest: macStageDigest(row.name),
          ...pick(data, [
            "contextWindow",
            "maxOutputTokens",
            "supportsTools",
            "supportsVision",
            "supportsReasoning",
            "inputRate",
            "outputRate",
          ]),
        };
      },
    );
    const ledger = read(db, "ledger", scope).map((row) => {
      owner(row, actor);
      return {
        ...pick(row, ledgerKeys),
        requestKeyDigest: macStageDigest(row.request_key),
      };
    });
    const traces = read(db, "traces", scope).map((row) => {
      owner(row, actor);
      return pick(row, traceKeys);
    });
    const gatewayCalls = read(db, "gatewayCalls", scope).map((row) => {
      owner(row, actor);
      return {
        ...pick(row, ["tenant_id", "user_id", "created_at", "has_result"]),
        requestKeyDigest: macStageDigest(row.request_key),
      };
    });
    const accounting = { ledger, traces, gatewayCalls };
    actors[actor.label] = {
      identity: pick(member[0], [
        "tenant_id",
        "user_id",
        "role",
        "department_id",
        "status",
        "seat",
      ]),
      nonexpiredSessionCounts: sessions,
      subscription: read(db, "subscription", [actor.tenantId]).map((row) =>
        pick(row, ["seats", "credits", "starts_at", "ends_at", "metering"]),
      ),
      memberLimit: read(db, "memberLimit", scope).map((row) => ({
        amount: row.amount,
      })),
      configurations,
      policies,
      tenantModelDefinitions,
      accounting,
      accountingDigest: macStageDigest(accounting),
    };
  }
  return {
    schema: "mac-backend-stage-v1",
    phase: context.phase,
    sampledAt: context.sampledAt,
    provenance:
      "synchronous SELECTs on owned fixture authority; not an HTTP/UI/execution acknowledgement",
    catalogHasOriginalVersion: false,
    traceRequestKeyJoin:
      "unavailable-in-original-schema; aggregate trace proof only",
    actors,
  };
}

function addedRows(before, after, key) {
  const ids = new Set(before.map((row) => row[key]));
  assert.equal(ids.size, before.length);
  const next = new Map(after.map((row) => [row[key], row]));
  assert.equal(next.size, after.length);
  for (const row of before)
    assert.deepEqual(
      next.get(row[key]),
      row,
      "Pre-existing accounting row changed or vanished",
    );
  return after.filter((row) => !ids.has(row[key]));
}
export function assertMacActorAccountingDelta(before, after, label, expected) {
  const a = before.actors[label],
    b = after.actors[label];
  assert.ok(a && b);
  assert.equal(a.identity.tenant_id, b.identity.tenant_id);
  assert.equal(a.identity.user_id, b.identity.user_id);
  const ledger = addedRows(a.accounting.ledger, b.accounting.ledger, "id");
  const traces = addedRows(a.accounting.traces, b.accounting.traces, "id");
  const calls = addedRows(
    a.accounting.gatewayCalls,
    b.accounting.gatewayCalls,
    "requestKeyDigest",
  );
  assert.equal(ledger.length, expected.ledgerRows);
  assert.equal(traces.length, expected.traceRows);
  assert.equal(calls.length, expected.gatewayCalls);
  assert.equal(
    ledger.reduce((n, row) => n + row.amount, 0),
    expected.credits,
  );
  assert.equal(
    traces.reduce((n, row) => n + row.input_tokens, 0),
    expected.inputTokens,
  );
  assert.equal(
    traces.reduce((n, row) => n + row.output_tokens, 0),
    expected.outputTokens,
  );
  if (expected.ledgerRows > 0) {
    assert.ok(
      typeof expected.modelId === "string" && expected.modelId.length > 0,
    );
    assert.ok(
      typeof expected.application === "string" &&
        expected.application.length > 0,
    );
    assert.ok(
      [...ledger, ...traces].every(
        (row) =>
          row.model_id === expected.modelId &&
          row.application === expected.application,
      ),
      "New ledger/Trace rows must match the exact expected model and application",
    );
    assert.ok(ledger.every((row) => row.status === "settled"));
    assert.ok(traces.every((row) => row.status === "succeeded"));
    assert.equal(
      ledger.reduce((n, row) => n + row.input_tokens, 0),
      expected.inputTokens,
    );
    assert.equal(
      ledger.reduce((n, row) => n + row.output_tokens, 0),
      expected.outputTokens,
    );
    for (const row of ledger)
      assert.ok(
        calls.some((call) => call.requestKeyDigest === row.requestKeyDigest),
        "Ledger must match an observed gateway call key for this exact actor",
      );
  }
  return {
    ledgerRows: ledger.length,
    traceRows: traces.length,
    gatewayCalls: calls.length,
    traceBinding:
      "actor/model/application/token aggregate; no schema request-key relation",
  };
}
export function assertMacOtherActorAccountingUnchanged(before, after, label) {
  assert.deepEqual(after.actors[label].identity, before.actors[label].identity);
  assert.deepEqual(
    after.actors[label].accounting,
    before.actors[label].accounting,
  );
}
