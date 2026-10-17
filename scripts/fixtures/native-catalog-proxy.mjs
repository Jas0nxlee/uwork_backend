import { createServer } from "node:http";
import { Resolver } from "node:dns/promises";
import { isIP, Socket } from "node:net";
import { Transform } from "node:stream";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import ipaddr from "ipaddr.js";

const HOST = "cdn-zcode.z.ai";
const AUTHORITY = `${HOST}:443`;
const DEFAULTS = Object.freeze({
  maxConnections: 8,
  maxTotalConnections: 128,
  maxEvents: 128,
  headerMs: 5000,
  dnsMs: 5000,
  connectMs: 8000,
  replyFlushMs: 1000,
  idleMs: 15000,
  totalMs: 60000,
  tunnelBytes: 32 * 1024 * 1024,
  totalBytes: 64 * 1024 * 1024,
});
class Failure extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}
function limitsFor(overrides = {}) {
  for (const [key, value] of Object.entries(overrides))
    if (
      !Object.hasOwn(DEFAULTS, key) ||
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > DEFAULTS[key]
    )
      throw new Error("invalid_test_limit");
  return { ...DEFAULTS, ...overrides };
}
function numerical(address) {
  if (typeof address !== "string" || address.includes("%") || !isIP(address))
    throw new Failure("dns-not-public");
  return ipaddr.process(address).toString();
}
function validatedAddresses(records) {
  if (!Array.isArray(records) || records.length === 0 || records.length > 16)
    throw new Failure("dns-not-public");
  for (const row of records) {
    const address = numerical(row?.address);
    if (
      isIP(row.address) !== row.family ||
      ipaddr.parse(address).range() !== "unicast"
    )
      throw new Failure("dns-not-public");
  }
  return records;
}
async function resolveAll(host, { signal }) {
  const resolver = new Resolver({ timeout: DEFAULTS.dnsMs, tries: 1 });
  const cancel = () => resolver.cancel();
  signal.throwIfAborted();
  signal.addEventListener("abort", cancel, { once: true });
  try {
    const one = async (method, family) => {
      try {
        return (await resolver[method](host)).map((address) => ({
          address,
          family,
        }));
      } catch (error) {
        if (["ENODATA", "ENOTFOUND"].includes(error.code)) return [];
        throw error;
      }
    };
    const answers = await Promise.allSettled([
      one("resolve4", 4),
      one("resolve6", 6),
    ]);
    const failed = answers.find((answer) => answer.status === "rejected");
    if (failed) throw failed.reason;
    return answers.flatMap((answer) => answer.value);
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}
function connectPinned(address, family) {
  const socket = new Socket({ allowHalfOpen: false });
  const connected = new Promise((done, reject) => {
    socket.once("error", reject);
    socket.once("close", () => reject(new Failure("connect-closed")));
    socket.once("connect", () =>
      done({ address: socket.remoteAddress, port: socket.remotePort }),
    );
  });
  socket.connect({ host: address, port: 443, family, autoSelectFamily: false });
  return { socket, connected };
}
function within(work, signal, milliseconds, reason) {
  return new Promise((done, reject) => {
    let settled = false;
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      callback(value);
    };
    const abort = () => settle(reject, signal.reason);
    const timer = setTimeout(
      () => settle(reject, new Failure(reason)),
      milliseconds,
    );
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    // Consume even an uncooperative test port's late rejection, without late admission.
    Promise.resolve()
      .then(() => {
        signal.throwIfAborted();
        return work();
      })
      .then(
        (value) => settle(done, value),
        (error) => settle(reject, error),
      );
  });
}

/** One allowlisted CONNECT test proxy; never a product transport or configurable forward proxy. */
export async function startNativeCatalogProxy({
  testPorts,
  limits: overrides,
} = {}) {
  if (
    testPorts &&
    (typeof testPorts.resolveAll !== "function" ||
      typeof testPorts.connect !== "function")
  )
    throw new Error("both_test_ports_required");
  const limits = limitsFor(overrides);
  const ports = testPorts ?? { resolveAll, connect: connectPinned };
  const states = new Map(),
    resources = new Map(),
    tasks = new Set(),
    resolverTasks = new Set(),
    replyTimers = new Set(),
    events = [];
  const counts = {
    connections: 0,
    allowedTargets: 0,
    dns: 0,
    dials: 0,
    tunnels: 0,
    clientBytes: 0,
    upstreamBytes: 0,
    droppedEvents: 0,
    droppedConnections: 0,
    deniedCompanyCatalog: 0,
    deniedUnknown: 0,
  };
  let retiring = false,
    acceptClosed,
    closing;
  const server = createServer({ maxHeaderSize: 4096 });
  server.maxConnections = limits.maxConnections;
  server.on("drop", () => counts.droppedConnections++);
  server.headersTimeout = limits.headerMs;
  server.requestTimeout = limits.headerMs;
  server.keepAliveTimeout = 1;
  const stopAccepting = () =>
    (acceptClosed ??= new Promise((done) => server.close(() => done())));
  function track(resource, state, client = false) {
    if (resource.closed) return resource;
    const closed = new Promise((done) => {
      resource.once("close", () => {
        resources.delete(resource);
        if (client) {
          states.delete(resource);
          // 回复 flush 仍拥有 client：只能由该 client 的真实 close 退休，不能被上游 close 提前清除。
          clearTimeout(state.replyTimer);
          replyTimers.delete(state.replyTimer);
        }
        done();
        finish(state, client ? "client-closed" : "upstream-closed");
      });
    });
    resources.set(resource, closed);
    resource.on("error", () =>
      finish(state, client ? "client-error" : "upstream-error"),
    );
    return resource;
  }
  function finish(state, reason, status) {
    if (!state || state.finished) return;
    state.finished = true;
    state.controller.abort(new Failure(reason));
    clearTimeout(state.timer);
    for (const stream of state.streams) stream.destroy();
    state.upstream?.destroy();
    const event = {
      id: state.id,
      startedAt: state.startedAt,
      endedAt: Date.now(),
      ...(state.allowed ? { target: AUTHORITY } : {}),
      ...(state.targetClass ? { targetClass: state.targetClass } : {}),
      tupleVerified: state.tupleVerified,
      clientBytes: state.clientBytes,
      upstreamBytes: state.upstreamBytes,
      result: reason,
    };
    if (events.length < limits.maxEvents) events.push(event);
    else counts.droppedEvents++;
    if (status && !state.client.destroyed && state.client.writable) {
      // end callback 不保证到达；失败已记录后仍必须给回复阶段一个独立回收期限。
      state.replyTimer = setTimeout(
        () => state.client.destroy(),
        limits.replyFlushMs,
      );
      replyTimers.add(state.replyTimer);
      try {
        state.client.end(
          `HTTP/1.1 ${status} Denied\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
          () => state.client.destroy(),
        );
      } catch {
        state.client.destroy();
      }
    } else state.client.destroy();
  }
  server.on("connection", (client) => {
    const state = {
      client,
      id: ++counts.connections,
      startedAt: Date.now(),
      controller: new AbortController(),
      streams: [],
      clientBytes: 0,
      upstreamBytes: 0,
      tupleVerified: false,
      finished: false,
      allowed: false,
    };
    states.set(client, state);
    track(client, state, true);
    // HTTP CONNECT 的 socket 允许半关闭；尚在 DNS/拨号时 end 就是取消，不能等到迟到 DNS 后再出站。
    client.once("end", () => {
      if (!state.tupleVerified) finish(state, "client-closed");
    });
    if (
      retiring ||
      counts.connections > limits.maxTotalConnections ||
      states.size > limits.maxConnections
    )
      return finish(state, "connection-limit", 503);
    state.headerTimeout = () => finish(state, "header-timeout");
    client.setTimeout(limits.headerMs, state.headerTimeout);
    state.timer = setTimeout(
      () => finish(state, "lifetime-limit"),
      limits.totalMs,
    );
    if (counts.connections === limits.maxTotalConnections) void stopAccepting();
  });
  server.on("request", (request) =>
    finish(states.get(request.socket), "http-denied", 403),
  );
  server.on("upgrade", (request) =>
    finish(states.get(request.socket), "upgrade-denied", 403),
  );
  server.on("clientError", (_error, client) =>
    finish(states.get(client), "bad-http", 400),
  );
  function charge(state, chunk, direction) {
    if (state.finished) return false;
    const total = counts.clientBytes + counts.upstreamBytes;
    if (
      state.clientBytes + state.upstreamBytes + chunk.length >
        limits.tunnelBytes ||
      total + chunk.length > limits.totalBytes
    ) {
      finish(state, "byte-limit");
      return false;
    }
    state[direction] += chunk.length;
    counts[direction] += chunk.length;
    return true;
  }
  server.on("connect", (request, client, head) => {
    const state = states.get(client);
    if (!state || state.finished) return;
    if (request.url !== AUTHORITY) {
      state.targetClass =
        request.url === "aihub.ucas.com.cn:443" ? "company-catalog" : "unknown";
      if (state.targetClass === "company-catalog")
        counts.deniedCompanyCatalog++;
      else counts.deniedUnknown++;
      return finish(state, "authority-denied", 403);
    }
    state.allowed = true;
    counts.allowedTargets++;
    client.off("timeout", state.headerTimeout);
    client.setTimeout(0);
    const task = (async () => {
      try {
        counts.dns++;
        const records = await within(
          () => {
            const resolution = Promise.resolve(
              ports.resolveAll(HOST, { signal: state.controller.signal }),
            );
            if (!testPorts) {
              resolverTasks.add(resolution);
              void resolution
                .finally(() => resolverTasks.delete(resolution))
                .catch(() => {});
            }
            return resolution;
          },
          state.controller.signal,
          limits.dnsMs,
          "dns-timeout",
        ).catch((error) => {
          throw error instanceof Failure ? error : new Failure("dns-failed");
        });
        const [pinned] = validatedAddresses(records);
        if (state.finished || retiring) return;
        counts.dials++;
        const transport = ports.connect(pinned.address, pinned.family);
        state.upstream = track(transport.socket, state);
        const peer = await within(
          () => transport.connected,
          state.controller.signal,
          limits.connectMs,
          "connect-timeout",
        ).catch((error) => {
          throw error instanceof Failure
            ? error
            : new Failure("connect-failed");
        });
        if (state.finished || retiring) return;
        if (
          numerical(peer.address) !== numerical(pinned.address) ||
          peer.port !== 443
        )
          throw new Failure("tuple-mismatch");
        state.tupleVerified = true;
        counts.tunnels++;
        if (!charge(state, head, "clientBytes")) return;
        client.setTimeout(limits.idleMs, () => finish(state, "idle-timeout"));
        state.upstream.setTimeout?.(limits.idleMs, () =>
          finish(state, "idle-timeout"),
        );
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) state.upstream.write(head);
        const counter = (direction) => {
          const stream = new Transform({
            transform(chunk, _encoding, done) {
              done(null, charge(state, chunk, direction) ? chunk : undefined);
            },
          });
          state.streams.push(stream);
          return track(stream, state);
        };
        client.pipe(counter("clientBytes")).pipe(state.upstream);
        state.upstream.pipe(counter("upstreamBytes")).pipe(client);
      } catch (error) {
        finish(
          state,
          error instanceof Failure ? error.reason : "connect-failed",
          502,
        );
      }
    })();
    tasks.add(task);
    void task.finally(() => tasks.delete(task));
  });
  await new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", done);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const snapshot = () =>
    structuredClone({
      origin,
      testPortsUsed: !!testPorts,
      limits,
      retiring,
      accepting: server.listening,
      activeConnections: states.size,
      activeResources: resources.size,
      pendingTasks: tasks.size,
      pendingResolverCallbacks: resolverTasks.size,
      pendingReplyTimers: replyTimers.size,
      counts,
      events,
    });
  return {
    origin,
    snapshot,
    close() {
      return (closing ??= (async () => {
        retiring = true;
        const stopped = stopAccepting();
        for (const state of states.values()) finish(state, "closed");
        for (const resource of resources.keys()) resource.destroy();
        await Promise.allSettled([...tasks]);
        await Promise.allSettled([...resolverTasks]);
        await Promise.all([...resources.values()]);
        await stopped;
        return snapshot();
      })());
    },
  };
}

async function runCli() {
  if (process.argv.length !== 3 || !isAbsolute(process.argv[2]))
    throw new Error("new_owned_evidence_directory_required");
  const base = await realpath(resolve(import.meta.dirname, "../../evidence"));
  const destination = resolve(process.argv[2]),
    parent = await realpath(dirname(destination));
  const below = relative(base, parent);
  if (
    below === ".." ||
    below.startsWith(`..${sep}`) ||
    isAbsolute(below) ||
    destination === base
  )
    throw new Error("evidence_directory_outside_owned_root");
  await mkdir(destination, { mode: 0o700 });
  const proxy = await startNativeCatalogProxy();
  const output = (value) => process.stdout.write(JSON.stringify(value) + "\n");
  let buffered = "",
    commands = 0,
    finished,
    data,
    end;
  let writes = Promise.resolve();
  let finish;
  try {
    await writeFile(
      resolve(destination, "runtime.json"),
      JSON.stringify(
        { pid: process.pid, startedAt: Date.now(), ...proxy.snapshot() },
        null,
        2,
      ),
      { mode: 0o600, flag: "wx" },
    );
    output({ status: "ready", origin: proxy.origin, testPortsUsed: false });
    await new Promise((done, reject) => {
      finish = () => {
        if (!finished) {
          finished = (async () => {
            process.stdin.pause();
            process.stdin.off("data", data);
            const snapshot = await proxy.close();
            await writes;
            await writeFile(
              resolve(destination, "final.json"),
              JSON.stringify(snapshot, null, 2),
              { mode: 0o600, flag: "wx" },
            );
            output({ status: "closed", ...snapshot });
          })();
          void finished.then(done, reject);
        }
      };
      data = (chunk) => {
        buffered += chunk.toString("utf8");
        if (Buffer.byteLength(buffered) > 256) {
          process.exitCode = 1;
          finish();
          return;
        }
        while (buffered.includes("\n")) {
          const newline = buffered.indexOf("\n"),
            command = buffered.slice(0, newline).trim();
          buffered = buffered.slice(newline + 1);
          if (command === "close") {
            finish();
            return;
          }
          if (command !== "snapshot" || ++commands > 64) {
            process.exitCode = 1;
            finish();
            return;
          }
          const snapshot = proxy.snapshot();
          output(snapshot);
          // Serialize bounded owned writes, including drain before final acknowledgement.
          writes = writes.then(() =>
            writeFile(
              resolve(destination, "snapshot.json"),
              JSON.stringify(snapshot, null, 2),
              { mode: 0o600 },
            ),
          );
          void writes.catch(() => {
            process.exitCode = 1;
            finish();
          });
        }
      };
      end = () => {
        if (buffered.trim()) process.exitCode = 1;
        finish();
      };
      process.stdin.on("data", data);
      process.stdin.once("end", end);
      process.once("SIGTERM", finish);
      process.once("SIGINT", finish);
    });
  } finally {
    await proxy.close();
    if (data) process.stdin.off("data", data);
    if (end) process.stdin.off("end", end);
    if (finish) {
      process.off("SIGTERM", finish);
      process.off("SIGINT", finish);
    }
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await runCli().catch(() => {
    process.stderr.write("catalog_proxy_failed\n");
    process.exitCode = 1;
  });
