import test from "node:test";
import assert from "node:assert/strict";
import { sourceRoutes } from "./route-source.js";

test("route guards resolve constant prefixes and isolate expression handlers without counting comments", () => {
  const found = sourceRoutes(
    'const API="/api/client/shares"; app.get(`${API}/:code/preview`, async request => readShareForViewer(db, request)); app.post(`${API}/preparations`, async request => { /* authenticate(db) */ return publisher(db, request); });',
    "fixture.ts",
  );
  assert.deepEqual(
    found.map((r) => r.path),
    ["/api/client/shares/:code/preview", "/api/client/shares/preparations"],
  );
  assert.deepEqual(found[0]!.calls, ["readShareForViewer"]);
  assert.deepEqual(found[1]!.calls, ["publisher"]);
});

test("route guards use the enclosing constant rather than a sibling scope and reject unknown paths", () => {
  const found = sourceRoutes(
    'function a() { const p="/api/a"; app.get(`${p}/x`, f); } function b() { const p="/api/b"; app.get(`${p}/x`, f); }',
    "fixture.ts",
  );
  assert.deepEqual(
    found.map((r) => r.path),
    ["/api/a/x", "/api/b/x"],
  );
  assert.throws(
    () => sourceRoutes("app.get(unknown, f)", "fixture.ts"),
    /Unresolved route path/,
  );
});

test("route guards enumerate finite constant loop paths rather than silently skipping them", () => {
  const found = sourceRoutes(
    'const p="/api/tenants/:tenantId"; for (const endpoint of ["health", "files"] as const) app.get(`${p}/drive/${endpoint}`, async req => authenticate(db, req));',
    "fixture.ts",
  );
  assert.deepEqual(
    found.map((r) => r.path),
    [
      "/api/tenants/:tenantId/drive/health",
      "/api/tenants/:tenantId/drive/files",
    ],
  );
});

test("route guards resolve the requested tuple binding without treating metadata columns as routes", () => {
  const found = sourceRoutes(
    'const p="/api/tenants/:tenantId"; for (const [route, table] of [["audit", "audit"], ["events", "client_events"]] as const) { app.get(`${p}/${route}`, f); }',
    "fixture.ts",
  );
  assert.deepEqual(
    found.map((r) => r.path),
    ["/api/tenants/:tenantId/audit", "/api/tenants/:tenantId/events"],
  );
});
