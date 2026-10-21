import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { hash } from "../../src/core.js";
import type { AdminUiCasePorts, Row } from "./admin-ui-case.js";

export async function runAdminDeviceCase(p: AdminUiCasePorts) {
  const db = p.app.services.db;
  await p.run("issue-original-device");
  const issued = JSON.parse(
    await readFile(String(p.control.deviceReceiptPath), "utf8"),
  ) as { token: string; id: string; expiresAt: number };
  assert.equal(typeof issued.token, "string");
  assert.ok(issued.token.length >= 32);
  // 仅内存中的脱敏值；不再保存control，后续浏览器只读取其私有签发收据。
  p.control.deviceRedactionSecret = issued.token;
  assert.equal(issued.id, hash(issued.token));
  const device = db.get<Row>("SELECT * FROM sessions WHERE hash=?", issued.id)!;
  assert.equal(device.kind, "device");
  assert.equal(device.user_id, p.control.userId);
  assert.equal(device.tenant_id, p.control.tenantId);
  assert.deepEqual(JSON.parse(String(device.scopes)), ["execute"]);
  assert.equal(device.expires_at, issued.expiresAt);
  assert.ok(
    Math.abs(Number(device.expires_at) - Number(device.created_at) - 3600000) <
      1000,
  );
  const sessions = () =>
    db.all<Row>("SELECT * FROM sessions WHERE kind='session' ORDER BY hash");
  const interactive = sessions();
  await p.run("list-device-metadata");
  const deviceApi = async (
    path: string,
    method = "GET",
    data?: Row,
    expected = 200,
  ) => {
    const reply = await fetch(String(p.control.origin) + path, {
      method,
      headers: {
        authorization: "Bearer " + issued.token,
        "x-owned-test-source": "controller",
        ...(data ? { "content-type": "application/json" } : {}),
      },
      body: data ? JSON.stringify(data) : undefined,
    });
    assert.equal(reply.status, expected, "original device bearer HTTP status");
    return reply.status === 204 ? {} : ((await reply.json()) as Row);
  };
  assert.equal(
    (await deviceApi("/api/client/configuration")).tenantId,
    p.control.tenantId,
  );
  assert.equal(
    ((await deviceApi("/v1/models")).data as Row[]).some(
      (row) => row.id === p.control.modelId,
    ),
    true,
  );
  for (const [path, method, data] of [
    [p.prefix + "/models", "GET", undefined],
    ["/api/auth/device-tokens", "GET", undefined],
    ["/api/auth/device-tokens", "POST", { ttlHours: 1 }],
    ["/api/auth/device-tokens/" + issued.id, "DELETE", undefined],
  ] as const)
    assert.equal(
      ((await deviceApi(path, method, data, 403)).error as Row).code,
      "DEVICE_SCOPE",
    );
  assert.deepEqual(
    db.get<Row>("SELECT * FROM sessions WHERE hash=?", issued.id),
    device,
  );
  const completion = (expected: number) =>
    deviceApi(
      "/v1/chat/completions",
      "POST",
      {
        model: p.control.modelId,
        messages: [{ role: "user", content: "OWNED_DEVICE_UI" }],
        max_tokens: 32,
      },
      expected,
    );
  await completion(200);
  assert.equal(p.supplier.length, 1);
  const ledger = db.all<Row>("SELECT * FROM ledger ORDER BY id");
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0]!.status, "settled");
  assert.equal(ledger[0]!.amount, 14);
  await p.api("/api/auth/device-tokens/" + issued.id, "DELETE", undefined, 204);
  await p.run("list-revoked-device");
  assert.equal(((await completion(401)).error as Row).code, "SESSION_EXPIRED");
  assert.equal(
    db.get<Row>("SELECT * FROM sessions WHERE hash=?", issued.id),
    undefined,
  );
  assert.deepEqual(sessions(), interactive);
  assert.deepEqual(db.all<Row>("SELECT * FROM ledger ORDER BY id"), ledger);
  assert.equal(p.supplier.length, 1);
  for (const name of await readdir(String(p.control.deviceEvidence)))
    if (name.endsWith(".log"))
      assert.equal(
        (
          await readFile(join(String(p.control.deviceEvidence), name), "utf8")
        ).includes(issued.token),
        false,
        "device plaintext must not enter evidence logs",
      );
  assert.equal(JSON.stringify(p.facts).includes(issued.token), false);
  const actions = db
    .all<{
      action: string;
    }>("SELECT action FROM audit WHERE action LIKE 'identity.device-token.%' ORDER BY created_at,id")
    .map((row) => row.action);
  assert.deepEqual(actions, [
    "identity.device-token.create",
    "identity.device-token.revoke",
  ]);
  p.facts.status = "passed";
  p.facts.deviceScope = ["execute"];
  p.facts.ttlHours = 1;
  p.facts.originalListOnlyMetadata = true;
  p.facts.backendRevocationStopsActualDevice = true;
  p.facts.interactiveSessionsPreserved = true;
  p.facts.noDevicePlaintextInEvidence = true;
  p.facts.settledCredits = 14;
}
