import assert from "node:assert/strict";
import test from "node:test";
import {
  updateOwnedModelCapability,
  projectCapabilitySupplierRequests,
} from "./mac-model-capability-stage.mjs";
import { readFileSync } from "node:fs";
const workspacePath = "/owned/packaged-workspace";
const marker = "MAC_CAPABILITY_STAGE";
const titleSystem = readFileSync(
  "clients/uwork/apps/zcode-cli/packages/core/src/runtime/methods/title-generation-sidecar.ts",
  "utf8",
).match(/const SESSION_TITLE_SYSTEM_PROMPT = `([\s\S]*?)`;/)[1];
function requests(enabled = true) {
  const main = {
    model: "controlled",
    stream: true,
    messages: [
      {
        role: "system",
        content: `Original system\n- Primary working directory: ${workspacePath}\n`,
      },
      { role: "user", content: marker },
    ],
  };
  if (enabled)
    Object.assign(main, {
      tools: Array.from({ length: 32 }, (_, i) => ({
        type: "function",
        function: { name: `tool${i}` },
      })),
      tool_choice: "auto",
    });
  return [
    main,
    {
      model: "controlled",
      stream: false,
      messages: [
        { role: "system", content: titleSystem },
        { role: "user", content: marker },
      ],
    },
  ];
}
function apiFixture(mutate = () => {}) {
  let row = {
    id: "model1",
    tenant_id: "tenant1",
    kind: "model",
    name: "Original",
    scope: { all: true },
    enabled: true,
    status: "published",
    revision: 3,
    published_version: null,
    created_at: 1,
    updated_at: 2,
    data: {
      upstreamModel: "controlled",
      baseUrl: "DO_NOT_OUTPUT_URL",
      credentialId: "DO_NOT_OUTPUT_SECRET",
      contextWindow: 500000,
      maxOutputTokens: 1024,
      inputRate: 1000,
      outputRate: 1000,
      supportsVision: false,
      supportsReasoning: false,
      supportsTools: true,
    },
  };
  const calls = [];
  return {
    calls,
    api: async (path, method = "GET", body) => {
      calls.push({ path, method, body });
      if (method === "GET") return [structuredClone(row)];
      assert.equal(method, "PUT");
      assert.equal(body.revision, 3);
      assert.equal(body.credentialId, row.data.credentialId);
      const { name, scope, enabled, revision, ...data } = body;
      row = {
        ...row,
        name,
        scope,
        enabled,
        data,
        revision: revision + 1,
        updated_at: 3,
      };
      mutate(row);
      return { ok: true };
    },
  };
}
test("original full PUT toggles capability and revision while preserving every other model field", async () => {
  const f = apiFixture();
  const out = await updateOwnedModelCapability(
    f.api,
    "/api/tenants/tenant1",
    "model1",
    false,
  );
  assert.equal(out.beforeRevision, 3);
  assert.equal(out.afterRevision, 4);
  assert.equal(out.supportsTools, false);
  assert.deepEqual(
    f.calls.map((x) => x.method),
    ["GET", "PUT", "GET"],
  );
  assert.ok(!JSON.stringify(out).includes("DO_NOT_OUTPUT"));
});
test("readback rejects unrelated model drift", async () => {
  const f = apiFixture((r) => {
    r.data.maxOutputTokens = 8;
  });
  await assert.rejects(
    updateOwnedModelCapability(f.api, "/api/tenants/tenant1", "model1", false),
  );
});
test("readback rejects missing revision increment", async () => {
  const f = apiFixture((r) => {
    r.revision = 3;
  });
  await assert.rejects(
    updateOwnedModelCapability(f.api, "/api/tenants/tenant1", "model1", false),
  );
});
test("unsafe tenant route is rejected before any API call", async () => {
  const f = apiFixture();
  await assert.rejects(
    updateOwnedModelCapability(
      f.api,
      "/api/tenants/other/../tenant1",
      "model1",
      false,
    ),
  );
  assert.equal(f.calls.length, 0);
});
for (const enabled of [true, false])
  test(`main/title classification proves tools ${enabled ? 32 : "omitted"} without outputting request bodies`, () => {
    const out = projectCapabilitySupplierRequests(requests(enabled), {
      fromIndex: 0,
      workspacePath,
      marker,
      expectedTools: enabled ? 32 : 0,
    });
    assert.equal(out.main.index, 0);
    assert.equal(out.main.toolCount, enabled ? 32 : 0);
    assert.equal(out.title.index, 1);
    assert.ok(!JSON.stringify(out).includes("Original system"));
    assert.ok(!JSON.stringify(out).includes(marker));
  });
for (const [name, change] of [
  ["third request", (r) => r.push(r[1])],
  [
    "title used as main",
    (r) => {
      r[0] = structuredClone(r[1]);
    },
  ],
  [
    "foreign cwd",
    (r) => {
      r[0].messages[0].content = "- Primary working directory: /foreign";
    },
  ],
  [
    "marker missing",
    (r) => {
      r[0].messages[1].content = "other";
    },
  ],
  [
    "false empty tools array",
    (r) => {
      r[0].tools = [];
    },
  ],
  [
    "false tool choice",
    (r) => {
      r[0].tool_choice = "none";
    },
  ],
  [
    "different upstream",
    (r) => {
      r[0].model = "other";
    },
  ],
  [
    "wrong title",
    (r) => {
      r[1].messages[0].content =
        "Generate a concise title for this coding session. FAKE";
    },
  ],
])
  test(`rejects ${name}`, () => {
    const r = requests(false);
    change(r);
    assert.throws(() =>
      projectCapabilitySupplierRequests(r, {
        fromIndex: 0,
        workspacePath,
        marker,
        expectedTools: 0,
      }),
    );
  });
