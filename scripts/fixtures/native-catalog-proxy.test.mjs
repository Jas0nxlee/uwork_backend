import assert from "node:assert/strict";
import { test } from "node:test";
import { createConnection, Socket } from "node:net";
import { Transform } from "node:stream";
import { spawn } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { startNativeCatalogProxy } from "./native-catalog-proxy.mjs";

const TARGET = "cdn-zcode.z.ai:443";
const PUBLIC = [{ address: "8.8.8.8", family: 4 }];
function fixturePorts(records = PUBLIC) {
  const calls = { dns: [], dial: [] };
  return {
    calls,
    ports: {
      async resolveAll(host) {
        calls.dns.push(host);
        return records;
      },
      connect(address, family) {
        calls.dial.push({ address, family });
        // Explicit synthetic transport: opaque byte echo, NOT a public TCP/TLS proof.
        const socket = new Transform({
          transform(chunk, _encoding, done) {
            done(null, chunk);
          },
        });
        return { socket, connected: Promise.resolve({ address, port: 443 }) };
      },
    },
  };
}
async function open(origin, request, head = Buffer.alloc(0)) {
  const socket = createConnection(Number(new URL(origin).port), "127.0.0.1");
  socket.on("error", () => {});
  socket.setTimeout(1500, () => socket.destroy());
  const response = new Promise((resolve, reject) => {
    let data = Buffer.alloc(0);
    const onData = (chunk) => {
      data = Buffer.concat([data, chunk]);
      const split = data.indexOf("\r\n\r\n");
      if (split < 0) return;
      socket.off("data", onData);
      resolve({
        header: data.subarray(0, split).toString(),
        rest: data.subarray(split + 4),
      });
    };
    socket.on("data", onData);
    socket.once("close", () => reject(Error("closed before HTTP response")));
    socket.once("error", reject);
  });
  void response.catch(() => {});
  socket.once("connect", () =>
    socket.write(Buffer.concat([Buffer.from(request), head])),
  );
  return { socket, response };
}
async function connect(origin, authority = TARGET, head) {
  return open(
    origin,
    `CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`,
    head,
  );
}
async function until(check) {
  for (let index = 0; index < 100; index++) {
    if (check()) return;
    await delay(5);
  }
  assert.ok(check(), "bounded asynchronous condition");
}

test("only the canonical catalog CONNECT reaches a numeric pinned synthetic tunnel", async (t) => {
  const f = fixturePorts();
  const proxy = await startNativeCatalogProxy({ testPorts: f.ports });
  t.after(() => proxy.close());
  const initial = Buffer.from([0x16, 0x03, 0x03, 0, 1, 0xab]);
  const { socket, response } = await connect(proxy.origin, TARGET, initial);
  t.after(() => socket.destroy());
  const result = await response;
  assert.match(
    result.header,
    /^HTTP\/1.1 200 /,
    "canonical public CONNECT must enter the opaque tunnel",
  );
  assert.deepEqual(f.calls.dns, ["cdn-zcode.z.ai"]);
  assert.deepEqual(f.calls.dial, PUBLIC);
  let received = result.rest;
  socket.on("data", (chunk) => {
    received = Buffer.concat([received, chunk]);
  });
  const more = Buffer.from([0xff, 0, 0x81]);
  socket.write(more);
  await until(() => received.length >= initial.length + more.length);
  assert.deepEqual(received, Buffer.concat([initial, more]));
  assert.equal(proxy.snapshot().testPortsUsed, true);
  assert.equal(proxy.snapshot().counts.tunnels, 1);
});

test("noncanonical, AIHub and malicious authorities fail before DNS/dial and never enter evidence", async (t) => {
  const f = fixturePorts();
  const proxy = await startNativeCatalogProxy({ testPorts: f.ports });
  t.after(() => proxy.close());
  for (const value of [
    "aihub.ucas.com.cn:443",
    "unknown.example:443",
    "CDN-zcode.z.ai:443",
    "cdn-zcode.z.ai.:443",
    "cdn-zcode.z.ai:80",
    "cdn-zcode.z.ai",
    "cdn-zcode.z.ai:0443",
    "cdn-zcode.z.ai:443?query-secret-marker",
    "user:password@cdn-zcode.z.ai:443",
    "https://cdn-zcode.z.ai:443/",
  ]) {
    const { socket, response } = await connect(proxy.origin, value);
    assert.match((await response).header, /^HTTP\/1.1 403 /);
    socket.destroy();
  }
  assert.equal(f.calls.dns.length, 0);
  assert.equal(f.calls.dial.length, 0);
  assert.doesNotMatch(
    JSON.stringify(proxy.snapshot()),
    /query-secret-marker|password|unknown\.example|aihub/,
  );
});

test("ordinary HTTP and Upgrade are rejected without upstream work", async (t) => {
  const f = fixturePorts();
  const proxy = await startNativeCatalogProxy({ testPorts: f.ports });
  t.after(() => proxy.close());
  for (const request of [
    "GET http://cdn-zcode.z.ai/private?query-secret-marker HTTP/1.1\r\nHost: cdn-zcode.z.ai\r\nAuthorization: private-value\r\n\r\n",
    "GET / HTTP/1.1\r\nHost: cdn-zcode.z.ai\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
  ]) {
    const { socket, response } = await open(proxy.origin, request);
    assert.match((await response).header, /^HTTP\/1.1 403 /);
    socket.destroy();
  }
  assert.equal(f.calls.dns.length, 0);
  assert.equal(f.calls.dial.length, 0);
  assert.doesNotMatch(
    JSON.stringify(proxy.snapshot()),
    /query-secret-marker|private-value|Authorization/,
  );
});

test("fixed company-catalog rejection is distinguishable from unknown without logging either authority", async () => {
  const f = fixturePorts(),
    proxy = await startNativeCatalogProxy({ testPorts: f.ports });
  try {
    for (const target of [
      "aihub.ucas.com.cn:443",
      "unknown.invalid:443?query-secret-marker",
    ]) {
      const pending = await connect(proxy.origin, target);
      assert.match((await pending.response).header, /^HTTP\/1.1 403 /);
      pending.socket.destroy();
    }
    const snapshot = proxy.snapshot();
    assert.deepEqual(
      snapshot.events.map((event) => event.targetClass),
      ["company-catalog", "unknown"],
    );
    assert.equal(snapshot.counts.deniedCompanyCatalog, 1);
    assert.equal(snapshot.counts.deniedUnknown, 1);
    assert.equal(f.calls.dns.length, 0);
    assert.equal(f.calls.dial.length, 0);
    assert.doesNotMatch(
      JSON.stringify(snapshot),
      /aihub\.ucas|unknown\.invalid|query-secret-marker/,
    );
  } finally {
    await proxy.close();
  }
});

test("all DNS answers must be public, numerical and family-consistent", async () => {
  for (const records of [
    [],
    [{ address: "127.0.0.1", family: 4 }],
    [{ address: "10.0.0.1", family: 4 }],
    [{ address: "169.254.1.1", family: 4 }],
    [{ address: "100.64.0.1", family: 4 }],
    [{ address: "192.0.2.1", family: 4 }],
    [{ address: "::1", family: 6 }],
    [{ address: "fc00::1", family: 6 }],
    [{ address: "::ffff:127.0.0.1", family: 6 }],
    [{ address: "::ffff:10.0.0.1", family: 6 }],
    [...PUBLIC, { address: "::ffff:192.168.1.1", family: 6 }],
    [...PUBLIC, { address: "fe80::1", family: 6 }],
    [{ address: "8.8.8.8", family: 6 }],
    [{ address: "0x08080808", family: 4 }],
    [{ address: "2001:4860:4860::8888%lo0", family: 6 }],
    Array.from({ length: 17 }, () => PUBLIC[0]),
  ]) {
    const f = fixturePorts(records);
    const proxy = await startNativeCatalogProxy({ testPorts: f.ports });
    try {
      const { socket, response } = await connect(proxy.origin);
      assert.match((await response).header, /^HTTP\/1.1 502 /);
      socket.destroy();
      assert.equal(f.calls.dial.length, 0);
    } finally {
      await proxy.close();
    }
  }
});

test("IPv6 public and IPv4-mapped public pins retain one numeric address without a second DNS lookup", async () => {
  for (const records of [
    [{ address: "2001:4860:4860::8888", family: 6 }, ...PUBLIC],
    [{ address: "::ffff:8.8.8.8", family: 6 }],
  ]) {
    const f = fixturePorts(records),
      proxy = await startNativeCatalogProxy({ testPorts: f.ports });
    try {
      const { socket, response } = await connect(proxy.origin);
      assert.match((await response).header, /^HTTP\/1.1 200 /);
      socket.destroy();
      assert.deepEqual(f.calls.dial, [records[0]]);
      assert.equal(f.calls.dns.length, 1);
    } finally {
      await proxy.close();
    }
  }
});

test("the pinned remote tuple must match both numerical IP and port before 200", async () => {
  for (const peer of [
    { address: "1.1.1.1", port: 443 },
    { address: "8.8.8.8", port: 80 },
    { address: "127.0.0.1", port: 443 },
  ]) {
    const f = fixturePorts(),
      original = f.ports.connect;
    f.ports.connect = (...args) => ({
      ...original(...args),
      connected: Promise.resolve(peer),
    });
    const proxy = await startNativeCatalogProxy({ testPorts: f.ports });
    try {
      const { socket, response } = await connect(proxy.origin);
      assert.match((await response).header, /^HTTP\/1.1 502 /);
      socket.destroy();
      assert.equal(proxy.snapshot().counts.tunnels, 0);
      assert.equal(proxy.snapshot().events[0].result, "tuple-mismatch");
    } finally {
      await proxy.close();
    }
  }
});

test("DNS failure and timeout are bounded and redact raw error text", async () => {
  for (const stalls of [false, true]) {
    const f = fixturePorts();
    f.ports.resolveAll = () =>
      stalls
        ? new Promise(() => {})
        : Promise.reject(Error("query-secret-marker"));
    const proxy = await startNativeCatalogProxy({
      testPorts: f.ports,
      limits: { dnsMs: 15 },
    });
    try {
      const { socket, response } = await connect(proxy.origin);
      assert.match((await response).header, /^HTTP\/1.1 502 /);
      socket.destroy();
      assert.equal(f.calls.dial.length, 0);
      assert.doesNotMatch(
        JSON.stringify(proxy.snapshot()),
        /query-secret-marker/,
      );
      assert.equal(
        proxy.snapshot().events[0].result,
        stalls ? "dns-timeout" : "dns-failed",
      );
    } finally {
      const final = await proxy.close();
      assert.equal(final.pendingTasks, 0);
      assert.equal(final.activeResources, 0);
    }
  }
});

test("connect rejection and timeout destroy the already tracked pending upstream", async () => {
  for (const stalls of [false, true]) {
    const f = fixturePorts(),
      original = f.ports.connect;
    let upstream;
    f.ports.connect = (...args) => {
      const transport = original(...args);
      upstream = transport.socket;
      return {
        ...transport,
        connected: stalls
          ? new Promise(() => {})
          : Promise.reject(Error("private-upstream-error")),
      };
    };
    const proxy = await startNativeCatalogProxy({
      testPorts: f.ports,
      limits: { connectMs: 15 },
    });
    try {
      const { socket, response } = await connect(proxy.origin);
      assert.match((await response).header, /^HTTP\/1.1 502 /);
      socket.destroy();
      assert.equal(upstream.destroyed, true);
      assert.doesNotMatch(
        JSON.stringify(proxy.snapshot()),
        /private-upstream-error/,
      );
    } finally {
      assert.equal((await proxy.close()).activeResources, 0);
    }
  }
});

test("close during DNS consumes late success/rejection without dialing and is idempotent", async () => {
  for (const rejected of [false, true]) {
    const f = fixturePorts();
    let release, reject;
    f.ports.resolveAll = () => {
      f.calls.dns.push("held");
      return new Promise((yes, no) => {
        release = yes;
        reject = no;
      });
    };
    const proxy = await startNativeCatalogProxy({ testPorts: f.ports });
    const { socket, response } = await connect(proxy.origin);
    await until(() => f.calls.dns.length === 1);
    const closing = proxy.close();
    assert.equal(proxy.close(), closing);
    const final = await closing;
    if (rejected) reject(Error("late-private-error"));
    else release(PUBLIC);
    await delay(5);
    assert.equal(f.calls.dial.length, 0);
    assert.equal(final.pendingTasks, 0);
    assert.equal(final.activeResources, 0);
    await assert.rejects(response);
    socket.destroy();
  }
});

test("close drains pending dial and active opaque piping; late tuples cannot reopen", async () => {
  for (const held of [false, true]) {
    const f = fixturePorts(),
      original = f.ports.connect;
    let release, upstream;
    f.ports.connect = (...args) => {
      const transport = original(...args);
      upstream = transport.socket;
      return {
        ...transport,
        connected: held
          ? new Promise((done) => {
              release = done;
            })
          : transport.connected,
      };
    };
    const proxy = await startNativeCatalogProxy({ testPorts: f.ports });
    const { socket, response } = await connect(proxy.origin);
    if (held) await until(() => f.calls.dial.length === 1);
    else assert.match((await response).header, /^HTTP\/1.1 200 /);
    const before = proxy.snapshot().counts.tunnels,
      final = await proxy.close();
    if (held) release({ address: "8.8.8.8", port: 443 });
    await delay(5);
    assert.equal(upstream.destroyed, true);
    assert.equal(final.activeResources, 0);
    assert.equal(final.activeConnections, 0);
    assert.equal(proxy.snapshot().counts.tunnels, before);
    if (held) await assert.rejects(response);
    socket.destroy();
  }
});

test("headers, idle and total lifetime timeouts bound otherwise idle sockets", async () => {
  for (const phase of ["header", "idle", "lifetime"]) {
    const f = fixturePorts(),
      limits =
        phase === "header"
          ? { headerMs: 15 }
          : phase === "idle"
            ? { idleMs: 15 }
            : { totalMs: 15 };
    const proxy = await startNativeCatalogProxy({ testPorts: f.ports, limits });
    try {
      const { socket, response } =
        phase === "header"
          ? await open(proxy.origin, "CONNE")
          : await connect(proxy.origin);
      if (phase !== "header") await response;
      await until(() => proxy.snapshot().events.length === 1);
      assert.equal(
        proxy.snapshot().events[0].result,
        phase === "lifetime" ? "lifetime-limit" : phase + "-timeout",
      );
      socket.destroy();
      if (phase === "header") assert.equal(f.calls.dns.length, 0);
    } finally {
      assert.equal((await proxy.close()).activeResources, 0);
    }
  }
});

test("connection/event caps and byte budgets remain bounded", async () => {
  const f = fixturePorts(),
    proxy = await startNativeCatalogProxy({
      testPorts: f.ports,
      limits: { maxTotalConnections: 3, maxEvents: 1 },
    });
  try {
    for (let index = 0; index < 3; index++) {
      const { socket, response } = await connect(
        proxy.origin,
        "not-allowed:443",
      );
      await response;
      socket.destroy();
    }
    const snap = proxy.snapshot();
    assert.equal(snap.counts.connections, 3);
    assert.equal(snap.events.length, 1);
    assert.equal(snap.counts.droppedEvents, 2);
    assert.equal(snap.accepting, false);
    assert.equal(f.calls.dns.length, 0);
  } finally {
    await proxy.close();
  }
  for (const limits of [{ tunnelBytes: 5 }, { totalBytes: 5 }]) {
    const local = fixturePorts(),
      budget = await startNativeCatalogProxy({
        testPorts: local.ports,
        limits,
      });
    try {
      const { socket, response } = await connect(
        budget.origin,
        TARGET,
        Buffer.from("ab"),
      );
      await response;
      await until(() => budget.snapshot().counts.upstreamBytes === 2);
      socket.write("cd");
      await until(() => budget.snapshot().events.length === 1);
      const snap = budget.snapshot();
      assert.equal(snap.events[0].result, "byte-limit");
      assert.equal(snap.counts.clientBytes + snap.counts.upstreamBytes, 4);
      socket.destroy();
    } finally {
      await budget.close();
    }
  }
});

test("incomplete test ports and unknown/raised limits fail before listen", async () => {
  await assert.rejects(
    startNativeCatalogProxy({ testPorts: { resolveAll: async () => PUBLIC } }),
    /both_test_ports_required/,
  );
  await assert.rejects(
    startNativeCatalogProxy({ limits: { dnsMs: 5001 } }),
    /invalid_test_limit/,
  );
  await assert.rejects(
    startNativeCatalogProxy({ limits: { target: "other" } }),
    /invalid_test_limit/,
  );
  await assert.rejects(
    startNativeCatalogProxy({ limits: { toString: 1 } }),
    /invalid_test_limit/,
  );
});

test("concurrent connection cap refuses excess sockets before DNS", async () => {
  const f = fixturePorts();
  f.ports.resolveAll = () => {
    f.calls.dns.push("held");
    return new Promise(() => {});
  };
  const proxy = await startNativeCatalogProxy({
    testPorts: f.ports,
    limits: { maxConnections: 1 },
  });
  const first = await connect(proxy.origin);
  try {
    await until(() => f.calls.dns.length === 1);
    const second = await connect(proxy.origin);
    await assert.rejects(second.response);
    second.socket.destroy();
    assert.equal(proxy.snapshot().counts.connections, 1);
    assert.equal(proxy.snapshot().counts.droppedConnections, 1);
    assert.equal(proxy.snapshot().activeResources, 1);
    assert.equal(f.calls.dns.length, 1);
    assert.equal(f.calls.dial.length, 0);
  } finally {
    assert.equal((await proxy.close()).activeResources, 0);
    first.socket.destroy();
  }
});

test("client disconnect retires a pending DNS read before its late success", async () => {
  const f = fixturePorts();
  let release;
  f.ports.resolveAll = () => {
    f.calls.dns.push("held");
    return new Promise((done) => {
      release = done;
    });
  };
  const proxy = await startNativeCatalogProxy({ testPorts: f.ports });
  try {
    const pending = await connect(proxy.origin);
    await until(() => f.calls.dns.length === 1);
    pending.socket.destroy();
    await until(() => proxy.snapshot().activeConnections === 0);
    release(PUBLIC);
    await delay(5);
    assert.equal(f.calls.dial.length, 0);
  } finally {
    assert.equal((await proxy.close()).pendingTasks, 0);
  }
});

test("a stalled denial response flush has its own deadline until the actual client closes", async () => {
  for (const mode of ["403", "502", "close"]) {
    const f = fixturePorts();
    if (mode === "502") {
      const originalConnect = f.ports.connect;
      f.ports.connect = (...args) => ({
        ...originalConnect(...args),
        connected: Promise.resolve({ address: "8.8.8.8", port: 80 }),
      });
    }
    const proxy = await startNativeCatalogProxy({
      testPorts: f.ports,
      limits: { headerMs: 10, totalMs: 25 },
    });
    const ownPort = Number(new URL(proxy.origin).port);
    const originalEnd = Socket.prototype.end;
    let blocked = 0,
      pending;
    Socket.prototype.end = function (...args) {
      // Only this test's owned server socket and its HTTP denial: no other port/stdio is altered.
      if (
        this.localPort === ownPort &&
        String(args[0]).startsWith("HTTP/1.1")
      ) {
        blocked++;
        return this;
      }
      return originalEnd.apply(this, args);
    };
    try {
      pending = await connect(
        proxy.origin,
        mode === "502" ? TARGET : "denied.invalid:443",
      );
      await until(() => blocked === 1);
      if (mode === "close") await proxy.close();
      else await delay(1100);
      assert.equal(
        proxy.snapshot().activeConnections,
        0,
        mode +
          ": end callback never runs; denial socket must still be forcibly reclaimed",
      );
      assert.equal(proxy.snapshot().activeResources, 0);
      assert.equal(
        proxy.snapshot().pendingReplyTimers,
        0,
        "only real client close clears the flush deadline",
      );
    } finally {
      Socket.prototype.end = originalEnd;
      pending?.socket.destroy();
      await proxy.close();
    }
  }
});

test("finite CLI only uses defaults, drains snapshot/close and EOF, and leaves only own evidence", async () => {
  const parent = await mkdtemp(
    resolve("evidence/client-store-catalog-proxy-20261018/cli-"),
  );
  for (const mode of ["close", "eof", "invalid"]) {
    const directory = resolve(parent, mode);
    const child = spawn(
      process.execPath,
      ["scripts/fixtures/native-catalog-proxy.mjs", directory],
      {
        cwd: process.cwd(),
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          NATIVE_CATALOG_PROXY_TARGET: "other.invalid:443",
        },
      },
    );
    let output = "",
      errors = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      errors += chunk;
    });
    const exit = new Promise((done, reject) => {
      child.once("error", reject);
      child.once("exit", done);
    });
    try {
      await until(() => output.includes('"status":"ready"'));
      const ready = JSON.parse(output.split("\n")[0]);
      assert.equal(ready.testPortsUsed, false);
      const { socket, response } = await connect(
        ready.origin,
        "unknown.invalid:443",
      );
      assert.match((await response).header, /^HTTP\/1.1 403 /);
      socket.destroy();
      child.stdin.end(
        mode === "close"
          ? "snapshot\nclose\n"
          : mode === "invalid"
            ? '{"op":"open","target":"evil"}\n'
            : "",
      );
      assert.equal(await exit, mode === "invalid" ? 1 : 0, errors);
      const final = JSON.parse(
        await readFile(resolve(directory, "final.json"), "utf8"),
      );
      assert.equal(final.counts.dns, 0);
      assert.equal(final.counts.dials, 0);
      assert.equal(final.activeResources, 0);
      assert.equal(final.pendingTasks, 0);
      assert.equal(final.accepting, false);
      const refused = await open(
        ready.origin,
        "GET / HTTP/1.1\r\nHost: localhost\r\n\r\n",
      );
      await assert.rejects(refused.response);
      refused.socket.destroy();
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.stdin.end("close\n");
        await exit;
      }
    }
  }
});
