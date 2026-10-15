import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

async function bounded<T>(promise: Promise<T>, milliseconds: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("Server child exit timed out")),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function leases(database: string) {
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    return db.prepare("SELECT pid FROM instance_lease").all();
  } finally {
    db.close();
  }
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  test(`server CLI ${signal} exits successfully and releases its SQLite lease`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "uwork-server-shutdown-"));
    const database = join(directory, "backend.sqlite");
    const reservation = createServer();
    let child: ReturnType<typeof spawn> | undefined;
    let exited = false;
    let childExit:
      | Promise<{
          code: number | null;
          signal: NodeJS.Signals | null;
        }>
      | undefined;
    let log = "";
    try {
      await new Promise<void>((resolve, reject) => {
        reservation.once("error", reject);
        reservation.listen(0, "127.0.0.1", resolve);
      });
      const port = (reservation.address() as { port: number }).port;
      await new Promise<void>((resolve, reject) => {
        reservation.close((error) => (error ? reject(error) : resolve()));
      });
      const origin = `http://127.0.0.1:${port}`;
      // No inherited environment or --env-file: only this isolated test database
      // and random in-memory key are available to the real source CLI worker.
      child = spawn(
        process.execPath,
        [
          "--import",
          import.meta.resolve("tsx"),
          fileURLToPath(new URL("../src/server.ts", import.meta.url)),
        ],
        {
          cwd: directory,
          env: {
            DATABASE_PATH: database,
            MASTER_KEY: randomBytes(32).toString("hex"),
            HOST: "127.0.0.1",
            PORT: String(port),
            PUBLIC_URL: origin,
            ALLOW_PRIVATE_UPSTREAMS: "false",
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let spawnError: Error | undefined;
      child.once("error", (error) => {
        spawnError = error;
      });
      child.stdout!.on("data", (chunk: Buffer) => {
        log = (log + chunk.toString()).slice(-32768);
      });
      child.stderr!.on("data", (chunk: Buffer) => {
        log = (log + chunk.toString()).slice(-32768);
      });
      childExit = new Promise((resolve) => {
        child!.once("close", (code, childSignal) => {
          exited = true;
          resolve({ code, signal: childSignal });
        });
      });
      let healthy = false;
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline && !exited) {
        try {
          const response = await fetch(`${origin}/health`, {
            headers: { connection: "close" },
            signal: AbortSignal.timeout(500),
          });
          healthy = response.status === 200;
          await response.arrayBuffer();
          if (healthy) break;
        } catch {
          // The child has not started listening yet.
        }
        await delay(25);
      }
      assert.ifError(spawnError);
      assert.ok(healthy, `Server did not become healthy: ${log}`);
      assert.deepEqual(
        leases(database).map((row) => row.pid),
        [child.pid],
      );
      assert.ok(child.kill(signal));
      const exit = await bounded(childExit, 10000);
      assert.deepEqual(
        { exit, leaseRows: leases(database).length },
        { exit: { code: 0, signal: null }, leaseRows: 0 },
        `Shutdown must finish before exiting: ${log}`,
      );
    } finally {
      try {
        if (reservation.listening)
          await new Promise<void>((resolve) =>
            reservation.close(() => resolve()),
          );
        if (child && !exited) {
          child.kill("SIGKILL");
          await bounded(childExit!, 5000);
        }
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  });
}
