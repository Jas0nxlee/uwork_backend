import assert from "node:assert/strict";
import test from "node:test";
import {
  MAC_STAGE_SELECTS,
  captureMacBackendStage,
  assertMacActorAccountingDelta,
  assertMacOtherActorAccountingUnchanged,
  macStageDigest,
} from "./mac-backend-stage-snapshot.mjs";
const context = {
  authority: "owned-fixture-existing-db",
  phase: "before-send",
  sampledAt: 1000,
  actors: [
    { label: "current", tenantId: "tenant-A", userId: "member-A" },
    { label: "other", tenantId: "tenant-A", userId: "member-B" },
  ],
};
function fixture(added = false) {
  const calls = [];
  const data = {
    member: [
      {
        tenant_id: "tenant-A",
        user_id: "member-A",
        status: "active",
        seat: 1,
        role: "member",
        department_id: null,
      },
    ],
    sessions: [
      {
        kind: "web",
        count: 1,
        first_created_at: 1,
        last_created_at: 1,
        min_expires_at: 2000,
        max_expires_at: 2000,
        hash: "DO_NOT_OUTPUT_SESSION_HASH",
      },
    ],
    subscription: [
      {
        seats: 10,
        credits: 1000,
        starts_at: 1,
        ends_at: 2000,
        metering: "calendar",
      },
    ],
    memberLimit: [{ amount: 100 }],
    configurations: [
      {
        kind: "security",
        version: 2,
        revision: 3,
        published: JSON.stringify({
          allowFilesystem: false,
          private: "DO_NOT_OUTPUT_CONFIG_BODY",
        }),
      },
    ],
    policies: [
      {
        id: "policy",
        family: "model",
        priority: 1,
        enabled: 1,
        scope: '{"all":true}',
        data: '{"mode":"allow","resourceIds":["m"]}',
        created_at: 1,
      },
    ],
    models: [
      {
        id: "m",
        name: "Owned Model",
        tenant_id: "tenant-A",
        revision: 3,
        enabled: 1,
        status: "published",
        scope: '{"all":true}',
        data: JSON.stringify({
          credentialId: "DO_NOT_OUTPUT_CREDENTIAL",
          baseUrl: "DO_NOT_OUTPUT_BASEURL",
          contextWindow: 500000,
          maxOutputTokens: 1024,
          supportsTools: true,
          supportsVision: false,
          supportsReasoning: false,
          inputRate: 1000,
          outputRate: 1000,
        }),
      },
    ],
    ledger: [],
    traces: [],
    gatewayCalls: [],
  };
  if (added) {
    for (let i = 0; i < 2; i++) {
      data.ledger.push({
        id: "l" + i,
        tenant_id: "tenant-A",
        user_id: "member-A",
        department_id: null,
        request_key: "request" + i,
        application: "uwork",
        model_id: "m",
        period: "100",
        amount: 22,
        reserved: 100,
        status: "settled",
        input_tokens: 12,
        output_tokens: 10,
        created_at: 1100,
        settled_at: 1101,
      });
      data.traces.push({
        id: "t" + i,
        tenant_id: "tenant-A",
        user_id: "member-A",
        application: "uwork",
        model_id: "m",
        status: "succeeded",
        input_tokens: 12,
        output_tokens: 10,
        error_code: null,
        created_at: 1100,
      });
      data.gatewayCalls.push({
        tenant_id: "tenant-A",
        user_id: "member-A",
        department_id: null,
        request_key: "request" + i,
        has_result: 1,
        created_at: 1100,
      });
    }
  }
  const db = {
    all(sql, ...args) {
      const name = Object.keys(MAC_STAGE_SELECTS).find(
        (name) => MAC_STAGE_SELECTS[name] === sql,
      );
      assert.ok(name);
      calls.push({ name, sql, args });
      if (name === "member") return [{ ...data.member[0], user_id: args[1] }];
      if (
        ["ledger", "traces", "gatewayCalls"].includes(name) &&
        args[1] === "member-B"
      )
        return [];
      return structuredClone(data[name]);
    },
  };
  return { db, data, calls };
}
const expected = {
  ledgerRows: 2,
  traceRows: 2,
  gatewayCalls: 2,
  credits: 44,
  inputTokens: 24,
  outputTokens: 20,
  modelId: "m",
  application: "uwork",
};
test("snapshot borrows synchronous SELECT-only authority without emitting secrets, bodies or synthetic catalog version", () => {
  const f = fixture();
  const result = captureMacBackendStage(f.db, context);
  const text = JSON.stringify(result);
  assert.ok(
    f.calls.every(
      (c) => c.sql.startsWith("SELECT ") && !c.sql.includes("SELECT *"),
    ),
  );
  assert.ok(f.calls.every((c) => c.args[0] === "tenant-A"));
  for (const marker of [
    "DO_NOT_OUTPUT_SESSION_HASH",
    "DO_NOT_OUTPUT_CREDENTIAL",
    "DO_NOT_OUTPUT_BASEURL",
    "DO_NOT_OUTPUT_CONFIG_BODY",
  ])
    assert.ok(!text.includes(marker));
  assert.equal(result.actors.current.nonexpiredSessionCounts[0].count, 1);
  assert.equal(result.actors.current.configurations[0].version, 2);
  assert.equal(result.catalogHasOriginalVersion, false);
  assert.match(result.provenance, /not an HTTP\/UI\/execution/);
  assert.equal(
    result.actors.current.tenantModelDefinitions[0].supportsTools,
    true,
  );
});
test("real row shapes allow exact actor/idempotency-key ledger association and aggregate tokens/credits only", () => {
  const a = captureMacBackendStage(fixture().db, context),
    b = captureMacBackendStage(fixture(true).db, {
      ...context,
      phase: "after-settle",
      sampledAt: 1200,
    });
  const proof = assertMacActorAccountingDelta(a, b, "current", expected);
  assert.equal(proof.ledgerRows, 2);
  assert.match(proof.traceBinding, /no schema request-key relation/);
  assertMacOtherActorAccountingUnchanged(a, b, "other");
  assert.equal(
    b.actors.current.accounting.ledger[0].requestKeyDigest,
    macStageDigest("request0"),
  );
  assert.ok(!JSON.stringify(b).includes('"request_key"'));
});
test("another actor or tenant returned by an adapter fails instead of being silently filtered", () => {
  for (const key of ["user_id", "tenant_id"]) {
    const f = fixture(true);
    f.data.ledger[0][key] = "foreign";
    assert.throws(() => captureMacBackendStage(f.db, context));
  }
});
test("zero-delta check rejects released zero-cost rows and failed Trace additions, not merely extra Credit", () => {
  const before = captureMacBackendStage(fixture().db, context);
  const f = fixture(true);
  f.data.ledger.forEach((r) => {
    r.amount = 0;
    r.status = "released";
  });
  f.data.traces.forEach((r) => {
    r.status = "failed";
    r.input_tokens = 0;
    r.output_tokens = 0;
  });
  const after = captureMacBackendStage(f.db, context);
  assert.throws(() =>
    assertMacActorAccountingDelta(before, after, "current", {
      ledgerRows: 0,
      traceRows: 0,
      gatewayCalls: 0,
      credits: 0,
      inputTokens: 0,
      outputTokens: 0,
    }),
  );
});
test("wrong-model success, missing gateway keys, modified prior rows, or another member delta are not accepted", () => {
  const before = captureMacBackendStage(fixture().db, context),
    after = captureMacBackendStage(fixture(true).db, context);
  const wrong = structuredClone(after);
  wrong.actors.current.accounting.traces[0].model_id = "other-model";
  assert.throws(() =>
    assertMacActorAccountingDelta(before, wrong, "current", expected),
  );
  const key = structuredClone(after);
  key.actors.current.accounting.gatewayCalls[0].requestKeyDigest = "unmatched";
  assert.throws(() =>
    assertMacActorAccountingDelta(before, key, "current", expected),
  );
  const modified = structuredClone(after);
  modified.actors.current.accounting.ledger[0].amount = 23;
  assert.throws(() =>
    assertMacActorAccountingDelta(after, modified, "current", {
      ledgerRows: 0,
      traceRows: 0,
      gatewayCalls: 0,
      credits: 0,
      inputTokens: 0,
      outputTokens: 0,
    }),
  );
  const other = structuredClone(after);
  other.actors.other.accounting.ledger.push(
    after.actors.current.accounting.ledger[0],
  );
  assert.throws(() =>
    assertMacOtherActorAccountingUnchanged(before, other, "other"),
  );
});
test("two labels cannot masquerade as two isolated members for one actor", () => {
  assert.throws(() =>
    captureMacBackendStage(fixture().db, {
      ...context,
      actors: [context.actors[0], { ...context.actors[0], label: "other" }],
    }),
  );
});
test("async adapters, wrong authority, duplicate labels and unsafe phase names fail before claiming a snapshot", () => {
  assert.throws(() =>
    captureMacBackendStage(
      {
        all() {
          return Promise.resolve([]);
        },
      },
      context,
    ),
  );
  for (const change of [
    { authority: "production-db" },
    { phase: "../arbitrary" },
    { actors: [context.actors[0], context.actors[0]] },
  ])
    assert.throws(() =>
      captureMacBackendStage(fixture().db, { ...context, ...change }),
    );
});
