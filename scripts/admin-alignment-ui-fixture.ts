import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import type { InjectOptions, InjectPayload } from "light-my-request";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/identity.js";
import { currentActor } from "../src/access.js";

const port = Number(process.env.UWORK_VERIFICATION_PORT ?? 3027);
assert.ok(Number.isInteger(port) && port > 1024 && port !== 3000);
const origin = `http://uwork-admin-completion.localhost:${port}`;
const app = await createApp({
  database: ":memory:",
  masterKey: randomBytes(32),
  publicUrl: origin,
  worker: false,
});
const { tenantId, userId } = await bootstrap(app.services.db, {
  name: "Admin alignment verification",
  email: "owner@alignment.example.test",
  password: "synthetic-alignment-only",
});
const login = await app.inject({
  method: "POST",
  url: "/api/auth/login",
  payload: {
    email: "owner@alignment.example.test",
    password: "synthetic-alignment-only",
  },
});
assert.equal(login.statusCode, 200);
const headers = { authorization: `Bearer ${login.json().token}` };
const base = `/api/tenants/${tenantId}`;
async function write(
  path: string,
  payload: InjectPayload,
  method: "POST" | "PUT" = "POST",
) {
  const request: InjectOptions = {
    method,
    url: base + path,
    headers,
    payload,
  };
  const response = await app.inject(request);
  assert.ok(response.statusCode < 300, `${path}: ${response.statusCode}`);
  return response.json();
}
for (const role of ["admin", "operator", "auditor", "member"]) {
  await write("/members", {
    email: `${role}@alignment.example.test`,
    name: `Alignment ${role}`,
    password: "synthetic-alignment-only",
    role,
    seat: true,
  });
}
const assetData = {
  kind: "skill",
  name: "Alignment versioned skill",
  scope: { all: true },
  content: {
    files: [{ path: "SKILL.md", content: "# Alignment fixture version one" }],
  },
};
const asset = await write("/assets", assetData);
await write(`/assets/${asset.id}/review`, { version: 1, approved: true });
await write(`/assets/${asset.id}/publish`, { version: 1 });
const resources = await app.inject({ url: `${base}/assets`, headers });
assert.equal(resources.statusCode, 200);
const resource = resources
  .json()
  .items.find((row: { id: string }) => row.id === asset.id);
assert.ok(resource);
await write(
  `/assets/${asset.id}`,
  {
    ...assetData,
    revision: resource.revision,
    content: {
      files: [{ path: "SKILL.md", content: "# Alignment fixture version two" }],
    },
  },
  "PUT",
);
const credential = await write("/credentials", {
  name: "Alignment synthetic credential",
  value: "synthetic-not-a-provider-key",
});
const model = await write("/models", {
  name: "Alignment model (not invoked)",
  upstreamModel: "fixture",
  baseUrl: "https://model.example.test",
  credentialId: credential.id,
  scope: { all: true },
});
const agentData = {
  name: "Alignment versioned agent",
  modelId: model.id,
  instructions: "Synthetic fixture; no execution.",
  scope: { all: true },
};
const agent = await write("/agents", agentData);
await write(`/agents/${agent.id}/publish`, { version: 1 });
const actor = currentActor(app.services.db, tenantId, userId);
const entryId = app.services.entitlements.reserve(
  actor,
  "alignment-uncertain",
  model.id,
  "alignment-fixture",
  100,
);
app.services.entitlements.uncertain(entryId);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
try {
  await app.listen({ host: "127.0.0.1", port });
  console.log(`Synthetic admin alignment fixture: ${origin}`);
} catch (error) {
  await app.close();
  throw error;
}
