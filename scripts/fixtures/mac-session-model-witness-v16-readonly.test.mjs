import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { parse } from "acorn";
import { mkdtemp, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  projectSessionModelWitness,
  readSessionModelWitness,
  bindStartupModelWitness,
} from "./mac-session-model-witness-v16-readonly.mjs";

function fixture() {
  const sessionId = "sess_owned",
    modelId = "controlled-model";
  const selection = {
    providerId: "ucas",
    modelId,
    options: { reasoningLevel: "none" },
  };
  return {
    sessionId,
    modelId,
    entries: [
      {
        id: sessionId + ":runtime-model-selection",
        session_id: sessionId,
        type: "runtime/model_selection",
        time_created: 1,
        time_updated: 2,
        data: JSON.stringify({ modelSelection: selection }),
      },
    ],
    messages: [
      {
        info: {
          id: "msg_user",
          sessionID: sessionId,
          role: "user",
          modelSelection: selection,
        },
      },
      {
        info: {
          id: "msg_assistant",
          sessionID: sessionId,
          role: "assistant",
          providerId: "ucas",
          modelId,
          time: { created: 2, completed: 3 },
        },
      },
    ],
  };
}

test("original codec unwraps durable selection; omitted startup model stays explicitly deferred", () => {
  const f = fixture(),
    witness = projectSessionModelWitness(f);
  assert.equal(witness.runtimeEntry.modelSelection.providerId, "ucas");
  assert.deepEqual(
    witness.runtimeEntry.modelSelection,
    f.messages[0].info.modelSelection,
  );
  assert.equal(witness.assistant.completed, 3);
  const deferred = bindStartupModelWitness({}, witness);
  assert.deepEqual(deferred.startupModel, {
    state: "deferred",
    modelPresent: false,
    source: "startup model omitted; durable selection witnessed separately",
  });
  assert.ok(
    !Object.hasOwn(deferred.startupModel, "value"),
    "no fabricated startup model",
  );
  assert.equal(
    bindStartupModelWitness({ model: "ucas/" + f.modelId }, witness)
      .startupModel.state,
    "present",
  );
  for (const model of [null, "", "ucas/wrong", "wrong/" + f.modelId])
    assert.throws(() => bindStartupModelWitness({ model }, witness));
});

for (const mutation of [
  "missing-entry",
  "duplicate-entry",
  "wrong-entry-sid",
  "wrong-entry-id",
  "wrong-entry-type",
  "wrong-entry-model",
  "wrong-entry-provider",
  "malformed-entry",
  "flat-legacy-entry",
  "wrong-user-model",
  "wrong-user-provider",
  "wrong-user-sid",
  "synthetic-user",
  "model-only-user",
  "wrong-assistant-model",
  "wrong-assistant-provider",
  "wrong-assistant-sid",
  "unfinished-assistant",
  "invalid-completion",
  "duplicate-user",
  "missing-assistant",
])
  test(`strict persisted model witness rejects ${mutation}`, () => {
    const f = fixture();
    const entry = f.entries[0],
      user = f.messages[0].info,
      assistant = f.messages[1].info;
    if (mutation === "missing-entry") f.entries = [];
    if (mutation === "duplicate-entry") f.entries.push(structuredClone(entry));
    if (mutation === "wrong-entry-sid") entry.session_id = "sess_other";
    if (mutation === "wrong-entry-id") entry.id = "other-entry";
    if (mutation === "wrong-entry-type") entry.type = "runtime/execution_state";
    if (mutation === "wrong-entry-model")
      entry.data = JSON.stringify({
        modelSelection: { providerId: "ucas", modelId: "wrong" },
      });
    if (mutation === "wrong-entry-provider")
      entry.data = JSON.stringify({
        modelSelection: { providerId: "wrong", modelId: f.modelId },
      });
    if (mutation === "malformed-entry") entry.data = "{";
    if (mutation === "flat-legacy-entry")
      entry.data = JSON.stringify({ providerId: "ucas", modelId: f.modelId });
    if (mutation === "wrong-user-model") user.modelSelection.modelId = "wrong";
    if (mutation === "wrong-user-provider")
      user.modelSelection.providerId = "wrong";
    if (mutation === "wrong-user-sid") user.sessionID = "sess_other";
    if (mutation === "synthetic-user") user.synthetic = true;
    if (mutation === "model-only-user") user.visibility = "model-only";
    if (mutation === "wrong-assistant-model") assistant.modelId = "wrong";
    if (mutation === "wrong-assistant-provider") assistant.providerId = "wrong";
    if (mutation === "wrong-assistant-sid") assistant.sessionID = "sess_other";
    if (mutation === "unfinished-assistant") delete assistant.time.completed;
    if (mutation === "invalid-completion") assistant.time.completed = 0;
    if (mutation === "duplicate-user")
      f.messages[1] = structuredClone(f.messages[0]);
    if (mutation === "missing-assistant") f.messages.pop();
    assert.throws(() => projectSessionModelWitness(f));
  });

test("actual readonly SQLite SELECT binds same SID and original decoder without a writer", async (t) => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "uwork-model-witness-")),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "owned.sqlite"),
    setup = new DatabaseSync(path),
    f = fixture();
  setup.exec(
    "CREATE TABLE session_entry(id,session_id,type,time_created,time_updated,data)",
  );
  for (const row of [
    ...f.entries,
    { ...f.entries[0], id: "other", session_id: "sess_other" },
  ])
    setup
      .prepare("INSERT INTO session_entry VALUES(?,?,?,?,?,?)")
      .run(
        row.id,
        row.session_id,
        row.type,
        row.time_created,
        row.time_updated,
        row.data,
      );
  setup.close();
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    assert.equal(
      readSessionModelWitness({ ...f, db }).runtimeEntry.sessionId,
      f.sessionId,
    );
    assert.throws(() => db.prepare("DELETE FROM session_entry").run());
    assert.equal(
      db.prepare("SELECT count(*) AS n FROM session_entry").get().n,
      2,
    );
  } finally {
    db.close();
  }
});

for (const [original, copy, startupName] of [
  ["mac-memory-stage.mjs", "mac-memory-stage-v16-readonly.mjs", "match"],
  [
    "mac-memory-extraction-oracle.mjs",
    "mac-memory-extraction-oracle-v16-readonly.mjs",
    "found",
  ],
])
  test(`copied ${copy} preserves all original assertions and business AST outside strict witness addition`, () => {
    const ast = (file) =>
      parse(readFileSync(new URL(file, import.meta.url), "utf8"), {
        ecmaVersion: "latest",
        sourceType: "module",
      });
    const priorStartupAssertion = parse(
      `assert.equal(${startupName}.model, "ucas/" + modelId);`,
      {
        ecmaVersion: "latest",
      },
    ).body[0];
    function clean(node) {
      if (!node || typeof node !== "object") return node;
      if (Array.isArray(node))
        return node.map(clean).filter((value) => value !== null);
      if (
        node.type === "ImportDeclaration" &&
        node.source.value === "./mac-session-model-witness-v16-readonly.mjs"
      )
        return null;
      if (node.type === "VariableDeclarator" && node.id.name === "modelWitness")
        return null;
      if (node.type === "Property" && node.key.name === "modelWitness")
        return null;
      if (
        node.type === "ExpressionStatement" &&
        node.expression.type === "AssignmentExpression" &&
        node.expression.left.name === "modelWitness"
      )
        return node.expression.right.callee.name === "bindStartupModelWitness"
          ? clean(priorStartupAssertion)
          : null;
      return Object.fromEntries(
        Object.entries(node)
          .filter(([key]) => !["start", "end", "raw"].includes(key))
          .map(([key, value]) => [
            key,
            typeof value === "string"
              ? value.replace(
                  "./mac-memory-stage-v16-readonly.mjs",
                  "./mac-memory-stage.mjs",
                )
              : clean(value),
          ]),
      );
    }
    assert.deepEqual(clean(ast(copy)), clean(ast(original)));
  });
