import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { once } from "node:events";

const exec = promisify(execFile);
const directory = resolve("evidence/whole-backend-docker");
await mkdir(directory, { recursive: true, mode: 0o700 });
const image =
  process.env.UWORK_DOCKER_IMAGE ?? "uwork-backend:whole-test-20261015";
const context = process.env.UWORK_DOCKER_CONTEXT ?? "colima-uwork-backend";
const initialContext = (
  await exec("docker", ["context", "show"])
).stdout.trim();
const baseline = (await exec("git", ["rev-parse", "HEAD"])).stdout.trim();
const imageId = (
  await exec("docker", [
    "--context",
    context,
    "image",
    "inspect",
    image,
    "--format",
    "{{.Id}}",
  ])
).stdout.trim();
const cases = [
  { name: "container-persistence", script: "docker-smoke.ts" },
  { name: "sandbox-driver", script: "sandbox-driver-smoke.ts" },
  { name: "sandbox-api", script: "sandbox-api-smoke.ts" },
  { name: "sandbox-crash", script: "sandbox-crash-smoke.ts" },
  { name: "agent-sdk-docker", script: "agent-sandbox-smoke.ts" },
  { name: "agent-sdk-container", script: "agent-container-smoke.ts" },
  {
    name: "agent-crash-running",
    script: "agent-crash-smoke.ts",
    mode: "active",
  },
  {
    name: "agent-crash-after-tool",
    script: "agent-crash-smoke.ts",
    mode: "ready",
  },
  { name: "lease-namespace", script: "lease-namespace-smoke.ts" },
  { name: "mcp-crash", script: "agent-mcp-crash-smoke.ts" },
];
const results: {
  name: string;
  status: string;
  exitCode: number | null;
  timedOut: boolean;
  cleanupStatus: string;
  durationMs: number;
  log: string;
  summary: Record<string, boolean | number>;
}[] = [];
const startedAt = new Date().toISOString();
for (const entry of cases) {
  const started = performance.now();
  const log = resolve(directory, `${entry.name}.log`);
  const output = createWriteStream(log, { mode: 0o600 });
  const child = spawn(
    process.execPath,
    ["--import", "tsx", `scripts/${entry.script}`],
    {
      env: {
        ...process.env,
        UWORK_DOCKER_CONTEXT: context,
        UWORK_DOCKER_IMAGE: image,
        ...(entry.mode ? { UWORK_AGENT_CRASH_MODE: entry.mode } : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout.pipe(output, { end: false });
  child.stderr.pipe(output, { end: false });
  let timedOut = false;
  let forceKill: ReturnType<typeof setTimeout> | undefined;
  const deadline = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    forceKill = setTimeout(() => child.kill("SIGKILL"), 10000);
  }, 300000);
  const [exitCode] = (await once(child, "close")) as [
    number | null,
    string | null,
  ];
  clearTimeout(deadline);
  clearTimeout(forceKill);
  const flushed = once(output, "finish");
  output.end();
  await flushed;
  let summary: Record<string, boolean | number> = {};
  for (const line of (await readFile(log, "utf8"))
    .trim()
    .split("\n")
    .reverse()) {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      summary = Object.fromEntries(
        Object.entries(parsed).filter(
          ([, value]) =>
            typeof value === "boolean" || typeof value === "number",
        ),
      ) as typeof summary;
      break;
    } catch {
      /* 原始诊断留在受保护日志，摘要只保留布尔与数值。 */
    }
  }
  const result = {
    name: entry.name,
    status: !timedOut && exitCode === 0 ? "passed" : "failed",
    exitCode,
    timedOut,
    // 超时/异常终止可能绕过子脚本 finally；不能声称资源已清理。
    cleanupStatus:
      timedOut || exitCode !== 0 ? "unconfirmed" : "child-script-completed",
    durationMs: Math.round(performance.now() - started),
    log,
    summary,
  };
  results.push(result);
  console.log(JSON.stringify(result));
}
const finalContext = (await exec("docker", ["context", "show"])).stdout.trim();
const report = {
  baseline,
  node: process.version,
  image,
  imageId,
  context,
  initialContext,
  finalContext,
  startedAt,
  finishedAt: new Date().toISOString(),
  passed: results.filter((result) => result.status === "passed").length,
  failed: results.filter((result) => result.status !== "passed").length,
  results,
};
await writeFile(
  resolve(directory, "report.json"),
  JSON.stringify(report, null, 2) + "\n",
  { mode: 0o600 },
);
if (report.failed || initialContext !== finalContext) process.exitCode = 1;
