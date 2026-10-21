import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { createConnection } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

const root = "/work/server";
const metadata = JSON.parse(await readFile("/input/metadata.json", "utf8"));
let catalog = null;
const requests = [];
const receipts = [];
const server = createServer((req, res) => {
  requests.push(req.url);
  let bytes = 0;
  res.once("finish", () =>
    receipts.push({ path: req.url, status: res.statusCode, bytes }),
  );
  const sendFile = (path) => {
    const input = createReadStream(path);
    input.on("data", (chunk) => {
      bytes += chunk.byteLength;
    });
    input.on("error", () => {
      res.writeHead(404).end();
    });
    input.pipe(res);
  };
  if (req.url === "/catalog.json") {
    res.setHeader("content-type", "application/json");
    const body = JSON.stringify(catalog);
    bytes = Buffer.byteLength(body);
    res.end(body);
  } else if (["/old.tar.gz", "/new.tar.gz"].includes(req.url)) {
    sendFile(`/input${req.url}`);
  } else if (metadata.componentMode && req.url === "/runtime-manifest.json") {
    sendFile("/input/runtime-manifest.json");
  } else if (
    metadata.componentMode &&
    metadata.componentFiles.some(
      (row) => row.changedFromOld && req.url === `/components/${row.id}.tar.gz`,
    )
  ) {
    const id = req.url.split("/").at(-1);
    sendFile(`/input/${id}`);
  } else {
    res.writeHead(404).end();
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const catalogPort = server.address().port;
const origin = `http://127.0.0.1:${catalogPort}`;
const env = {
  PATH: "/bootstrap/runtime:/usr/bin:/bin",
  HOME: "/work/home",
  TMPDIR: "/tmp",
  NODE_ENV: "production",
  ZCODE_DATA_BASE_DIR: root,
  ZCODE_SERVER_ROOT: root,
  ZCODE_SERVER_SKIP_SERVICE_REGISTRATION: "1",
  ZCODE_SERVER_RELEASE_MANIFEST_URL: origin + "/catalog.json",
};
const faultScript = "/work/candidate-core-fault.cjs";
const faultEnabled = "/work/candidate-core-fault.enabled";
const faultJournal = "/work/candidate-core-fault.jsonl";
const candidateCore = `${root}/releases/${metadata.new.appVersion}-${metadata.new.target}-${metadata.new.sha256.slice(0, 12)}/runtime/server-core.js`;
if (metadata.rollback) {
  await writeFile(faultEnabled, "owned-candidate-only\n", { mode: 0o600 });
  await writeFile(
    faultScript,
    `const fs = require("node:fs");
const expected = ${JSON.stringify(candidateCore)};
let entry;
try { entry = fs.realpathSync(process.argv[1]); } catch {}
if (entry === expected && fs.existsSync(${JSON.stringify(faultEnabled)})) {
  const current = JSON.parse(fs.readFileSync(${JSON.stringify(root + "/current.json")}, "utf8"));
  const transaction = JSON.parse(fs.readFileSync(${JSON.stringify(root + "/update-transaction.json")}, "utf8"));
  fs.appendFileSync(${JSON.stringify(faultJournal)}, JSON.stringify({pid:process.pid, ppid:process.ppid, entry,
    currentArchiveSha256:current.archiveSha256, previousArchiveSha256:transaction.previous?.archiveSha256,
    exitCode:73})+"\\n");
  process.exit(73);
}
`,
    { mode: 0o600 },
  );
  env.NODE_OPTIONS = "--require " + faultScript;
}
const facts = {
  status: "failed",
  node: process.version,
  archives: metadata,
  checks: [],
  commands: [],
  phases: [],
  cleanup: {},
};
const pids = new Set(),
  ports = new Set([catalogPort]);
let launcher = "/bootstrap/bin/zcode";
const current = () => readFile(root + "/current.json", "utf8");
const exists = (path) =>
  readFile(path).then(
    () => true,
    (error) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );

async function cli(args, expected = 0) {
  const child = spawn(launcher, [...args, "--server-root", root, "--json"], {
    env,
    cwd: "/work",
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "",
    stderr = "",
    timedOut = false;
  child.stdout.on("data", (data) => {
    stdout += data;
  });
  child.stderr.on("data", (data) => {
    stderr += data;
  });
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, 60000);
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  }).finally(() => clearTimeout(timer));
  const rows = stdout
    .split("\n")
    .filter((row) => row.startsWith("{"))
    .map((row) => JSON.parse(row));
  const value = rows.at(-1);
  facts.commands.push({
    launcher,
    args,
    code,
    value,
    stderr: stderr.slice(-2000),
    timedOut,
  });
  if (value?.pid) pids.add(value.pid);
  if (value?.port) ports.add(value.port);
  assert.equal(timedOut, false);
  assert.equal(code, expected, `Original CLI ${args[0]} exit`);
  assert.ok(value);
  return value;
}

async function ready(previousPid) {
  for (let i = 0; i < 100; i++) {
    const value = await cli(["status"]);
    if (value.state === "ready" && value.pid !== previousPid) return value;
    await delay(100);
  }
  throw new Error("Original CLI did not become ready");
}

async function info(status) {
  const response = await fetch(
    `http://127.0.0.1:${status.port}/api/server-info`,
    { signal: AbortSignal.timeout(5000) },
  );
  assert.equal(response.status, 200);
  const value = await response.json();
  assert.equal(value.capabilities.websocketRpc, true);
  return value;
}

function release(which, changes = {}) {
  const value = metadata[which];
  catalog = {
    schemaVersion: 1,
    releases: [
      {
        version: value.appVersion,
        target: value.target,
        archiveUrl: `${origin}/${which}.tar.gz`,
        archiveSha256: value.sha256,
        archiveSizeBytes: value.size,
        ...(metadata.componentMode && which === "new"
          ? {
              manifestUrl: origin + "/runtime-manifest.json",
              components: metadata.componentFiles.map((row) => ({
                id: row.id,
                sha256: row.sha256,
                sizeBytes: row.sizeBytes,
                archiveUrl: `${origin}/components/${row.id}.tar.gz`,
                archiveSha256: row.archiveSha256,
              })),
            }
          : {}),
        ...changes,
      },
    ],
  };
}

async function componentSamples(releaseDir) {
  const samples = [];
  const firstFile = async (path) => {
    if ((await stat(path)).isFile()) return path;
    for (const entry of (await readdir(path)).sort()) {
      const found = await firstFile(path + "/" + entry);
      if (found) return found;
    }
    return null;
  };
  for (const row of metadata.componentFiles.filter(
    (value) => !value.changedFromOld,
  )) {
    const path = await firstFile(releaseDir + "/" + row.paths[0]);
    assert.ok(path);
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    samples.push({
      componentId: row.id,
      contentSha256: row.sha256,
      file: path.slice(releaseDir.length + 1),
      sha256: hash.digest("hex"),
      mtimeMs: (await stat(path)).mtimeMs,
    });
  }
  return samples;
}

async function endpointClosed(options) {
  return new Promise((resolve) => {
    const socket = createConnection(options);
    socket.setTimeout(1000);
    socket.once("connect", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", (error) =>
      resolve(["ENOENT", "ECONNREFUSED"].includes(error.code)),
    );
  });
}

const deadline = setTimeout(() => {
  throw new Error("Update probe deadline");
}, 180000);
try {
  assert.equal(process.platform, "linux");
  assert.equal(process.arch, "arm64");
  assert.equal(process.version, "v22.16.0");
  assert.equal(metadata.old.appVersion, "3.16.0");
  assert.equal(metadata.new.appVersion, "3.16.0");
  assert.notEqual(metadata.old.sha256, metadata.new.sha256);
  await mkdir("/work/home", { recursive: true });
  const boot = await cli(["serve", "--daemon"]);
  assert.equal(boot.state, "ready");
  assert.equal(boot.serviceRegistered, false);
  assert.equal((await info(boot)).version, "3.16.0");
  const lock = JSON.parse(await readFile(root + "/run/server.lock", "utf8"));
  pids.add(lock.pid);
  facts.checks.push("isolated-root-original-daemon-no-os-registration");

  release("old");
  assert.deepEqual(await cli(["update"]), { applied: true, version: "3.16.0" });
  const old = await ready(boot.pid);
  const oldPointer = await current();
  const oldManifest = JSON.parse(oldPointer);
  assert.equal(oldManifest.version, "3.16.0");
  assert.equal(oldManifest.appVersion, "3.16.0");
  assert.equal(oldManifest.archiveSha256, metadata.old.sha256);
  assert.equal((await info(old)).version, "0.0.0-dev");
  assert.equal(await exists(root + "/pending.json"), false);
  facts.phases.push({
    phase: "old-original-archive-installed",
    current: oldManifest,
    httpVersion: "0.0.0-dev",
    supervisorVersion: old.version,
    pid: old.pid,
  });
  facts.checks.push(
    "original-online-installer-records-real-old-manifest-version",
  );

  if (!metadata.rollback && !metadata.componentMode) {
    release("new", { archiveSha256: "0".repeat(64) });
    const badSha = await cli(["update"], 1);
    assert.match(badSha.error, /checksum mismatch/i);
    assert.equal(await current(), oldPointer);
    assert.equal(await exists(root + "/pending.json"), false);
    assert.equal(await exists(root + "/update-transaction.json"), false);
    const afterBad = await cli(["status"]);
    assert.equal(afterBad.pid, old.pid);
    assert.equal((await info(afterBad)).version, "0.0.0-dev");
    facts.checks.push("bad-sha-rejected-current-pid-http-preserved-no-pending");

    release("new", { version: "3.17.0", appVersion: "3.17.0" });
    const badVersion = await cli(["update"], 1);
    assert.match(badVersion.error, /version mismatch/i);
    assert.equal(await current(), oldPointer);
    assert.equal(await exists(root + "/pending.json"), false);
    assert.ok(
      (await readdir(root + "/releases")).every(
        (entry) => !entry.startsWith(".incoming-"),
      ),
    );
    assert.equal((await cli(["status"])).pid, old.pid);
    assert.equal((await info(old)).version, "0.0.0-dev");
    facts.checks.push(
      "catalog-version-mismatch-rejected-without-rewriting-archive",
    );
  }

  if (metadata.rollback) {
    release("new");
    const failure = await cli(["update"], 1);
    assert.match(failure.error, /Server Core failed while applying update/);
    const journal = (await readFile(faultJournal, "utf8"))
      .trim()
      .split("\n")
      .map((row) => JSON.parse(row));
    assert.equal(
      journal.length,
      1,
      "Only the actual new candidate Core may be faulted",
    );
    for (const row of journal) {
      pids.add(row.pid);
      assert.equal(row.entry, candidateCore);
      assert.equal(row.currentArchiveSha256, metadata.new.sha256);
      assert.equal(row.previousArchiveSha256, metadata.old.sha256);
      assert.equal(row.exitCode, 73);
    }
    const rolledBack = await ready(old.pid);
    assert.equal(await current(), oldPointer);
    assert.equal((await info(rolledBack)).version, "0.0.0-dev");
    assert.equal(await exists(root + "/pending.json"), false);
    assert.equal(await exists(root + "/update-transaction.json"), false);
    await delay(1500);
    assert.equal((await cli(["status"])).pid, rolledBack.pid);
    assert.equal(
      (await readFile(faultJournal, "utf8")).trim().split("\n").length,
      1,
    );
    facts.phases.push({
      phase: "candidate-failed-transaction-rolled-back",
      current: JSON.parse(await current()),
      pid: rolledBack.pid,
      previousPid: old.pid,
      candidateJournal: journal,
      httpVersion: "0.0.0-dev",
      pendingAbsent: true,
      transactionAbsent: true,
      stableAcrossCrashBackoff: true,
    });
    facts.checks.push(
      "real-candidate-core-exit73-observed-after-current-transaction-switch",
    );
    facts.checks.push(
      "original-supervisor-rolls-current-back-and-relaunches-old-core",
    );
    await rm(faultEnabled);
    facts.checks.push(
      "controlled-startup-fault-disabled-before-original-update-retry",
    );
  }

  let componentReceiptStart = 0;
  let unchangedBefore;
  if (metadata.componentMode) {
    assert.deepEqual(
      metadata.componentFiles
        .filter((row) => row.changedFromOld)
        .map((row) => row.id),
      ["server-runtime"],
    );
    unchangedBefore = await componentSamples(oldManifest.releaseDir);
    assert.equal(unchangedBefore.length, 4);
    release("new");
    catalog.releases[0].components.find(
      (row) => row.id === "server-runtime",
    ).archiveSha256 = "0".repeat(64);
    const begin = receipts.length;
    const bad = await cli(["update"], 1);
    assert.match(bad.error, /checksum mismatch/i);
    assert.equal(await current(), oldPointer);
    assert.equal((await cli(["status"])).pid, old.pid);
    assert.equal((await info(old)).version, "0.0.0-dev");
    assert.equal(await exists(root + "/pending.json"), false);
    const received = receipts.slice(begin);
    assert.equal(
      received.filter(
        (row) =>
          row.path === "/components/server-runtime.tar.gz" &&
          row.status === 200,
      ).length,
      1,
    );
    assert.equal(
      received.filter((row) => row.path === "/new.tar.gz").length,
      0,
    );
    facts.components = {
      badArchiveSha: {
        error: bad.error,
        received,
        currentUnchanged: true,
        pidUnchanged: true,
      },
      unchangedBefore,
    };
    facts.checks.push(
      "bad-component-archive-sha-rejected-no-full-fallback-current-core-preserved",
    );
    componentReceiptStart = receipts.length;
  }

  release("new");
  assert.deepEqual(await cli(["update"]), { applied: true, version: "3.16.0" });
  launcher = root + "/bin/zcode";
  const updated = await ready(old.pid);
  const updatedPointer = await current();
  const updatedManifest = JSON.parse(updatedPointer);
  assert.equal(updatedManifest.archiveSha256, metadata.new.sha256);
  assert.equal(updatedManifest.version, "3.16.0");
  assert.notEqual(updatedManifest.releaseDir, oldManifest.releaseDir);
  assert.equal((await info(updated)).version, "3.16.0");
  assert.equal(await exists(root + "/pending.json"), false);
  assert.equal(await exists(root + "/update-transaction.json"), false);
  facts.phases.push({
    phase: "same-version-different-archive-replaced",
    current: updatedManifest,
    httpVersion: "3.16.0",
    supervisorVersion: updated.version,
    pid: updated.pid,
  });
  facts.checks.push(
    "actual-different-sha-same-version-update-new-core-http-version-correct",
  );
  if (metadata.componentMode) {
    const received = receipts.slice(componentReceiptStart);
    const downloads = received.filter((row) => row.path.endsWith(".tar.gz"));
    assert.deepEqual(
      downloads.map((row) => row.path),
      ["/components/server-runtime.tar.gz"],
    );
    assert.equal(downloads[0].status, 200);
    assert.equal(
      downloads[0].bytes,
      metadata.componentFiles.find((row) => row.id === "server-runtime")
        .archiveSizeBytes,
    );
    const after = await componentSamples(updatedManifest.releaseDir);
    for (const before of unchangedBefore) {
      const observed = after.find(
        (row) => row.componentId === before.componentId,
      );
      assert.equal(observed.sha256, before.sha256);
      assert.equal(observed.contentSha256, before.contentSha256);
      assert.equal(observed.file, before.file);
    }
    facts.components.incremental = {
      received,
      unchangedAfter: after,
      unchangedContentAndFilesMatch: true,
      mtimePreserved: after.map(
        (row, index) => row.mtimeMs === unchangedBefore[index].mtimeMs,
      ),
    };
    facts.checks.push(
      "incremental-downloads-only-original-server-component-reuses-four-unchanged-components",
    );
  }

  const downloads = requests.filter((path) => path.endsWith(".tar.gz")).length;
  assert.deepEqual(await cli(["update"]), {
    status: "up-to-date",
    version: "3.16.0",
  });
  assert.equal(
    requests.filter((path) => path.endsWith(".tar.gz")).length,
    downloads,
  );
  assert.equal(await current(), updatedPointer);
  assert.equal((await cli(["status"])).pid, updated.pid);
  facts.checks.push(
    "matching-sha-idempotent-zero-archive-download-no-core-restart",
  );
  let beforeRestart = updated;
  if (metadata.componentMode) {
    launcher = "/bootstrap/bin/zcode";
    release("old");
    assert.deepEqual(await cli(["update"]), {
      applied: true,
      version: "3.16.0",
    });
    const reset = await ready(updated.pid);
    assert.equal(await current(), oldPointer);
    assert.equal((await info(reset)).version, "0.0.0-dev");
    facts.phases.push({
      phase: "original-update-restores-old-archive-for-fallback-fixture",
      current: JSON.parse(await current()),
      pid: reset.pid,
      httpVersion: "0.0.0-dev",
    });
    facts.checks.push(
      "original-update-restores-old-release-without-manual-pointer-writes",
    );
    release("new");
    delete catalog.releases[0].components.find(
      (row) => row.id === "server-runtime",
    ).archiveUrl;
    const begin = receipts.length;
    assert.deepEqual(await cli(["update"]), {
      applied: true,
      version: "3.16.0",
    });
    const fallback = await ready(reset.pid);
    assert.equal(await current(), updatedPointer);
    assert.equal((await info(fallback)).version, "3.16.0");
    const received = receipts.slice(begin);
    assert.deepEqual(
      received
        .filter((row) => row.path.endsWith(".tar.gz"))
        .map((row) => row.path),
      ["/new.tar.gz"],
    );
    assert.equal(
      received.find((row) => row.path === "/new.tar.gz").bytes,
      metadata.new.size,
    );
    facts.components.fallback = {
      fixture:
        "catalog changed component archiveUrl omitted; original SHA and runtime manifest unchanged",
      received,
      currentIsNewOriginalArchive: true,
    };
    facts.phases.push({
      phase: "missing-component-url-original-full-archive-fallback",
      current: JSON.parse(await current()),
      pid: fallback.pid,
      httpVersion: "3.16.0",
    });
    facts.checks.push(
      "missing-component-url-original-full-archive-fallback-receipt-and-ready",
    );
    launcher = root + "/bin/zcode";
    beforeRestart = fallback;
  }
  assert.deepEqual(await cli(["restart"]), { restarting: true });
  const restarted = await ready(beforeRestart.pid);
  assert.equal((await info(restarted)).version, "3.16.0");
  assert.equal(await current(), updatedPointer);
  facts.checks.push("original-restart-uses-updated-current-release");
  facts.status = "passed";
} catch (error) {
  facts.failure = String(error);
} finally {
  try {
    if (!(await endpointClosed({ path: root + "/run/control.sock" })))
      await cli(["stop"]);
  } catch (error) {
    facts.cleanup.stopFailure = String(error);
  }
  await delay(700);
  if (metadata.rollback) {
    await rm(faultEnabled, { force: true });
    await rm(faultScript, { force: true });
    facts.cleanup.faultMarkerAndScriptRemoved =
      !(await exists(faultEnabled)) && !(await exists(faultScript));
  }
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
  facts.cleanup.pidsAbsent = Object.fromEntries(
    [...pids].map((pid) => {
      try {
        process.kill(pid, 0);
        return [pid, false];
      } catch (error) {
        return [pid, error.code === "ESRCH"];
      }
    }),
  );
  facts.cleanup.portsClosed = Object.fromEntries(
    await Promise.all(
      [...ports].map(async (port) => [
        port,
        await endpointClosed({ host: "127.0.0.1", port }),
      ]),
    ),
  );
  facts.cleanup.controlSocketClosed = await endpointClosed({
    path: root + "/run/control.sock",
  });
  if (
    Object.values(facts.cleanup.pidsAbsent).includes(false) ||
    Object.values(facts.cleanup.portsClosed).includes(false) ||
    !facts.cleanup.controlSocketClosed
  )
    facts.status = "failed";
  facts.requests = requests;
  facts.httpReceipts = receipts;
  clearTimeout(deadline);
  await writeFile("/work/result.json", JSON.stringify(facts, null, 2) + "\n");
}
console.log(JSON.stringify(facts));
process.exitCode = facts.status === "passed" ? 0 : 1;
