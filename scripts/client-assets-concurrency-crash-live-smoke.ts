import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createHash, randomBytes } from "node:crypto";
import { request as httpRequest } from "node:http";
import { createServer } from "node:https";
import { getCACertificates, setDefaultCACertificates } from "node:tls";
import { execFile, execFileSync, spawn } from "node:child_process";
import { promisify } from "node:util";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createConnection } from "node:net";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/identity.js";

type Row = Record<string, unknown>;
type Reference = {
  key: string;
  directory: string;
  asset: { id: string; version: number; checksum: string; kind: string };
};
type Report = {
  id?: number;
  ready?: boolean;
  staged?: string;
  hostPid?: number;
  cliPid?: number;
  hostNode?: string;
  rejected?: boolean;
  harnessError?: string;
  decision?: { allowed: boolean; code: string };
  catalog?: { skills: { name: string }[] };
  hostCatalog?: { status: string; code?: string; assets: Reference[] };
  stats?: {
    catalogRequests: number;
    admissionRequests: number;
    secretLeak: boolean;
    cacheEvents: Row[];
    admissions: { allowed: boolean; code: string }[];
  };
};
const clientNode =
  "/Users/ljp/.cache/uwork-client-toolchain/node-v24.14.0-darwin-arm64/bin/node";
const evidence = resolve("evidence/client-assets-concurrency-crash-20261017");
const deferred = <T = void>() => {
  let done!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    done = resolve;
  });
  return { promise, resolve: done };
};
async function bounded<T>(work: Promise<T>, ms = 20000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(new Error("owned concurrency/crash operation timed out")),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
function groupAlive(pid: number) {
  // macOS 对已消失的组可能返回 EPERM；只读 OS 进程表确认成员，不能把它当存活。
  return execFileSync("/bin/ps", ["-axo", "pgid="], { encoding: "utf8" })
    .trim()
    .split(/\s+/)
    .some((group) => Number(group) === pid);
}
async function fixture(t: TestContext, label: string) {
  const temporary = await realpath(
    await mkdtemp(join(tmpdir(), "uwork-cache-concurrency-")),
  );
  await mkdir(evidence, { recursive: true, mode: 0o700 });
  const cleanup: (() => Promise<void> | void)[] = [];
  const observations: Row[] = [],
    secrets: string[] = [],
    ports: number[] = [],
    pids: number[] = [];
  const traffic: { method: string; route: string; status: number }[] = [];
  t.after(async () => {
    const errors: string[] = [];
    for (const action of cleanup.reverse()) {
      try {
        await action();
      } catch {
        errors.push("owned_cleanup_failed");
      }
    }
    const portsClosed = await Promise.all(
      ports.map(
        (port) =>
          new Promise<boolean>((done) => {
            const socket = createConnection(port, "127.0.0.1");
            socket.once("error", () => done(true));
            socket.once("connect", () => {
              socket.destroy();
              done(false);
            });
          }),
      ),
    );
    const processesClosed = pids.map((pid) => !alive(pid));
    const resourcesClosed =
      portsClosed.every(Boolean) && processesClosed.every(Boolean);
    if (resourcesClosed) {
      await rm(temporary, { recursive: true, force: true });
      await assert.rejects(access(temporary), { code: "ENOENT" });
    }
    await writeFile(
      join(evidence, `${label}.json`),
      JSON.stringify(
        {
          boundary:
            "actual local TCP/TLS email session, production encrypted identity store and independent production Host processes, existing private bridge, current packaged CLI over real stdio; no adapter-only substitute",
          fixtureSetup:
            "bootstrap creates initial tenant/user; public email login issues actual HTTP session; production adapter verifies and encrypted store persists it; all later business writes use HTTP; no automatic lifecycle prewarm in controlled workers",
          label,
          node: process.version,
          observations,
          traffic,
          cleanup: {
            ownedPorts: ports,
            portsClosed,
            ownedProcessIds: pids,
            processesClosed,
            ownedDirectoryRemoved: resourcesClosed,
            errors,
          },
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    assert.deepEqual(errors, []);
    assert.ok(portsClosed.every(Boolean));
    assert.ok(processesClosed.every(Boolean));
  });
  const app = await createApp({
    database: join(temporary, "backend.sqlite"),
    masterKey: randomBytes(32),
    publicUrl: "http://localhost:3000",
    worker: false,
    wecomProvider: {
      async identity() {
        throw new Error("excluded WeCom");
      },
      async directory() {
        throw new Error("excluded WeCom");
      },
    },
  });
  cleanup.push(() => app.close());
  let manifestBarrier: ReturnType<typeof deferred<void>> | undefined;
  let manifestReached = deferred();
  cleanup.push(() => manifestBarrier?.resolve());
  app.addHook("onSend", async (req, _reply, body) => {
    if (manifestBarrier && req.url === "/api/client/assets") {
      const held = manifestBarrier;
      manifestBarrier = undefined;
      manifestReached.resolve();
      await held.promise;
    }
    return body;
  });
  app.addHook("onResponse", async (req, reply) => {
    traffic.push({
      method: req.method,
      route: req.routeOptions.url ?? "unknown",
      status: reply.statusCode,
    });
  });
  const password = randomBytes(24).toString("hex");
  secrets.push(password);
  const user = await bootstrap(app.services.db, {
    name: "Owned concurrent cache",
    email: "cache-concurrency@example.test",
    password,
  });
  const backendOrigin = await app.listen({ host: "127.0.0.1", port: 0 });
  const backendPort = Number(new URL(backendOrigin).port);
  ports.push(backendPort);
  const certificate = join(temporary, "cert.pem"),
    privateKey = join(temporary, "key.pem");
  await promisify(execFile)("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    privateKey,
    "-out",
    certificate,
    "-subj",
    "/CN=localhost",
    "-addext",
    "subjectAltName=DNS:localhost,IP:127.0.0.1",
    "-days",
    "1",
  ]);
  const previousCAs = getCACertificates("default");
  setDefaultCACertificates([
    ...previousCAs,
    await readFile(certificate, "utf8"),
  ]);
  cleanup.push(() => setDefaultCACertificates(previousCAs));
  const server = createServer(
    { cert: await readFile(certificate), key: await readFile(privateKey) },
    (req, res) => {
      const upstream = httpRequest(
        {
          hostname: "127.0.0.1",
          port: backendPort,
          path: req.url,
          method: req.method,
          headers: req.headers,
        },
        (reply) => {
          res.writeHead(reply.statusCode ?? 502, reply.headers);
          reply.pipe(res);
        },
      );
      req.on("aborted", () => upstream.destroy());
      upstream.on("error", () => {
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
      req.pipe(upstream);
    },
  );
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const tlsPort = (server.address() as { port: number }).port;
  ports.push(tlsPort);
  cleanup.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  });
  const origin = `https://127.0.0.1:${tlsPort}`;
  async function api<T = Row>(
    path: string,
    method = "GET",
    body?: unknown,
    token?: string,
    expected = 200,
  ): Promise<T> {
    assert.ok(!/wecom|connectors|drive/.test(path));
    const response = await fetch(origin + path, {
      method,
      signal: AbortSignal.timeout(15000),
      redirect: "error",
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    assert.equal(response.status, expected, `${method} ${path}`);
    return (await response.json()) as T;
  }
  const issued = await api<{ token: string; expiresAt: number }>(
    "/api/auth/login",
    "POST",
    {
      tenantId: user.tenantId,
      email: "cache-concurrency@example.test",
      password,
    },
  );
  secrets.push(issued.token);
  const securityPath = `/api/tenants/${user.tenantId}/configurations/security`;
  const current = await api(securityPath, "GET", undefined, issued.token);
  const saved = await api(
    securityPath,
    "PUT",
    {
      revision: current.revision,
      data: {
        ...(current.published as Row),
        allowFilesystem: true,
        dangerousSkills: false,
      },
    },
    issued.token,
  );
  await api(
    securityPath + "/publish",
    "POST",
    { revision: saved.revision },
    issued.token,
  );
  let assetId: string | undefined;
  async function publish(version: number, manyFiles = false) {
    const skillText = `---\nname: owned-concurrent-cache\ndescription: APPROVED_G03_V${version}\n---\nAPPROVED_G03_V${version}`;
    const files = [
      { path: "SKILL.md", content: skillText },
      {
        path: "scripts/never-run.cjs",
        content:
          "require('node:fs').appendFileSync('tool-side-effect.txt','UNEXPECTED_REPLAY')",
      },
      ...Array.from({ length: manyFiles ? 90 : 1 }, (_, i) => ({
        path: `payload/${String(i).padStart(3, "0")}/data.txt`,
        content: `APPROVED_G03_V${version}_FILE_${i}_` + "x".repeat(200),
      })),
    ];
    const content = { files, highRisk: false };
    const base = `/api/tenants/${user.tenantId}/assets`;
    if (!assetId) {
      const created = await api(
        base,
        "POST",
        {
          name: "Owned concurrent cache",
          kind: "skill",
          scope: { all: true },
          content,
        },
        issued.token,
        201,
      );
      assetId = String(created.id);
    } else {
      const rows = await api<{ items: Row[] }>(
        base,
        "GET",
        undefined,
        issued.token,
      );
      const row = rows.items.find((item) => item.id === assetId)!;
      await api(
        base + "/" + assetId,
        "PUT",
        {
          name: "Owned concurrent cache",
          kind: "skill",
          scope: { all: true },
          revision: row.revision,
          content,
        },
        issued.token,
      );
    }
    for (const operation of ["review", "publish"])
      await api(
        `${base}/${assetId}/${operation}`,
        "POST",
        { version, ...(operation === "review" ? { approved: true } : {}) },
        issued.token,
      );
    return { skillText, files, content };
  }
  const storage = join(temporary, "enterprise-storage");
  for (const directory of [
    storage,
    join(temporary, "workspace"),
    join(temporary, "cli-home"),
  ])
    await mkdir(directory, { recursive: true });
  const sentinel = join(temporary, "workspace/personal-preserved.txt");
  await writeFile(sentinel, "PERSONAL_PRESERVED");
  const bundles = [
    resolve("clients/uwork/apps/zcode-cli/packages/cli/dist/zcode.cjs"),
    resolve(
      "clients/uwork/packages/desktop/bundled-agents/darwin-arm64/glm/zcode.cjs",
    ),
  ];
  const bundleHashes = await Promise.all(
    bundles.map(async (path) =>
      createHash("sha256")
        .update(await readFile(path))
        .digest("hex"),
    ),
  );
  assert.equal(bundleHashes[0], bundleHashes[1]);
  const version = await promisify(execFile)(
    clientNode,
    [bundles[0]!, "--version"],
    {
      cwd: join(temporary, "workspace"),
      env: {
        PATH: process.env.PATH,
        HOME: join(temporary, "cli-home"),
        USERPROFILE: join(temporary, "cli-home"),
        ZCODE_DATA_BASE_DIR: join(temporary, "version-data"),
        ZCODE_MODEL_TELEMETRY_ENABLED: "false",
      },
      timeout: 10000,
    },
  );
  observations.push({
    cliBundleSha256: bundleHashes[0],
    desktopBundleSha256: bundleHashes[1],
    packagedCliVersion: version.stdout.trim(),
    packagedCliVersionExit: 0,
  });
  const credentialSecret = randomBytes(32).toString("hex");
  secrets.push(credentialSecret);
  async function worker(
    label: string,
    seed = false,
    preparation: { withholdReady?: boolean; timeoutMs?: number } = {},
  ) {
    const child = spawn(
      clientNode,
      [
        "--import",
        "tsx",
        resolve("scripts/fixtures/client-assets-concurrency-host-worker.ts"),
      ],
      {
        cwd: resolve("."),
        detached: true,
        stdio: ["ignore", "pipe", "pipe", "ipc"],
        env: {
          PATH: process.env.PATH,
          HOME: join(temporary, "cli-home"),
          TMPDIR: process.env.TMPDIR,
          NODE_ENV: "test",
        },
      },
    );
    assert.ok(child.pid);
    pids.push(child.pid);
    let wire = "",
      sequence = 0,
      closed = false;
    child.stdout!.on("data", (chunk: Buffer) => {
      wire = (wire + chunk).slice(-100000);
    });
    child.stderr!.on("data", (chunk: Buffer) => {
      wire = (wire + chunk).slice(-100000);
    });
    const exited = new Promise<NodeJS.Signals | null>((done) =>
      child.once("exit", (_code, signal) => {
        closed = true;
        done(signal);
      }),
    );
    let gracefulStop: (() => Promise<void>) | undefined = undefined;
    let cleanupPromise: Promise<void> | undefined;
    // spawn 后即登记：readiness 失败也必须回收整组，不能先删仍被写入的根目录。
    const dispose = () =>
      (cleanupPromise ??= (async () => {
        if (!closed && gracefulStop) {
          try {
            await gracefulStop();
          } catch {
            /* fall through to the owned process-group fallback */
          }
        }
        if (groupAlive(child.pid!)) {
          try {
            process.kill(-child.pid!, "SIGKILL");
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
          }
        }
        await bounded(exited, 5000);
        const deadline = Date.now() + 5000;
        while (groupAlive(child.pid!) && Date.now() < deadline)
          await new Promise((done) => setTimeout(done, 25));
        assert.equal(
          groupAlive(child.pid!),
          false,
          "owned worker group must exit",
        );
        for (const secret of secrets)
          assert.equal(
            wire.includes(secret),
            false,
            "owned worker output must not contain private material",
          );
      })());
    cleanup.push(dispose);
    const pending = new Map<number, (value: Report) => void>();
    const started = deferred<Report>();
    const staged = deferred<string>();
    child.on("message", (message: Report) => {
      if (message.ready) {
        if (message.cliPid) pids.push(message.cliPid);
        if (!preparation.withholdReady) started.resolve(message);
      } else if (message.staged) staged.resolve(message.staged);
      else if (message.id !== undefined) {
        pending.get(message.id)?.(message);
        pending.delete(message.id);
      }
    });
    child.send({
      temporary,
      origin,
      certificate,
      tenantId: user.tenantId,
      userId: user.userId,
      ...issued,
      credentialSecret,
      seed,
      label,
      clientNode,
    });
    let info: Report;
    try {
      info = await bounded(
        Promise.race([
          started.promise,
          exited.then(() => {
            // 子进程原始诊断可能含私有材料；失败也不能把它拼入主日志。
            throw new Error("owned worker preparation failed");
          }),
        ]),
        preparation.timeoutMs,
      );
    } catch (error) {
      await dispose();
      throw error;
    }
    assert.ok(info.cliPid);
    observations.push({
      worker: label,
      hostNode: info.hostNode,
      hostStarted: true,
      packagedCliStarted: true,
    });
    const request = async (command = "catalog", reference?: Reference) => {
      const id = ++sequence;
      const result = new Promise<Report>((done) => pending.set(id, done));
      child.send({ id, command, reference });
      const report = await bounded(
        Promise.race([
          result,
          exited.then(() => {
            throw new Error("owned Host exited during request");
          }),
        ]),
      );
      assert.equal(report.harnessError, undefined);
      if (report.stats) assert.equal(report.stats.secretLeak, false);
      observations.push({
        worker: label,
        command,
        ...(report.rejected === undefined
          ? {}
          : { actualCliRejected: report.rejected }),
        ...(report.hostCatalog
          ? {
              hostStatus: report.hostCatalog.status,
              hostCode: report.hostCatalog.code,
              selectedAssets: report.hostCatalog.assets?.map((item) => ({
                key: item.key,
                ...item.asset,
              })),
            }
          : {}),
        ...(report.stats ? { stats: report.stats } : {}),
        ...(report.decision ? { decision: report.decision } : {}),
      });
      return report;
    };
    const stop = async () => {
      if (!closed) {
        await request("stop");
        await bounded(exited, 5000);
      }
      for (const secret of secrets) assert.equal(wire.includes(secret), false);
    };
    gracefulStop = stop;
    return {
      request,
      stop,
      info,
      pid: child.pid,
      exited,
      staged: staged.promise,
    };
  }
  return {
    temporary,
    storage,
    worker,
    publish,
    observations,
    traffic,
    ownedProcessIds: pids,
    get assetId() {
      return assetId!;
    },
    holdManifest() {
      const held = deferred();
      manifestBarrier = held;
      manifestReached = deferred();
      cleanup.push(() => held.resolve());
      return { reached: manifestReached.promise, release: held.resolve };
    },
    async preserve() {
      assert.equal(await readFile(sentinel, "utf8"), "PERSONAL_PRESERVED");
      await assert.rejects(
        access(join(temporary, "workspace/tool-side-effect.txt")),
        { code: "ENOENT" },
      );
      assert.equal(
        traffic.some((item) =>
          /models\/.*\/chat|\/chat\/completions|tools\/execute/.test(
            item.route,
          ),
        ),
        false,
      );
      for (let i = 0; i < bundles.length; i++)
        assert.equal(
          createHash("sha256")
            .update(await readFile(bundles[i]!))
            .digest("hex"),
          bundleHashes[i],
        );
    },
  };
}
function admitted(report: Report, assetId: string, version: number) {
  assert.equal(report.rejected, false);
  assert.deepEqual(
    report.catalog?.skills.map((item) => item.name),
    [`enterprise:${assetId}`],
  );
  assert.equal(report.hostCatalog?.status, "ready");
  assert.equal(report.hostCatalog.assets.length, 1);
  const ref = report.hostCatalog.assets[0]!;
  assert.equal(ref.asset.version, version);
  assert.ok(report.stats!.admissionRequests >= 2);
  assert.ok(report.stats!.admissions.every((item) => item.allowed));
  return ref;
}
async function complete(
  reference: Reference,
  files: { path: string; content: string }[],
) {
  for (const file of files)
    assert.equal(
      await readFile(join(reference.directory, file.path), "utf8"),
      file.content,
    );
}

test(
  "preparation timeout reaps an actual Host and CLI before any fixture root removal",
  { timeout: 20000 },
  async (t) => {
    const f = await fixture(t, "preparation-timeout-cleanup");
    // 只丢弃父驱动的ready回执：产品Host/CLI真实启动，既有业务响应不替换。
    await assert.rejects(
      f.worker("withheld-ready", true, {
        withholdReady: true,
        timeoutMs: 5000,
      }),
      { message: "owned concurrency/crash operation timed out" },
    );
    assert.equal(
      f.ownedProcessIds.length,
      2,
      "actual CLI readiness must have been observed",
    );
    assert.ok(f.ownedProcessIds.every((pid) => !alive(pid)));
    assert.equal(groupAlive(f.ownedProcessIds[0]!), false);
    await access(f.temporary);
    await f.preserve();
    f.observations.push({
      parentReadyAcknowledgementWithheld: true,
      actualHostAndCliStarted: true,
      boundedPreparationRejected: true,
      ownedProcessGroupReapedBeforeRootRemoval: true,
      rawChildDiagnosticNotExposed: true,
    });
  },
);

test(
  "independent actual Host+CLI pairs reject stale selection without pruning a newer admitted cache",
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t, "dual-host-selection");
    const v1 = await f.publish(1),
      a = await f.worker("a", true);
    const old = admitted(await a.request(), f.assetId, 1);
    await complete(old, v1.files);
    const b = await f.worker("b");
    const barrier = f.holdManifest(),
      pendingA = a.request();
    await bounded(barrier.reached);
    const v2 = await f.publish(2);
    const current = admitted(await b.request(), f.assetId, 2);
    await complete(current, v2.files);
    barrier.release();
    const stale = await pendingA;
    assert.equal(stale.rejected, true);
    assert.equal(stale.hostCatalog?.status, "denied");
    assert.equal(stale.hostCatalog.code, "enterprise_asset_selection_changed");
    await complete(current, v2.files);
    const repeated = admitted(await b.request(), f.assetId, 2);
    assert.equal(repeated.directory, current.directory);
    await complete(repeated, v2.files);
    assert.equal((await a.request("authorize", old)).decision?.allowed, false);
    await f.preserve();
    f.observations.push({
      oldVersion: 1,
      selectedVersion: 2,
      actualOldCliRejected: true,
      staleHostCode: stale.hostCatalog.code,
      newHostCliRemainsAdmitted: true,
      selectedContentFiles: v2.files.length,
      noSideEffectReplay: true,
    });
  },
);

test(
  "SIGKILL during actual Host materialize recovers through a new Host+CLI without staged execution or replay",
  { timeout: 60000, skip: process.platform === "win32" },
  async (t) => {
    const f = await fixture(t, "sigkill-install-recovery");
    await f.publish(1);
    const first = await f.worker("before-crash", true);
    const old = admitted(await first.request(), f.assetId, 1);
    const v2 = await f.publish(2, true);
    // 只读观察器保持真实身份返回值，在产品的逐文件current检查处暂停进程组。
    await first.request("arm-crash");
    const abandoned = first.request().catch(() => undefined);
    const stageRelative = await bounded(first.staged);
    const stage = join(f.storage, stageRelative),
      root = dirname(stage);
    await access(join(stage, ".ownership.json"));
    assert.match(
      await readFile(join(stage, "content/SKILL.md"), "utf8"),
      /APPROVED_G03_V2/,
    );
    await assert.rejects(access(join(stage, "manifest.json")), {
      code: "ENOENT",
    });
    const partialFiles = (await readdir(join(stage, "content/payload"))).length;
    assert.ok(partialFiles > 0 && partialFiles < v2.files.length - 2);
    assert.equal(
      (await readdir(root)).filter((name) => /^[a-f0-9]{64}$/.test(name))
        .length,
      0,
    );
    process.kill(-first.pid, "SIGKILL");
    assert.equal(await bounded(first.exited), "SIGKILL");
    await abandoned;
    await access(join(stage, "content/SKILL.md"));
    const v3 = await f.publish(3);
    const recovered = await f.worker("after-crash");
    const current = admitted(await recovered.request(), f.assetId, 3);
    await complete(current, v3.files);
    assert.equal(
      (await readdir(root)).some((name) => name.startsWith("stage-")),
      false,
    );
    assert.deepEqual(
      (await readdir(root)).filter((name) => /^[a-f0-9]{64}$/.test(name)),
      [current.key],
    );
    assert.equal(
      (await recovered.request("authorize", old)).decision?.allowed,
      false,
    );
    const repeated = admitted(await recovered.request(), f.assetId, 3);
    assert.equal(repeated.key, current.key);
    await complete(repeated, v3.files);
    await f.preserve();
    f.observations.push({
      interruptedVersion: 2,
      stageOwnedMarkerObserved: true,
      partialPayloadDirectories: partialFiles,
      completeInterruptedObjectPublished: false,
      actualHostAndCliGroupKilled: true,
      recoveredVersion: 3,
      currentFilesVerified: v3.files.length,
      stageRemovedByProductionStore: true,
      staleVersionDenied: true,
      noSideEffectReplay: true,
    });
  },
);
