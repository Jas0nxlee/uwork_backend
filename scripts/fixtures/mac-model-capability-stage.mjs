/** Owned Mac test facility: original Admin mutation and safe supplier evidence. */
import assert from "node:assert/strict";
import { macStageDigest } from "./mac-backend-stage-snapshot.mjs";
import { createHash } from "node:crypto";
const TITLE_SHA =
  "d3d0746e09609cd62773e0df8957adbbb35199c7b214f27329513090cc431383";
const sha = (text) => createHash("sha256").update(text).digest("hex");
function stableResource(row) {
  const copy = structuredClone(row);
  delete copy.revision;
  delete copy.updated_at;
  delete copy.data.supportsTools;
  return copy;
}
export async function updateOwnedModelCapability(
  api,
  prefix,
  modelId,
  supportsTools,
) {
  assert.equal(typeof api, "function");
  assert.match(prefix, /^\/api\/tenants\/[A-Za-z0-9_-]+$/);
  assert.match(modelId, /^[A-Za-z0-9_-]+$/);
  assert.equal(typeof supportsTools, "boolean");
  const read = async () => {
    const rows = await api(prefix + "/models");
    assert.ok(Array.isArray(rows), "Original model resource array required");
    const matches = rows.filter((row) => row.id === modelId);
    assert.equal(matches.length, 1, "Exactly one owned model required");
    const row = structuredClone(matches[0]);
    assert.equal(
      row.tenant_id,
      prefix.split("/").at(-1),
      "Owned tenant required",
    );
    assert.equal(row.kind, "model");
    assert.ok(Number.isSafeInteger(row.revision) && row.revision > 0);
    assert.equal(typeof row.data.supportsTools, "boolean");
    return row;
  };
  const before = await read();
  assert.notEqual(
    before.data.supportsTools,
    supportsTools,
    "Actual capability transition required",
  );
  const result = await api(prefix + "/models/" + modelId, "PUT", {
    ...before.data,
    name: before.name,
    scope: before.scope,
    enabled: before.enabled,
    revision: before.revision,
    supportsTools,
  });
  assert.equal(result?.ok, true, "Original Admin PUT acknowledgement required");
  const after = await read();
  assert.equal(after.revision, before.revision + 1);
  assert.equal(after.data.supportsTools, supportsTools);
  assert.deepEqual(
    stableResource(after),
    stableResource(before),
    "Only capability/revision/update timestamp may change",
  );
  return {
    modelId,
    beforeRevision: before.revision,
    afterRevision: after.revision,
    supportsTools,
    unchangedDigest: macStageDigest(stableResource(after)),
  };
}
function text(message) {
  if (typeof message.content === "string") return message.content;
  assert.ok(Array.isArray(message.content), "Original text message required");
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}
export function projectCapabilitySupplierRequests(
  modelRequests,
  { fromIndex, workspacePath, marker, expectedTools },
) {
  assert.ok(Array.isArray(modelRequests));
  assert.ok(Number.isSafeInteger(fromIndex) && fromIndex >= 0);
  assert.equal(typeof workspacePath, "string");
  assert.ok(workspacePath.startsWith("/") && !/[\r\n]/.test(workspacePath));
  assert.equal(typeof marker, "string");
  assert.ok(marker.length > 0);
  assert.ok(Number.isSafeInteger(expectedTools) && expectedTools >= 0);
  assert.equal(
    modelRequests.length,
    fromIndex + 2,
    "Exactly one main and one title request required",
  );
  const rows = modelRequests.slice(fromIndex).map((request, offset) => {
    assert.ok(Array.isArray(request.messages));
    assert.equal(
      request.model,
      "controlled",
      "Original owned supplier model required",
    );
    const systems = request.messages.filter((m) => m.role === "system");
    assert.equal(systems.length, 1);
    const system = text(systems[0]);
    const users = request.messages.filter((m) => m.role === "user");
    assert.ok(
      users.some((m) => text(m).includes(marker)),
      "Stage user marker required",
    );
    return {
      request,
      index: fromIndex + offset,
      system,
      systemSha256: sha(system),
      roles: request.messages.map((m) => m.role),
    };
  });
  const mainRows = rows.filter(
    (r) => r.request.stream === true && r.systemSha256 !== TITLE_SHA,
  );
  const titleRows = rows.filter(
    (r) => r.request.stream === false && r.systemSha256 === TITLE_SHA,
  );
  assert.equal(mainRows.length, 1, "Unique original streamed main required");
  assert.equal(titleRows.length, 1, "Unique exact original title required");
  const main = mainRows[0],
    title = titleRows[0];
  const cwd = [
    ...main.system.matchAll(/^- Primary working directory: ([^\r\n]+)$/gm),
  ].map((m) => m[1]);
  assert.deepEqual(
    cwd,
    [workspacePath],
    "Exact original main workspace required",
  );
  assert.equal(main.roles[0], "system");
  assert.deepEqual(title.roles, ["system", "user"]);
  assert.equal(Buffer.byteLength(title.system), 997);
  assert.ok(
    title.system.startsWith(
      "Generate a concise title for this coding session.",
    ),
  );
  for (const key of ["tools", "tool_choice"]) {
    assert.equal(
      Object.hasOwn(title.request, key),
      false,
      "Title request must omit tools",
    );
    if (expectedTools === 0)
      assert.equal(
        Object.hasOwn(main.request, key),
        false,
        "Text-only main must omit tool fields, not send empty placeholders",
      );
  }
  if (expectedTools > 0) {
    assert.ok(Array.isArray(main.request.tools));
    assert.equal(main.request.tools.length, expectedTools);
    assert.equal(main.request.tool_choice, "auto");
  }
  const safe = (row) => ({
    index: row.index,
    model: row.request.model,
    stream: row.request.stream,
    roles: row.roles,
    toolCount: row.request.tools?.length ?? 0,
    toolsPresent: Object.hasOwn(row.request, "tools"),
    toolChoicePresent: Object.hasOwn(row.request, "tool_choice"),
    systemSha256: row.systemSha256,
    systemBytes: Buffer.byteLength(row.system),
    requestDigest: macStageDigest(row.request),
  });
  return {
    fromIndex,
    toIndex: modelRequests.length,
    main: { ...safe(main), cwdMatches: true, userMarkerMatched: true },
    title: safe(title),
    requestDigests: rows.map((r) => macStageDigest(r.request)),
  };
}
