import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  readdir,
  rm,
  realpath,
} from "node:fs/promises";
import { join, resolve, dirname, isAbsolute, relative } from "node:path";
import { createServer, createConnection } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { createHash } from "node:crypto";
import {
  createOwnedProcessTracker,
  readProcess,
} from "../../../clients/uwork/packages/ui/test/plugin-store-settings-navigation/ownedProcesses.mjs";

async function waitForDriverExit(exitPromise, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      exitPromise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                "Owned BH driver exceeded " + timeoutMs + "ms deadline",
              ),
            ),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

process.umask(0o077);
const fixtures = import.meta.dirname,
  repo = resolve(fixtures, "../../..");
const args = process.argv.slice(2),
  options = {};
assert.equal(args.length, 8, "Four explicit owned runtime arguments required");
for (let i = 0; i < args.length; i += 2) {
  assert.ok(
    ["--electron", "--browser-harness", "--bh-python", "--evidence"].includes(
      args[i],
    ),
  );
  assert.ok(!options[args[i]]);
  assert.ok(isAbsolute(args[i + 1]) && resolve(args[i + 1]) === args[i + 1]);
  options[args[i]] = args[i + 1];
}
assert.equal(Object.keys(options).length, 4);
const evidence = options["--evidence"];
assert.equal(dirname(evidence), join(repo, "evidence"));
assert.match(
  evidence.slice(dirname(evidence).length + 1),
  /^[a-z0-9][a-z0-9-]+$/,
);
assert.ok(
  options["--electron"].startsWith(join(repo, "data") + "/") &&
    options["--electron"].endsWith("/Electron.app/Contents/MacOS/Electron"),
);
await mkdir(evidence, { mode: 0o700 });
assert.equal(await realpath(evidence), evidence);
const put = (name, value) =>
  writeFile(join(evidence, name), JSON.stringify(value, null, 2), {
    flag: "wx",
    mode: 0o600,
  });
const digest = (b) => createHash("sha256").update(b).digest("hex");
for (const name of ["main.mjs", "form.html", "driver.py"])
  await writeFile(join(evidence, name), await readFile(join(fixtures, name)), {
    flag: "wx",
    mode: 0o600,
  });
const helper = join(repo, "scripts/client-native-scenes-fixed-ui.py");
const extractionCode =
  "import ast,hashlib,json,pathlib,sys; p=pathlib.Path(sys.argv[1]); raw=p.read_bytes(); text=raw.decode(); n=next(n for n in ast.parse(text).body if isinstance(n,ast.FunctionDef) and n.name=='key'); print(json.dumps({'sourceSha256':hashlib.sha256(raw).hexdigest(),'functionSource':ast.get_source_segment(text,n)+chr(10)}))";
const extracted = JSON.parse(
  execFileSync(
    options["--bh-python"],
    ["-I", "-B", "-c", extractionCode, helper],
    {
      encoding: "utf8",
      env: { PATH: "/usr/bin:/bin", HOME: evidence, LANG: "en_US.UTF-8" },
    },
  ),
);
assert.equal(extracted.sourceSha256, digest(await readFile(helper)));
await writeFile(join(evidence, "extracted-key.py"), extracted.functionSource, {
  flag: "wx",
  mode: 0o600,
});
await put("shared-helper-source.json", {
  path: helper,
  sourceSha256: extracted.sourceSha256,
  extractedSha256: digest(extracted.functionSource),
  extraction: "AST actual shared key only",
});
const inputs = [
  ...[
    "run.mjs",
    "main.mjs",
    "form.html",
    "driver.py",
    "test_key_protocol.py",
    "README.md",
  ].map((n) => join(fixtures, n)),
  helper,
  join(
    repo,
    "clients/uwork/packages/ui/test/plugin-store-settings-navigation/ownedProcesses.mjs",
  ),
  options["--electron"],
];
const freeze = { files: [] };
for (const file of inputs) {
  const bytes = await readFile(file);
  freeze.files.push({
    path: relative(repo, file),
    bytes: bytes.length,
    sha256: digest(bytes),
  });
}
await put("source-freeze.json", freeze);
const scratch = await mkdtemp("/tmp/uke-");
for (const name of [
  "home",
  "tmp",
  "config",
  "cache",
  "b",
  "userData",
  "sessionData",
  "logs",
  "crashDumps",
])
  await mkdir(join(scratch, name), { mode: 0o700 });
const probe = createServer();
await new Promise((done) => probe.listen(0, "127.0.0.1", done));
const cdpPort = probe.address().port;
await new Promise((done) => probe.close(done));
const baseEnv = {
  PATH: dirname(process.execPath) + ":/usr/bin:/bin:/usr/sbin:/sbin",
  HOME: join(scratch, "home"),
  USERPROFILE: join(scratch, "home"),
  TMPDIR: join(scratch, "tmp"),
  XDG_CONFIG_HOME: join(scratch, "config"),
  XDG_CACHE_HOME: join(scratch, "cache"),
  LANG: "en_US.UTF-8",
};
const bhEnv = {
  ...baseEnv,
  BH_HOME: join(scratch, "b"),
  BH_RUNTIME_DIR: join(scratch, "b/r"),
  BH_TMP_DIR: join(scratch, "b/t"),
  BH_AGENT_WORKSPACE: join(scratch, "b/a"),
  BH_CONFIG_DIR: join(scratch, "b"),
  BH_RECORD: "0",
  BH_DOMAIN_SKILLS: "0",
  BH_TELEMETRY: "0",
  BH_UPDATE_CHECK: "0",
  BU_NAME: "default",
  BU_CDP_URL: "http://127.0.0.1:" + cdpPort,
};
const { owner, children, track, alive } = createOwnedProcessTracker(
  process.pid,
);
const lsof = (args) => {
  try {
    return execFileSync("/usr/sbin/lsof", ["-nP", ...args], {
      encoding: "utf8",
    });
  } catch (e) {
    if (e.status === 1 && !e.stdout) return "";
    throw e;
  }
};
const exited = (child) =>
  new Promise((done) => {
    child.once("error", (error) => done({ error: String(error) }));
    child.once("exit", (code, signal) => done({ code, signal }));
  });
let electron,
  bh,
  daemon,
  bhClean = false,
  electronEnd = null,
  bhEnd = null,
  error = null;
const stderr = [];
let stderrBytes = 0;
const tracker = setInterval(track, 200);
await put("runtime.json", {
  runner: owner,
  scratch,
  cdpPort,
  exactElectron: options["--electron"],
  backgroundNetworkAllowed: false,
  backendCalls: 0,
  modelCalls: 0,
});
try {
  electron = spawn(
    options["--electron"],
    [join(evidence, "main.mjs"), scratch, evidence, String(cdpPort)],
    { cwd: scratch, env: baseEnv, stdio: ["pipe", "ignore", "pipe"] },
  );
  assert.ok(electron.pid > 1 && electron.pid !== 791);
  void exited(electron);
  electron.stderr.on("data", (b) => {
    if (stderrBytes + b.length <= 65536) {
      stderr.push(b);
      stderrBytes += b.length;
    }
  });
  let ready = false;
  for (let i = 0; i < 200; i++) {
    try {
      const engine = JSON.parse(await readFile(join(evidence, "engine.json")));
      assert.equal(engine.pid, electron.pid);
      ready = engine.pageReady;
      break;
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      await delay(25);
    }
  }
  assert.ok(ready, "Owned Electron page must become ready without retry");
  const response = await fetch(bhEnv.BU_CDP_URL + "/json/version");
  assert.equal(response.status, 200);
  const version = await response.json();
  await put("cdp-version.json", version);
  track();
  await put("electron-owner.json", readProcess(electron.pid));
  bh = spawn(options["--browser-harness"], [], {
    cwd: scratch,
    env: { ...bhEnv, BH_REQUIRE_EXISTING_DAEMON: "0" },
    stdio: ["pipe", "inherit", "inherit"],
  });
  const bhExit = exited(bh);
  const code =
    "EVIDENCE=" +
    JSON.stringify(evidence) +
    String.fromCharCode(10) +
    "PAGE=" +
    JSON.stringify(join(evidence, "form.html")) +
    String.fromCharCode(10) +
    (await readFile(join(evidence, "driver.py"), "utf8"));
  bh.stdin.end(code);
  for (let i = 0; i < 200 && !daemon; i++) {
    try {
      const files = (await readdir(bhEnv.BH_RUNTIME_DIR)).filter((n) =>
        /^bu(?:-[\w-]+)?\.pid$/.test(n),
      );
      assert.equal(files.length, 1);
      const pid = Number(
        (await readFile(join(bhEnv.BH_RUNTIME_DIR, files[0]), "utf8")).trim(),
      );
      assert.ok(pid > 1 && pid !== 791);
      const row = readProcess(pid);
      assert.ok(row && row.command.includes("python"));
      const sockets = lsof(["-a", "-p", String(pid), "-U", "-Fn"]);
      assert.ok(sockets.includes(join(bhEnv.BH_RUNTIME_DIR, "bu.sock")));
      assert.ok(
        lsof(["-a", "-p", String(pid), "-d", "cwd", "-Fn"]).includes(scratch),
      );
      daemon = row;
      children.set(pid, row);
      await put("daemon-owner.json", {
        ...row,
        ownSocketVerified: true,
        ownCwdVerified: true,
      });
    } catch (e) {
      if (e.code !== "ENOENT" && e.code !== "ERR_ASSERTION") throw e;
      await delay(25);
    }
  }
  assert.ok(daemon, "Exact owned BH daemon identity required");
  // CDP/驱动挂起也必须进入下面的 owned finally；只限本次等待，不重试。
  bhEnd = await waitForDriverExit(bhExit, 90_000);
  assert.equal(bhEnd.code, 0, "Finite three-scene driver must finish");
  const result = JSON.parse(await readFile(join(evidence, "results.json")));
  assert.equal(result.cases.length, 3);
  assert.deepEqual(
    result.cases.map((r) => r.submitDelta),
    [1, 1, 1],
  );
  await put("case-verdict.json", {
    cases: result.cases.map(
      ({ scenario, submitDelta, keydown, keypress, keyup }) => ({
        scenario,
        submitDelta,
        keydown,
        keypress,
        keyup,
      }),
    ),
    scope:
      "Same Electron standalone local HTML form only; not original UWork navigation acceptance",
  });
} catch (e) {
  error = String(e);
  await put("failure.json", { message: error });
  process.exitCode = 1;
} finally {
  clearInterval(tracker);
  track();
  if (bh && bh.exitCode === null && bh.signalCode === null) bh.kill("SIGTERM");
  if (daemon && alive(daemon)) {
    const closer = spawn(
      options["--bh-python"],
      [
        "-B",
        "-c",
        "from browser_harness.admin import restart_daemon; restart_daemon('default', require_clean=True)",
      ],
      { cwd: scratch, env: bhEnv, stdio: "ignore" },
    );
    const status = await exited(closer);
    bhClean = status.code === 0;
  }
  if (electron && electron.exitCode === null && electron.signalCode === null) {
    electron.stdin.end(Buffer.from([113, 117, 105, 116, 10]));
    for (
      let i = 0;
      i < 80 && electron.exitCode === null && electron.signalCode === null;
      i++
    )
      await delay(25);
  }
  if (electron)
    electronEnd = { code: electron.exitCode, signal: electron.signalCode };
  track();
  for (const row of [...children.values()].reverse())
    if (alive(row)) {
      try {
        process.kill(row.pid, "SIGTERM");
      } catch {}
    }
  await delay(300);
  track();
  for (const row of [...children.values()].reverse())
    if (alive(row)) {
      try {
        process.kill(row.pid, "SIGKILL");
      } catch {}
    }
  await delay(150);
  track();
  const remaining = [...children.values()].filter(alive);
  const tcp = await new Promise((done) => {
    const s = createConnection({ host: "127.0.0.1", port: cdpPort });
    s.once("connect", () => {
      s.destroy();
      done({ port: cdpPort, closed: false });
    });
    s.once("error", (e) => {
      s.destroy();
      done({ port: cdpPort, closed: e.code === "ECONNREFUSED", code: e.code });
    });
  });
  const unix =
    daemon && alive(daemon)
      ? lsof(["-a", "-p", String(daemon.pid), "-U", "-Fn"])
      : "";
  let fdScan = "";
  try {
    fdScan = execFileSync("/usr/sbin/lsof", ["-nP", "-Fpcfan", "+D", scratch], {
      encoding: "utf8",
    });
  } catch (e) {
    if (e.status !== 1) throw e;
    fdScan = String(e.stdout || "");
  }
  const writers = fdScan
    .split(String.fromCharCode(10))
    .filter((l) => l === "aw" || l === "au").length;
  const allClosed =
    !!daemon &&
    bhClean &&
    remaining.length === 0 &&
    tcp.closed &&
    !unix &&
    writers === 0;
  await writeFile(
    join(evidence, "electron-stderr.log"),
    Buffer.concat(stderr),
    { flag: "wx", mode: 0o600 },
  );
  await put("cleanup.json", {
    owner,
    bhCleanShutdownAcknowledged: bhClean,
    electronEnd,
    bhEnd,
    knownProcesses: [...children.values()],
    remaining,
    tcp,
    unix,
    allClosed,
    scratchScopedWriteFdCount: writers,
    scratchScopedFdOutput: fdScan,
    scratch,
    ownScratchRemoved: allClosed,
    processObservation:
      "exact ps pid/birth/comm and pgrep -P descendants; no global ps or PID791",
    nativeUworkOrMainBackendTouched: false,
  });
  if (allClosed) await rm(scratch, { recursive: true });
  else {
    process.exitCode = 1;
    process.stderr.write(
      "Owned scratch retained: closure incomplete" + String.fromCharCode(10),
    );
  }
}
