import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  realpath,
  mkdir,
  readFile,
  writeFile,
  symlink,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

const repo = resolve(import.meta.dirname, "../..");
const archiveRoot =
  "/Users/ljp/Library/Caches/uwork-backend/client-server-node-pty-audit-20261020/input";
const runtimes = [
  { node: archiveRoot + "/darwin-new/node", version: "v22.16.0" },
  {
    node: "/Users/ljp/.cache/uwork-client-toolchain/node-v24.14.0-darwin-arm64/bin/node",
    version: "v24.14.0",
  },
];
const minimalEnv = (dir, extra = {}) => ({
  PATH: "/usr/bin:/bin",
  HOME: dir,
  TMPDIR: dir,
  ...extra,
});
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

for (const { node, version } of runtimes) {
  test(
    version +
      " original --import preload runs before CJS entry and restores on ready",
    async () => {
      const dir = await realpath(
        await mkdtemp(join(tmpdir(), "uwork-clock-esm-")),
      );
      try {
        const entry = join(dir, "agent.cjs");
        const journal = join(dir, "journal.jsonl");
        const metadata = join(dir, "metadata.json");
        const source = await readFile(
          join(repo, "scripts/fixtures/agent-startup-clock-preload.mjs"),
          "utf8",
        );
        const mapped = source
          .replace('"/input/metadata.json"', JSON.stringify(metadata))
          .replace(
            '"/work/clock-agent-journal.jsonl"',
            JSON.stringify(journal),
          );
        assert.notEqual(mapped, source);
        const preload = join(dir, "preload.mjs");
        await writeFile(preload, mapped);
        const entrySource = `const first = Date.now(); const rolled = Date.now() < first;
if (rolled !== (process.env.EXPECT_ROLLBACK === '1')) throw new Error('preload did not run before entry');
if (rolled) {
  process.stdout.write(JSON.stringify({method:'startup/storageState',params:{phase:'migrating',elapsedMs:2}})+'\\n');
  process.stdout.write(JSON.stringify({method:'startup/storageState',params:{phase:'ready',elapsedMs:5}})+'\\n');
  if (!(Date.now() > first)) throw new Error('wall clock not restored before ready write returns');
}
console.log(JSON.stringify({entryStarted:true,rolled,version:process.version}));\n`;
        await writeFile(entry, entrySource);
        await writeFile(
          metadata,
          JSON.stringify({
            clockRollback: { targetEntry: entry },
            new: { agentSha256: sha(entrySource) },
          }),
        );
        const run = spawnSync(node, [entry], {
          cwd: dir,
          env: minimalEnv(dir, {
            NODE_OPTIONS: "--import " + preload,
            EXPECT_ROLLBACK: "1",
          }),
          encoding: "utf8",
          timeout: 5000,
        });
        assert.equal(run.status, 0, run.stderr);
        assert.equal(
          JSON.parse(run.stdout.trim().split("\n").at(-1)).version,
          version,
        );
        const rows = (await readFile(journal, "utf8"))
          .trim()
          .split("\n")
          .map((x) => JSON.parse(x));
        assert.deepEqual(
          rows.map((x) => x.event),
          [
            "wall-clock-rollback-installed",
            "original-startup-ready-clock-restored",
          ],
        );
        assert.ok(rows[0].secondWallSample < rows[0].firstWallSample);
        assert.deepEqual(rows[1].states, [
          { phase: "migrating", elapsedMs: 2 },
          { phase: "ready", elapsedMs: 5 },
        ]);
        assert.equal(rows[0].entry, entry);
        assert.equal(rows[0].agentSha256, sha(entrySource));
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );
  test(
    version + " preload keeps exact entry and SHA guards before execution",
    async () => {
      const dir = await realpath(
        await mkdtemp(join(tmpdir(), "uwork-clock-scope-")),
      );
      try {
        const entry = join(dir, "entry.cjs"),
          metadata = join(dir, "metadata.json"),
          journal = join(dir, "journal.jsonl"),
          preload = join(dir, "preload.mjs");
        const code =
          "const a=Date.now();if(Date.now()<a)throw new Error('wrong entry changed');console.log('OWNED_ENTRY_EXECUTED');\n";
        await writeFile(entry, code);
        const raw = await readFile(
          join(repo, "scripts/fixtures/agent-startup-clock-preload.mjs"),
          "utf8",
        );
        await writeFile(
          preload,
          raw
            .replace('"/input/metadata.json"', JSON.stringify(metadata))
            .replace(
              '"/work/clock-agent-journal.jsonl"',
              JSON.stringify(journal),
            ),
        );
        const env = minimalEnv(dir, { NODE_OPTIONS: "--import " + preload });
        await writeFile(
          metadata,
          JSON.stringify({
            clockRollback: { targetEntry: join(dir, "different.cjs") },
            new: { agentSha256: sha(code) },
          }),
        );
        const outside = spawnSync(node, [entry], {
          cwd: dir,
          env,
          encoding: "utf8",
          timeout: 5000,
        });
        assert.equal(outside.status, 0, outside.stderr);
        assert.equal(outside.stdout.trim(), "OWNED_ENTRY_EXECUTED");
        await assert.rejects(readFile(journal), { code: "ENOENT" });
        await writeFile(
          metadata,
          JSON.stringify({
            clockRollback: { targetEntry: entry },
            new: { agentSha256: "0".repeat(64) },
          }),
        );
        const bad = spawnSync(node, [entry], {
          cwd: dir,
          env,
          encoding: "utf8",
          timeout: 5000,
        });
        assert.notEqual(bad.status, 0);
        assert.match(bad.stderr, /Owned clock fixture Agent digest mismatch/);
        assert.equal(bad.stdout, "");
        await assert.rejects(readFile(journal), { code: "ENOENT" });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );
  test(
    version +
      " observer original -e argv[1], role binding and one-second timer remain",
    async () => {
      const dir = await realpath(
        await mkdtemp(join(tmpdir(), "uwork-observer-esm-")),
      );
      let child, closed;
      try {
        const proc = join(dir, "proc"),
          sys = join(dir, "sys/fs/cgroup"),
          output = join(dir, "observed.jsonl"),
          target = join(dir, "owned-app");
        await mkdir(join(proc, "4242/task/4242"), { recursive: true });
        await mkdir(sys, { recursive: true });
        await writeFile(target, "owned fixture");
        await symlink(target, join(proc, "4242/exe"));
        const fields = Array(22).fill("0");
        fields[0] = "S";
        fields[19] = "31337";
        const stat = "4242 (owned app) " + fields.join(" ");
        for (const [name, content] of [
          ["4242/stat", stat],
          ["4242/status", "Uid: 1000 1000 1000 1000"],
          ["4242/wchan", "owned_wait"],
          ["4242/task/4242/stat", stat],
          ["4242/task/4242/wchan", "owned_wait"],
          ["uptime", "1.0 2.0"],
          ["meminfo", "owned-memory"],
        ])
          await writeFile(join(proc, name), content);
        for (const name of [
          "memory.events",
          "memory.events.local",
          "memory.current",
          "memory.peak",
          "memory.max",
          "memory.swap.current",
          "memory.swap.max",
          "pids.current",
          "pids.max",
        ])
          await writeFile(join(sys, name), "0");
        const source = await readFile(
          join(repo, "scripts/tests/linux-distro/reload-observer.mjs"),
          "utf8",
        );
        assert.ok(!source.includes("/environ"));
        const mapped = source
          .replaceAll("/proc", proc)
          .replaceAll("/sys/fs/cgroup", sys)
          .replace("/opt/UWork Preview/zcode-preview", target)
          .replace("/work/reload-passive.jsonl", output);
        child = spawn(
          node,
          [
            "--input-type=module",
            "-e",
            mapped,
            JSON.stringify([{ id: 4242, birth: "31337", type: "renderer" }]),
          ],
          {
            cwd: dir,
            env: minimalEnv(dir),
            stdio: ["ignore", "ignore", "pipe"],
          },
        );
        let stderr = "";
        child.stderr.on("data", (chunk) => {
          stderr += chunk;
        });
        closed = new Promise((resolve, reject) => {
          child.once("close", resolve);
          child.once("error", reject);
        });
        const end = performance.now() + 3500;
        let rows = [];
        while (performance.now() < end) {
          try {
            rows = (await readFile(output, "utf8"))
              .trim()
              .split("\n")
              .map((x) => JSON.parse(x));
          } catch {}
          if (rows.length >= 2) break;
          await delay(30);
        }
        assert.ok(rows.length >= 2, stderr);
        assert.equal(rows[0].processes[0].role, "renderer");
        assert.equal(rows[0].processes[0].birth, "31337");
        assert.equal(rows[0].processes[0].stableBirth, true);
        assert.equal(rows[0].processes[0].threads.length, 1);
        assert.ok(
          rows[1].wallTime - rows[0].wallTime >= 850 &&
            rows[1].wallTime - rows[0].wallTime < 2500,
        );
        assert.equal(Object.keys(rows[0].cgroup).length, 9);
      } finally {
        if (child) {
          child.kill("SIGTERM");
          await closed;
        }
        await rm(dir, { recursive: true, force: true });
      }
    },
  );
  test(
    version +
      " ESM invalid FD probe uses original Darwin JS/native without PTY",
    () => {
      const run = spawnSync(
        node,
        [
          join(repo, "scripts/tests/server-node-pty-invalid-fd.mjs"),
          archiveRoot,
          "darwin-new",
        ],
        {
          cwd: repo,
          env: minimalEnv(tmpdir()),
          encoding: "utf8",
          timeout: 5000,
        },
      );
      assert.equal(run.status, 0, run.stderr);
      const row = JSON.parse(run.stdout);
      assert.equal(row.node, version);
      assert.match(row.publicError, /EBADF/);
      assert.equal(row.nativeFiveError, "Usage: pty.resize(fd, cols, rows)");
      assert.equal(row.ptyOrChildCreated, false);
    },
  );
}

test("all live preload/observer/fragment callers use ESM or explicit template paths", async () => {
  const stateful = await readFile(
    join(repo, "scripts/tests/server-update-stateful-probe.mjs"),
    "utf8",
  );
  assert.ok(stateful.includes("--import /input/clock-preload.mjs"));
  assert.ok(!stateful.includes("--require /input/clock-preload.cjs"));
  const runner = await readFile(
    join(repo, "scripts/tests/run-server-update-stateful.py"),
    "utf8",
  );
  assert.ok(runner.includes("agent-startup-clock-preload.mjs"));
  assert.ok(runner.includes("source / 'clock-preload.mjs'"));
  const distro = await readFile(
    join(repo, "scripts/tests/linux-distro/run.py"),
    "utf8",
  );
  assert.ok(distro.includes("'node', '--input-type=module', '-e', observer"));
  assert.ok(distro.includes("reload-observer.mjs"));
  assert.ok(distro.includes("usage-fixture-addition.mjs.tpl"));
  assert.ok(
    (
      await readFile(
        join(repo, "scripts/tests/linux-distro/usage-fixture-addition.mjs.tpl"),
        "utf8",
      )
    ).includes("async function distroPublicUsageProof()"),
  );
});
