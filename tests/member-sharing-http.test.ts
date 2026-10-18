import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { randomBytes, createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  chmod,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, createConnection, type Socket } from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Agent, fetch } from "undici";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/identity.js";
import { publication, SHARE_API } from "./member-sharing-fixture.js";

const execute = promisify(execFile);
const digest = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const evidenceBase = fileURLToPath(
  new URL(
    "../evidence/client-enterprise-sharing-http-20261018/",
    import.meta.url,
  ),
);
type App = Awaited<ReturnType<typeof createApp>>;
type Auth = Record<string, string>;

async function unusedOwnedPort() {
  const reservation = createServer();
  await new Promise<void>((resolve, reject) => {
    reservation.once("error", reject);
    reservation.listen(0, "127.0.0.1", resolve);
  });
  const address = reservation.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve, reject) =>
    reservation.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}
async function accepting(port: number) {
  return new Promise<boolean>((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let connected = false;
    socket.once("connect", () => {
      connected = true;
      socket.destroy();
    });
    socket.once("error", () => socket.destroy());
    socket.setTimeout(1000, () => socket.destroy());
    socket.once("close", () => resolve(connected));
  });
}
async function scopedWriterCheck(root: string) {
  let output = "";
  try {
    output = (
      await execute(
        process.platform === "darwin" ? "/usr/sbin/lsof" : "lsof",
        ["-nP", "-F", "pfa", "+D", root],
        { timeout: 5000, maxBuffer: 1024 * 1024 },
      )
    ).stdout;
  } catch (error) {
    const result = error as {
      stdout?: string;
      stderr?: string;
      code?: number | string;
    };
    if (result.code !== 1 || result.stderr?.trim())
      return { verified: false, writerCount: 0 };
    output = result.stdout ?? "";
  }
  // 只检查本新目录的FD访问模式，不查询/记录任何外部PID或系统进程名称。
  return {
    verified: true,
    writerCount: output
      .split("\n")
      .filter((line) => line === "aw" || line === "au").length,
  };
}

async function fixture(t: TestContext, worker: boolean) {
  const ownedRoot = await realpath(
    await mkdtemp(join(tmpdir(), "uwork-share-http-")),
  );
  await chmod(ownedRoot, 0o700);
  await mkdir(evidenceBase, { recursive: true, mode: 0o700 });
  const evidence = await mkdtemp(join(evidenceBase, "run-"));
  const database = join(ownedRoot, "backend.sqlite");
  const masterKey = randomBytes(32);
  const port = await unusedOwnedPort();
  const origin = `http://127.0.0.1:${port}`;
  const sockets = new Set<Socket>();
  const summary: Record<string, unknown> = {
    worker,
    ownedRoot,
    database,
    origin,
    completed: false,
    httpRequests: 0,
    realTcp: true,
    processColdRestart: false,
    processId: process.pid,
  };
  let app: App | undefined;
  let client: Agent | undefined;
  let generations = 0;
  const current = () => {
    assert.ok(app, "owned app must be open");
    return app;
  };
  async function close() {
    // Server.close 的完成回调与每个 Socket 的 close 观察器不是同一队列。
    // 关闭前登记真实事件；不能用一次 setImmediate 或手动清空 Set 充当已关闭证据。
    const closingSockets = [...sockets].map(
      (socket) =>
        new Promise<void>((resolve) => socket.once("close", () => resolve())),
    );
    if (client) {
      await client.close();
      client = undefined;
    }
    if (app) {
      await app.close();
      app = undefined;
    }
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.all(closingSockets),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () =>
              reject(new Error("Owned socket close events exceeded 5 seconds")),
            5000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
    summary.socketCloseEventsAwaited =
      Number(summary.socketCloseEventsAwaited ?? 0) + closingSockets.length;
    assert.equal(sockets.size, 0, "owned accepted sockets must close");
    assert.equal(
      await accepting(port),
      false,
      "owned HTTP port must no longer accept",
    );
  }
  t.after(async () => {
    let closed = false;
    try {
      await close();
      closed = true;
    } finally {
      masterKey.fill(0);
      const writers = closed
        ? await scopedWriterCheck(ownedRoot)
        : { verified: false, writerCount: 0 };
      const identityMatches = await realpath(ownedRoot).then(
        (value) => value === ownedRoot,
        () => false,
      );
      const remove =
        closed &&
        writers.verified &&
        writers.writerCount === 0 &&
        identityMatches;
      if (remove) await rm(ownedRoot, { recursive: true });
      else if (identityMatches) await chmod(ownedRoot, 0o700);
      summary.cleanup = {
        appsAndClientsClosed: closed,
        acceptedSockets: sockets.size,
        portClosed: closed,
        writerScanVerified: writers.verified,
        writerCount: writers.writerCount,
        rootRemoved: remove,
        retainedMode0700: !remove && identityMatches,
      };
      await writeFile(
        join(evidence, "result.json"),
        JSON.stringify(summary, null, 2) + "\n",
        { mode: 0o600 },
      );
    }
  });
  async function open() {
    assert.ok(app === undefined, "owned app must be closed before reopening");
    app = await createApp({ database, masterKey, publicUrl: origin, worker });
    app.server.on("connection", (socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
    });
    await app.listen({ host: "127.0.0.1", port });
    client = new Agent();
    generations++;
    summary.appGenerations = generations;
  }
  async function request(
    path: string,
    status: number,
    auth: Auth = {},
    method = "GET",
    body?: unknown,
  ) {
    assert.ok(client);
    summary.httpRequests = Number(summary.httpRequests) + 1;
    const response = await fetch(origin + path, {
      dispatcher: client,
      method,
      headers: {
        origin,
        ...auth,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(response.status, status, "normal loopback HTTP status");
    return response;
  }
  async function json<T>(
    path: string,
    status: number,
    auth: Auth = {},
    method = "GET",
    body?: unknown,
  ) {
    const response = await request(path, status, auth, method, body);
    try {
      return (await response.json()) as T;
    } catch {
      throw new Error("Owned HTTP response was not valid JSON");
    }
  }
  async function login(email: string, password: string, tenantId: string) {
    const response = await request("/api/auth/login", 200, {}, "POST", {
      email,
      password,
      tenantId,
      delivery: "cookie",
    });
    const data = (await response.json()) as Record<string, unknown>;
    assert.equal(
      "token" in data,
      false,
      "Cookie delivery must not return a token JSON",
    );
    const header = response.headers.get("set-cookie");
    assert.ok(header, "Cookie delivery header must exist");
    assert.ok(
      header?.includes("HttpOnly") && header.includes("SameSite=Strict"),
    );
    return { cookie: header.split(";")[0]! };
  }
  await open();
  const password = randomBytes(24).toString("hex");
  const owner = await bootstrap(current().services.db, {
    name: "Owned TCP sharing",
    email: "http-share-owner@example.test",
    password,
  });
  const ownerAuth = await login(
    "http-share-owner@example.test",
    password,
    owner.tenantId,
  );
  const tenantApi = `/api/tenants/${owner.tenantId}`;
  await json(`${tenantApi}/members`, 201, ownerAuth, "POST", {
    name: "HTTP reader",
    email: "http-share-reader@example.test",
    password,
    role: "member",
    seat: false,
  });
  const memberAuth = await login(
    "http-share-reader@example.test",
    password,
    owner.tenantId,
  );
  async function configure(kind: "sharing" | "assistants", patch: object) {
    const url = `${tenantApi}/configurations/${kind}`;
    const old = await json<{ revision: number; published: object }>(
      url,
      200,
      ownerAuth,
    );
    const save = await json<{ revision: number }>(url, 200, ownerAuth, "PUT", {
      revision: old.revision,
      data: { ...old.published, ...patch },
    });
    await json(`${url}/publish`, 200, ownerAuth, "POST", {
      revision: save.revision,
    });
  }
  await configure("sharing", { files: true });
  const files = [
    {
      type: "text",
      extension: "txt",
      mime: "text/plain",
      bytes: Buffer.from("OWNED_HTTP_TEXT\n"),
    },
    {
      type: "md",
      extension: "md",
      mime: "text/markdown",
      bytes: Buffer.from("# OWNED_HTTP_MARKDOWN\n"),
    },
  ].map((file, index) => ({
    bytes: file.bytes,
    descriptor: {
      artifact_id: `share-artifact-${index + 1}`,
      logical_artifact_key: `share-key-${index + 1}`,
      producer_product_turn_id: "share-product-turn-1",
      artifact_version: 1,
      state: "current",
      ref: `zcode-artifact://share/share-artifact-${index + 1}`,
      artifact_type: file.type,
      display_name: `owned-${index + 1}.${file.extension}`,
      extension: file.extension,
      mime_type: file.mime,
      size_bytes: file.bytes.length,
      sha256: digest(file.bytes),
    },
  }));
  const input = publication(files.map((file) => file.descriptor));
  const prepared = await json<{ preparation_id: string }>(
    `${SHARE_API}/preparations`,
    201,
    ownerAuth,
    "POST",
    input.preparation,
  );
  for (const file of files)
    await json(
      `${SHARE_API}/preparations/${prepared.preparation_id}/artifacts`,
      201,
      ownerAuth,
      "POST",
      {
        descriptor: file.descriptor,
        content_base64: file.bytes.toString("base64"),
      },
    );
  const share = await json<{ share_code: string; share_url: string }>(
    `${SHARE_API}/preparations/${prepared.preparation_id}/confirm`,
    200,
    ownerAuth,
    "POST",
    input.confirm,
  );
  assert.equal(new URL(share.share_url).origin, origin);
  const previewPath = `${SHARE_API}/${share.share_code}/preview`;
  async function readMember() {
    const preview = await json<{
      rows: unknown[];
      integrity: object;
      artifacts: unknown[];
    }>(previewPath, 200, memberAuth);
    assert.equal(
      digest(JSON.stringify(preview.rows)),
      digest(JSON.stringify(input.confirm.projection.rows)),
    );
    assert.equal(
      digest(JSON.stringify(preview.integrity)),
      digest(JSON.stringify(input.confirm.integrity)),
    );
    assert.equal(preview.artifacts.length, files.length);
    for (const file of files) {
      const path = `${SHARE_API}/${share.share_code}/artifacts/${file.descriptor.artifact_id}`;
      const document = await json<{
        descriptor: object;
        content_base64: string;
      }>(path, 200, memberAuth);
      assert.equal(
        digest(JSON.stringify(document.descriptor)),
        digest(JSON.stringify(file.descriptor)),
      );
      assert.equal(
        digest(Buffer.from(document.content_base64, "base64")),
        file.descriptor.sha256,
      );
      const binary = await request(`${path}/content`, 200, memberAuth);
      assert.equal(
        binary.headers.get("content-type"),
        "application/octet-stream",
      );
      assert.ok(
        binary.headers.get("content-disposition")?.startsWith("attachment;"),
      );
      assert.equal(
        digest(new Uint8Array(await binary.arrayBuffer())),
        file.descriptor.sha256,
      );
    }
  }
  summary.shareCodeSha256 = digest(share.share_code);
  summary.payloadSha256 = input.preparation.payload_sha256;
  summary.artifactSha256 = files.map((file) => file.descriptor.sha256);
  return {
    current,
    open,
    close,
    json,
    request,
    login,
    configure,
    readMember,
    summary,
    owner,
    ownerAuth,
    memberAuth,
    tenantApi,
    files,
    input,
    prepared,
    share,
    previewPath,
    evidence,
  };
}

test("file-backed shares use real HTTP member Cookie authorization across same-process close/reopen and revoke", async (t) => {
  const f = await fixture(t, false);
  const identity = await f.json<{ seat: boolean; kind: string }>(
    "/api/auth/me",
    200,
    f.memberAuth,
  );
  assert.equal(identity.seat, false);
  assert.equal(identity.kind, "session");
  await f.readMember();
  const otherPassword = randomBytes(24).toString("hex");
  const other = await bootstrap(f.current().services.db, {
    name: "Other owned tenant",
    email: "http-other@example.test",
    password: otherPassword,
  });
  const otherAuth = await f.login(
    "http-other@example.test",
    otherPassword,
    other.tenantId,
  );
  const device = await f.json<{ token: string }>(
    "/api/auth/device-tokens",
    201,
    f.ownerAuth,
    "POST",
    { ttlHours: 1 },
  );
  for (const [auth, status] of [
    [{}, 401],
    [otherAuth, 404],
    [{ authorization: `Bearer ${device.token}` }, 403],
  ] as const) {
    const paths = [
      f.previewPath,
      `${SHARE_API}/${f.share.share_code}/artifacts/${f.files[0]!.descriptor.artifact_id}`,
      `${SHARE_API}/${f.share.share_code}/artifacts/${f.files[0]!.descriptor.artifact_id}/content`,
    ];
    for (const path of paths) {
      const response = await f.request(path, status, auth);
      await response.arrayBuffer();
    }
  }
  f.summary.deniedAnonymousOtherDevice = true;
  await f.close();
  await f.open();
  await f.readMember();
  f.summary.sameProcessFileReopenPreserved = true;
  await f.configure("sharing", { publish: "disabled" });
  await f.configure("assistants", { local: false });
  await f.json(
    `${f.tenantApi}/members/${f.owner.userId}`,
    200,
    f.ownerAuth,
    "PATCH",
    { seat: false },
  );
  await f.json(`${f.tenantApi}/subscription`, 200, f.ownerAuth, "PUT", {
    seats: 10,
    credits: 1000000,
    startsAt: Date.now() - 2 * 86400000,
    endsAt: Date.now() - 86400000,
    metering: "calendar",
  });
  const deletion = await f.request(
    `${SHARE_API}/${f.share.share_code}`,
    204,
    f.ownerAuth,
    "DELETE",
  );
  await deletion.arrayBuffer();
  for (const path of [
    f.previewPath,
    ...f.files.flatMap((file) => {
      const base = `${SHARE_API}/${f.share.share_code}/artifacts/${file.descriptor.artifact_id}`;
      return [base, `${base}/content`];
    }),
  ]) {
    const response = await f.request(path, 404, f.memberAuth);
    await response.arrayBuffer();
  }
  assert.equal(
    f.current().services.db.get<{ n: number }>("SELECT count(*) n FROM ledger")!
      .n,
    0,
  );
  assert.equal(
    f
      .current()
      .services.db.get<{ n: number }>("SELECT count(*) n FROM gateway_calls")!
      .n,
    0,
  );
  f.summary.revokedWithPublisherGatesClosed = true;
  f.summary.modelLedgerRows = 0;
  f.summary.completed = true;
});

test(
  "the unchanged worker minute sweep clears SQL-expired sharing bytes and preserves the retry tombstone",
  { timeout: 90000 },
  async (t) => {
    const f = await fixture(t, true);
    const db = f.current().services.db;
    const before = db.get<{ fingerprint: string; hasJson: number }>(
      "SELECT request_fingerprint fingerprint,confirmed_json IS NOT NULL hasJson FROM conversation_shares WHERE id=?",
      f.prepared.preparation_id,
    )!;
    assert.equal(before.hasJson, 1);
    db.run(
      "UPDATE conversation_shares SET expires_at=? WHERE id=?",
      Date.now() - 1,
      f.prepared.preparation_id,
    );
    const denied = await f.request(f.previewPath, 404, f.memberAuth);
    await denied.arrayBuffer();
    f.summary.sqlExpiryControl = true;
    f.summary.immediateHttpDenied = true;
    await writeFile(
      join(f.evidence, "waiting-for-normal-worker.json"),
      JSON.stringify({
        sqlExpiryControl: true,
        productionIntervalUnchanged: true,
        immediateHttpDenied: true,
      }) + "\n",
      { mode: 0o600 },
    );
    const started = Date.now();
    let state: { status: string; cleared: number } | undefined;
    while (Date.now() - started < 75000) {
      state = db.get<{ status: string; cleared: number }>(
        "SELECT status,confirmed_json IS NULL cleared FROM conversation_shares WHERE id=?",
        f.prepared.preparation_id,
      );
      if (state?.status === "expired") break;
      await new Promise<void>((resolve) => setTimeout(resolve, 500));
    }
    assert.equal(state?.status, "expired");
    assert.ok(state);
    assert.equal(state.cleared, 1);
    const after = db.get<{ fingerprint: string; titleBytes: number }>(
      "SELECT request_fingerprint fingerprint,length(CAST(title AS BLOB)) titleBytes FROM conversation_shares WHERE id=?",
      f.prepared.preparation_id,
    )!;
    assert.ok(after.fingerprint === before.fingerprint);
    assert.equal(after.titleBytes, 0);
    assert.equal(
      db.get<{ n: number }>(
        "SELECT count(*) n FROM conversation_share_artifacts WHERE preparation_id=?",
        f.prepared.preparation_id,
      )!.n,
      0,
    );
    const rejectedRetry = await f.request(
      `${SHARE_API}/preparations`,
      410,
      f.ownerAuth,
      "POST",
      f.input.preparation,
    );
    await rejectedRetry.arrayBuffer();
    assert.equal(db.get<{ n: number }>("SELECT count(*) n FROM ledger")!.n, 0);
    assert.equal(
      db.get<{ n: number }>("SELECT count(*) n FROM gateway_calls")!.n,
      0,
    );
    f.summary.normalWorkerSweepObserved = true;
    f.summary.waitForSweepMs = Date.now() - started;
    f.summary.tombstonePreserved = true;
    f.summary.modelLedgerRows = 0;
    f.summary.completed = true;
  },
);
