/** Test-only SELECT and original codec; no migration, configuration writer or runtime call. */
import assert from "node:assert/strict";
import { decodeSessionEntryRow } from "../../clients/uwork/apps/zcode-cli/packages/adapters/src/storage/session-store/codecs.ts";

export const MODEL_WITNESS_SELECT =
  "SELECT id,session_id,type,time_created,time_updated,data FROM session_entry WHERE session_id=? AND type='runtime/model_selection' ORDER BY id";

export function projectSessionModelWitness({ sessionId, modelId, entries, messages }) {
  assert.match(sessionId, /^sess_[A-Za-z0-9_-]+$/);
  assert.equal(typeof modelId, "string");
  assert.ok(modelId.length > 0);
  const expected = { providerId: "ucas", modelId };
  const selection = (value) => {
    assert.ok(value && typeof value === "object" && !Array.isArray(value));
    assert.equal(value.providerId, expected.providerId);
    assert.equal(value.modelId, expected.modelId);
    return structuredClone(value);
  };
  assert.equal(entries.length, 1, "one same-session persisted model selection required");
  const row = entries[0];
  assert.equal(row.session_id, sessionId);
  assert.equal(row.type, "runtime/model_selection");
  assert.equal(row.id, sessionId + ":runtime-model-selection");
  assert.equal(typeof row.data, "string");
  assert.ok(Buffer.byteLength(row.data) <= 2 * 1024 * 1024);
  const decoded = decodeSessionEntryRow(row);
  assert.equal(decoded.sessionID, sessionId);
  const persisted = selection(decoded.data);
  assert.equal(messages.length, 2);
  for (const message of messages) assert.equal(message.info.sessionID, sessionId);
  const users = messages.filter(
    (m) => m.info.role === "user" && !m.info.synthetic && m.info.visibility !== "model-only",
  );
  const assistants = messages.filter((m) => m.info.role === "assistant");
  assert.equal(users.length, 1, "one real user model selection required");
  assert.equal(assistants.length, 1, "one completed assistant model required");
  const user = users[0].info,
    assistant = assistants[0].info;
  const userSelection = selection(user.modelSelection);
  selection(assistant);
  assert.ok(Number.isFinite(assistant.time?.completed) && assistant.time.completed > 0);
  return {
    sessionId,
    providerId: expected.providerId,
    modelId,
    runtimeEntry: { id: decoded.id, sessionId: decoded.sessionID, modelSelection: persisted },
    user: { id: user.id, modelSelection: userSelection },
    assistant: {
      id: assistant.id,
      providerId: assistant.providerId,
      modelId: assistant.modelId,
      completed: assistant.time.completed,
    },
    source:
      "readonly SessionStore row through original decodeSessionEntryRow + real user/finished assistant",
  };
}

export function readSessionModelWitness({ db, sessionId, modelId, messages }) {
  return projectSessionModelWitness({
    sessionId,
    modelId,
    messages,
    entries: db.prepare(MODEL_WITNESS_SELECT).all(sessionId),
  });
}

export function bindStartupModelWitness(startup, witness) {
  assert.ok(startup && typeof startup === "object");
  if (startup.model !== undefined)
    assert.equal(startup.model, witness.providerId + "/" + witness.modelId);
  return {
    ...witness,
    startupModel:
      startup.model === undefined
        ? {
            state: "deferred",
            modelPresent: false,
            source: "startup model omitted; durable selection witnessed separately",
          }
        : { state: "present", modelPresent: true, value: startup.model },
  };
}
