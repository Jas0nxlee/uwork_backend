import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixtures.js";

test("agent version history is readable and reflects immutable updates", async (t) => {
  const { app, headers, p, agent, model } = await fixture(
    t,
    "http://127.0.0.1:9",
  );
  const first = await app.inject({
    method: "GET",
    url: `${p}/agents/${agent}/versions`,
    headers,
  });
  assert.equal(first.statusCode, 200);
  const firstRows = first.json() as {
    version: number;
    approved: number;
    created_at: number;
  }[];
  assert.deepEqual(
    firstRows.map((row) => row.version),
    [1],
  );
  assert.equal(firstRows[0]!.approved, 1);
  assert.equal(typeof firstRows[0]!.created_at, "number");

  const listed = (
    await app.inject({ method: "GET", url: `${p}/agents`, headers })
  ).json() as {
    id: string;
    name: string;
    data: Record<string, unknown>;
    scope: unknown;
    enabled: boolean;
    revision: number;
  }[];
  const current = listed.find((row) => row.id === agent)!;
  const updated = await app.inject({
    method: "PUT",
    url: `${p}/agents/${agent}`,
    headers,
    payload: {
      name: current.name,
      scope: current.scope,
      enabled: current.enabled,
      revision: current.revision,
      modelId: model,
      instructions: "Updated instructions",
      maxOutputTokens: 128,
    },
  });
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.json().version, 2);

  const second = await app.inject({
    method: "GET",
    url: `${p}/agents/${agent}/versions`,
    headers,
  });
  assert.deepEqual(
    (second.json() as { version: number }[]).map((row) => row.version),
    [2, 1],
  );

  const missing = await app.inject({
    method: "GET",
    url: `${p}/agents/missing-agent/versions`,
    headers,
  });
  assert.equal(missing.statusCode, 404);
});
