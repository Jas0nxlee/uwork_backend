import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/app.js";
import { environment } from "../src/config.js";
import {
  parseEnvironment,
  runPreflight,
  type PreflightReport,
} from "../scripts/production-preflight.js";

const script = fileURLToPath(
  new URL("../scripts/production-preflight.ts", import.meta.url),
);

async function directory(t: TestContext) {
  const path = await mkdtemp(join(tmpdir(), "uwork-preflight-"));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

function baseEnv(directoryPath: string): Record<string, string> {
  return {
    MASTER_KEY: randomBytes(32).toString("hex"),
    DATABASE_PATH: join(directoryPath, "state", "uwork.sqlite"),
    PUBLIC_URL: "https://backend.example.test",
    HOST: "127.0.0.1",
    PORT: "3000",
    ALLOW_PRIVATE_UPSTREAMS: "false",
    PRIVATE_MODEL_ORIGINS: "",
    PATH: process.env.PATH ?? "",
  };
}

async function dataDirectory(directoryPath: string, mode = 0o700) {
  const state = join(directoryPath, "state");
  await mkdir(state, { recursive: true });
  await chmod(state, mode);
  return state;
}

function check(report: PreflightReport, code: string) {
  const found = report.checks.find((entry) => entry.code === code);
  assert.ok(
    found,
    `缺少检查项 ${code}，实际输出：${JSON.stringify(report.checks)}`,
  );
  return found;
}

function sha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function preflightCli(
  env: Record<string, string>,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn(
    process.execPath,
    ["--import", import.meta.resolve("tsx"), script, "--production"],
    { env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout = (stdout + chunk).slice(-1 << 20);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk).slice(-1 << 20);
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 30000);
  try {
    return await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => resolve({ code, stdout, stderr }));
    });
  } finally {
    clearTimeout(timer);
  }
}

test("合法的临时生产配置全部通过且没有失败或警告", async (t) => {
  const dir = await directory(t);
  await dataDirectory(dir);
  const report = await runPreflight({ production: true, env: baseEnv(dir) });
  assert.equal(report.mode, "production");
  assert.equal(report.ok, true, JSON.stringify(report.checks));
  for (const code of [
    "MASTER_KEY_SHAPE",
    "DATABASE_PATH",
    "DATABASE_DIRECTORY",
    "DATABASE_PERMISSIONS",
    "PUBLIC_URL_SHAPE",
    "PUBLIC_URL_HTTPS",
    "HOST_EXPOSURE",
    "PRIVATE_UPSTREAMS",
    "PRIVATE_MODEL_ORIGINS",
  ])
    assert.equal(check(report, code).status, "pass", code);
  for (const code of [
    "DATABASE_SCHEMA",
    "DATABASE_LEASE",
    "DATABASE_INTEGRITY",
  ])
    assert.equal(check(report, code).status, "skip", code);
  assert.deepEqual(
    report.checks.filter(
      (entry) => entry.status === "fail" || entry.status === "warn",
    ),
    [],
  );
});

test("预检的配置解析与 src/config.ts 的真实解析保持同一结果", async (t) => {
  const dir = await directory(t);
  const env = baseEnv(dir);
  const saved = { ...process.env };
  try {
    for (const key of [
      "MASTER_KEY",
      "DATABASE_PATH",
      "PUBLIC_URL",
      "HOST",
      "PORT",
      "ALLOW_PRIVATE_UPSTREAMS",
      "PRIVATE_MODEL_ORIGINS",
      "SANDBOX_DOCKER_SOCKET",
      "SANDBOX_IMAGE",
    ])
      delete process.env[key];
    Object.assign(process.env, env);
    const parsed = parseEnvironment(process.env);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const real = environment();
    assert.equal(parsed.config.database, real.database);
    assert.equal(parsed.config.publicUrl, real.publicUrl);
    assert.equal(parsed.config.host, real.host);
    assert.equal(parsed.config.port, real.port);
    assert.equal(
      parsed.config.allowPrivateUpstreams,
      real.allowPrivateUpstreams,
    );
    assert.deepEqual(
      parsed.config.privateModelOrigins,
      real.privateModelOrigins,
    );
    assert.equal(
      parsed.config.masterKey.toString("hex"),
      real.masterKey.toString("hex"),
    );
  } finally {
    for (const key of Object.keys(process.env))
      if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});

test("占位、非十六进制或缺失的 MASTER_KEY 失败关闭且绝不回显密钥", async (t) => {
  const dir = await directory(t);
  await dataDirectory(dir);
  for (const key of ["0".repeat(64), "z".repeat(64), undefined]) {
    const env = baseEnv(dir);
    if (key === undefined) delete env.MASTER_KEY;
    else env.MASTER_KEY = key;
    const report = await runPreflight({ production: true, env });
    assert.equal(report.ok, false);
    assert.equal(check(report, "MASTER_KEY_SHAPE").status, "fail");
    const serialized = JSON.stringify(report);
    if (key) assert.ok(!serialized.includes(key), "预检结果不能回显主密钥");
  }
});

test("生产模式下非 HTTPS 公网地址和明文公网绑定分别失败", async (t) => {
  const dir = await directory(t);
  await dataDirectory(dir);
  const exposed = baseEnv(dir);
  exposed.PUBLIC_URL = "http://backend.example.test";
  exposed.HOST = "0.0.0.0";
  const report = await runPreflight({ production: true, env: exposed });
  assert.equal(report.ok, false);
  assert.equal(check(report, "PUBLIC_URL_SHAPE").status, "pass");
  assert.equal(check(report, "PUBLIC_URL_HTTPS").status, "fail");
  assert.equal(check(report, "HOST_EXPOSURE").status, "fail");

  const loopback = baseEnv(dir);
  loopback.PUBLIC_URL = "http://localhost:3000";
  loopback.HOST = "127.0.0.1";
  const local = await runPreflight({ production: true, env: loopback });
  assert.equal(local.ok, true, JSON.stringify(local.checks));
  assert.equal(check(local, "PUBLIC_URL_HTTPS").status, "pass");
  assert.equal(check(local, "HOST_EXPOSURE").status, "pass");
});

test("过宽目录/数据库权限和符号链接父目录被拒绝", async (t) => {
  const dir = await directory(t);
  const state = await dataDirectory(dir, 0o777);
  const database = join(state, "uwork.sqlite");
  await writeFile(database, "", { mode: 0o600 });
  await chmod(database, 0o644);
  const env = baseEnv(dir);
  const wide = await runPreflight({ production: true, env });
  assert.equal(wide.ok, false);
  assert.equal(check(wide, "DATABASE_DIRECTORY").status, "pass");
  assert.equal(check(wide, "DATABASE_PERMISSIONS").status, "fail");

  const real = join(dir, "real");
  await mkdir(real, { mode: 0o700 });
  const link = join(dir, "linked");
  await symlink(real, link);
  const linked = baseEnv(dir);
  linked.DATABASE_PATH = join(link, "uwork.sqlite");
  const report = await runPreflight({ production: true, env: linked });
  assert.equal(report.ok, false);
  assert.equal(check(report, "DATABASE_DIRECTORY").status, "fail");
});

test("沙箱 socket 必须为绝对 Unix socket、存在且不可 world-writable", async (t) => {
  const dir = await directory(t);
  await dataDirectory(dir);
  const relative = baseEnv(dir);
  relative.SANDBOX_DOCKER_SOCKET = "relative/docker.sock";
  assert.equal(
    check(
      await runPreflight({ production: true, env: relative }),
      "SANDBOX_SOCKET_PATH",
    ).status,
    "fail",
  );

  const missing = baseEnv(dir);
  missing.SANDBOX_DOCKER_SOCKET = join(dir, "missing.sock");
  const absent = await runPreflight({ production: true, env: missing });
  assert.equal(check(absent, "SANDBOX_SOCKET_STATE").status, "fail");

  const socketPath = join(dir, "sandbox.sock");
  const server: Server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  await chmod(socketPath, 0o600);
  const safe = baseEnv(dir);
  safe.SANDBOX_DOCKER_SOCKET = socketPath;
  const safeReport = await runPreflight({ production: true, env: safe });
  assert.equal(check(safeReport, "SANDBOX_SOCKET_PATH").status, "pass");
  assert.equal(check(safeReport, "SANDBOX_SOCKET_STATE").status, "pass");
  assert.equal(check(safeReport, "SANDBOX_SOCKET_GROUP").status, "pass");
  assert.equal(check(safeReport, "SANDBOX_SOCKET_ENGINE").status, "pass");
  assert.equal(safeReport.ok, true, JSON.stringify(safeReport.checks));

  await chmod(socketPath, 0o666);
  const worldWritable = baseEnv(dir);
  worldWritable.SANDBOX_DOCKER_SOCKET = socketPath;
  assert.equal(
    check(
      await runPreflight({ production: true, env: worldWritable }),
      "SANDBOX_SOCKET_STATE",
    ).status,
    "fail",
  );
});

test("Compose 专用 socket 缺少宿主路径或 GID 时失败，共享 Docker socket 在生产被拒绝", async (t) => {
  const dir = await directory(t);
  await dataDirectory(dir);
  const incomplete = baseEnv(dir);
  incomplete.SANDBOX_DOCKER_SOCKET = "/run/uwork-sandbox.sock";
  const report = await runPreflight({ production: true, env: incomplete });
  assert.equal(check(report, "SANDBOX_SOCKET_GROUP").status, "fail");

  const invalidGid = baseEnv(dir);
  invalidGid.SANDBOX_DOCKER_SOCKET = "/run/uwork-sandbox.sock";
  invalidGid.SANDBOX_HOST_SOCKET = "/srv/uwork/docker.sock";
  invalidGid.SANDBOX_SOCKET_GID = "not-a-number";
  assert.equal(
    check(
      await runPreflight({ production: true, env: invalidGid }),
      "SANDBOX_SOCKET_GROUP",
    ).status,
    "fail",
  );

  const complete = baseEnv(dir);
  complete.SANDBOX_DOCKER_SOCKET = "/run/uwork-sandbox.sock";
  complete.SANDBOX_HOST_SOCKET = "/srv/uwork/docker.sock";
  complete.SANDBOX_SOCKET_GID = "998";
  assert.equal(
    check(
      await runPreflight({ production: true, env: complete }),
      "SANDBOX_SOCKET_GROUP",
    ).status,
    "pass",
  );

  const shared = baseEnv(dir);
  shared.SANDBOX_DOCKER_SOCKET = "/var/run/docker.sock";
  const sharedProduction = await runPreflight({
    production: true,
    env: shared,
  });
  assert.equal(check(sharedProduction, "SANDBOX_SOCKET_ENGINE").status, "fail");
  const sharedDevelopment = await runPreflight({
    production: false,
    env: shared,
  });
  assert.equal(
    check(sharedDevelopment, "SANDBOX_SOCKET_ENGINE").status,
    "warn",
  );
});

test("活动实例租约让生产预检失败，且预检只读不抢占租约", async (t) => {
  const dir = await directory(t);
  const state = await dataDirectory(dir);
  const database = join(state, "uwork.sqlite");
  const app = await createApp({
    database,
    masterKey: randomBytes(32),
    publicUrl: "http://localhost:3000",
  });
  t.after(() => app.close());
  const before = sha256(await readFile(database));
  const report = await runPreflight({ production: true, env: baseEnv(dir) });
  assert.equal(report.ok, false);
  const lease = check(report, "DATABASE_LEASE");
  assert.equal(lease.status, "fail");
  app.services.db.assertInstance();
  assert.equal(
    check(report, "DATABASE_SCHEMA").status,
    "pass",
    "新建数据库的 schema 版本应为 6",
  );
  assert.equal(check(report, "DATABASE_INTEGRITY").status, "pass");
  assert.equal(
    sha256(await readFile(database)),
    before,
    "预检不能写入或迁移源数据库",
  );

  await app.close();
  const released = await runPreflight({
    production: true,
    env: baseEnv(dir),
  });
  assert.equal(released.ok, true, JSON.stringify(released.checks));
  assert.equal(check(released, "DATABASE_LEASE").status, "pass");
});

test("过期租约给出警告且隐藏租约 owner 标识", async (t) => {
  const dir = await directory(t);
  const state = await dataDirectory(dir);
  const database = join(state, "uwork.sqlite");
  const app = await createApp({
    database,
    masterKey: randomBytes(32),
    publicUrl: "http://localhost:3000",
  });
  await app.close();
  const raw = new DatabaseSync(database);
  try {
    raw.prepare("DELETE FROM instance_lease").run();
    raw
      .prepare(
        "INSERT INTO instance_lease(id,owner,pid,host_id,heartbeat_at) VALUES(1,?,?,?,?)",
      )
      .run(
        "synthetic-owner-token",
        process.pid,
        "foreign-host",
        Date.now() - 600000,
      );
  } finally {
    raw.close();
  }
  const report = await runPreflight({ production: true, env: baseEnv(dir) });
  const lease = check(report, "DATABASE_LEASE");
  assert.equal(lease.status, "warn");
  assert.equal(report.ok, true, JSON.stringify(report.checks));
  assert.ok(!JSON.stringify(report).includes("synthetic-owner-token"));
});

test("CLI 以非零退出码和纯 JSON 结果报告失败，合法环境返回零", async (t) => {
  const dir = await directory(t);
  await dataDirectory(dir);
  const failing = baseEnv(dir);
  failing.PUBLIC_URL = "http://backend.example.test";
  failing.HOST = "0.0.0.0";
  const failure = await preflightCli(failing);
  assert.equal(failure.code, 1, failure.stderr);
  const report = JSON.parse(failure.stdout) as PreflightReport;
  assert.equal(report.ok, false);
  assert.ok(report.checks.some((entry) => entry.code === "PUBLIC_URL_HTTPS"));
  assert.ok(!failure.stdout.includes(failing.MASTER_KEY!));

  const success = await preflightCli(baseEnv(dir));
  assert.equal(success.code, 0, success.stderr);
  const healthy = JSON.parse(success.stdout) as PreflightReport;
  assert.equal(healthy.ok, true, JSON.stringify(healthy.checks));
});
