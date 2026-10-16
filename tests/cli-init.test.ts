import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/app.js";

async function directory(t: TestContext) {
  const path = await mkdtemp(join(tmpdir(), "uwork-cli-init-"));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}
async function cli(
  cwd: string,
  env: Record<string, string> = {},
  preload?: string,
) {
  const child = spawn(
    process.execPath,
    [
      ...(preload ? ["--import", preload] : []),
      "--import",
      import.meta.resolve("tsx"),
      fileURLToPath(new URL("../src/cli.ts", import.meta.url)),
      "init",
    ],
    { cwd, env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => {
    output = (output + chunk).slice(-8192);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    output = (output + chunk).slice(-8192);
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 15000);
  try {
    return await new Promise<{ code: number | null; output: string }>(
      (resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code) => resolve({ code, output }));
      },
    );
  } finally {
    clearTimeout(timer);
  }
}
function accounts(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return {
      tenants: db.prepare("SELECT count(*) n FROM tenants").get()!.n,
      users: db.prepare("SELECT count(*) n FROM users").get()!.n,
      leases: db.prepare("SELECT count(*) n FROM instance_lease").get()!.n,
    };
  } finally {
    db.close();
  }
}

test("CLI refuses an existing credential artifact before creating an unrecoverable random-password account", async (t) => {
  const cwd = await directory(t),
    database = join(cwd, "backend.sqlite");
  await mkdir(join(cwd, "data"), { mode: 0o700 });
  const target = join(cwd, "data/bootstrap-credentials.txt"),
    sentinel = "existing protected credentials must stay unchanged\n";
  await writeFile(target, sentinel, { mode: 0o600 });
  const result = await cli(cwd, {
    MASTER_KEY: randomBytes(32).toString("hex"),
    DATABASE_PATH: database,
  });
  assert.notEqual(result.code, 0);
  assert.equal(await readFile(target, "utf8"), sentinel);
  assert.deepEqual(accounts(database), { tenants: 0, users: 0, leases: 0 });
});

test("a post-commit credential annotation failure retains protected material that still logs in", async (t) => {
  const cwd = await directory(t),
    database = join(cwd, "backend.sqlite"),
    key = randomBytes(32);
  const preload = join(cwd, "append-failure.mjs");
  await writeFile(
    preload,
    `import { open } from 'node:fs/promises';
const handle = await open('owned-preload-handle', 'wx', 0o600);
const prototype = Object.getPrototypeOf(handle);
await handle.close();
prototype.appendFile = async function () { throw new Error('CONTROLLED_APPEND_FAILURE'); };
`,
    { mode: 0o600 },
  );
  const result = await cli(
    cwd,
    { MASTER_KEY: key.toString("hex"), DATABASE_PATH: database },
    preload,
  );
  assert.notEqual(result.code, 0);
  assert.match(result.output, /CONTROLLED_APPEND_FAILURE/);
  assert.deepEqual(accounts(database), { tenants: 1, users: 1, leases: 0 });
  const target = join(cwd, "data/bootstrap-credentials.txt");
  const saved = await readFile(target, "utf8");
  const email = /^Email: (.+)$/m.exec(saved)![1]!,
    password = /^Password: (.+)$/m.exec(saved)![1]!;
  assert.equal((await stat(target)).mode & 0o777, 0o600);
  assert.ok(
    !result.output.includes(password) &&
      !result.output.includes(key.toString("hex")),
  );
  const app = await createApp({
    database,
    masterKey: key,
    publicUrl: "http://localhost:3000",
  });
  try {
    const origin = await app.listen({ host: "127.0.0.1", port: 0 });
    const response = await fetch(origin + "/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, 200);
    await response.arrayBuffer();
  } finally {
    await app.close();
  }
});

test("CLI refuses an unusable credential directory before committing initial identity", async (t) => {
  const cwd = await directory(t),
    database = join(cwd, "backend.sqlite");
  await writeFile(join(cwd, "data"), "owned file blocks the output directory", {
    mode: 0o600,
  });
  const result = await cli(cwd, {
    MASTER_KEY: randomBytes(32).toString("hex"),
    DATABASE_PATH: database,
  });
  assert.notEqual(result.code, 0);
  assert.deepEqual(accounts(database), { tenants: 0, users: 0, leases: 0 });
});

test("failed bootstrap validation removes only its newly reserved credential artifact", async (t) => {
  const cwd = await directory(t),
    database = join(cwd, "backend.sqlite");
  const result = await cli(cwd, {
    MASTER_KEY: randomBytes(32).toString("hex"),
    DATABASE_PATH: database,
    BOOTSTRAP_PASSWORD: "short",
  });
  assert.notEqual(result.code, 0);
  assert.deepEqual(accounts(database), { tenants: 0, users: 0, leases: 0 });
  await assert.rejects(
    stat(join(cwd, "data/bootstrap-credentials.txt")),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "ENOENT",
  );
});

test("fresh default CLI initialization creates protected working credentials and repeat init preserves identity", async (t) => {
  const cwd = await directory(t);
  const first = await cli(cwd);
  assert.equal(first.code, 0, first.output);
  const environment = await readFile(join(cwd, ".env"), "utf8");
  const credentials = await readFile(
    join(cwd, "data/bootstrap-credentials.txt"),
    "utf8",
  );
  const key = /^MASTER_KEY=(.+)$/m.exec(environment)![1]!;
  const email = /^Email: (.+)$/m.exec(credentials)![1]!,
    password = /^Password: (.+)$/m.exec(credentials)![1]!;
  assert.ok(!first.output.includes(password) && !first.output.includes(key));
  for (const path of [".env", "data/bootstrap-credentials.txt"])
    assert.equal((await stat(join(cwd, path))).mode & 0o777, 0o600);
  assert.equal((await stat(join(cwd, "data"))).mode & 0o777, 0o700);
  const second = await cli(cwd);
  assert.equal(second.code, 0, second.output);
  assert.equal(await readFile(join(cwd, ".env"), "utf8"), environment);
  assert.equal(
    await readFile(join(cwd, "data/bootstrap-credentials.txt"), "utf8"),
    credentials,
  );
  const database = join(cwd, "data/uwork.sqlite");
  assert.deepEqual(accounts(database), { tenants: 1, users: 1, leases: 0 });
  const app = await createApp({
    database,
    masterKey: Buffer.from(key, "hex"),
    publicUrl: "http://localhost:3000",
  });
  try {
    const origin = await app.listen({ host: "127.0.0.1", port: 0 });
    const response = await fetch(origin + "/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(response.status, 200);
    await response.arrayBuffer();
  } finally {
    await app.close();
  }
});
