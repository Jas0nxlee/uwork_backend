import assert from "node:assert/strict";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createConnection } from "node:net";

const exec = promisify(execFile);
export const pidAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
export const portClosed = (port: number) =>
  new Promise<boolean>((done) => {
    assert.notEqual(port, 3000);
    const socket = createConnection(port, "127.0.0.1");
    socket.once("error", () => done(true));
    socket.once("connect", () => {
      socket.destroy();
      done(false);
    });
  });
export async function boundedWait<T>(
  operation: () => Promise<T>,
  accept: (value: T) => boolean,
  label: string,
) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const value = await operation();
      if (accept(value)) return value;
    } catch {
      /* bounded startup race */
    }
    await delay(80);
  }
  throw new Error(`Timed out: ${label}`);
}
interface BrowserOptions {
  root: string;
  evidence: string;
  name: string;
  redact(value: string): string;
  trustSpkiSha256?: string;
}
/** 测试独占Chrome/CDP/BH；不会发现或附着已有浏览器。 */
export class OwnedAdminBrowser {
  readonly #options: BrowserOptions;
  readonly #profile: string;
  readonly #bh: string;
  readonly #known = new Set<number>();
  readonly #birth = new Map<number, string>();
  readonly #drivers = new Map<number, ChildProcess>();
  #chrome?: ChildProcess;
  #daemonPid?: number;
  #daemonVerified = false;
  #pidFiles: string[] = [];
  #attempted = false;
  #cdpPort?: number;
  #closeTask?: Promise<Record<string, unknown>>;
  constructor(options: BrowserOptions) {
    if (options.trustSpkiSha256 !== undefined) {
      const digest = options.trustSpkiSha256;
      assert.ok(
        /^[A-Za-z0-9+/]{43}=$/.test(digest) &&
          Buffer.from(digest, "base64").length === 32 &&
          Buffer.from(digest, "base64").toString("base64") === digest,
        "expected a single canonical SHA256 SPKI base64 digest",
      );
    }
    this.#options = { ...options };
    this.#profile = join(options.root, "chrome");
    this.#bh = join(options.root, "bh");
  }
  get cdpPort() {
    return this.#cdpPort;
  }
  async #remember() {
    const { stdout } = await exec(
      "ps",
      ["-axo", "pid=,ppid=,pgid=,stat=,lstart=,command="],
      { maxBuffer: 8 * 1024 * 1024, env: { ...process.env, LC_ALL: "C" } },
    );
    const rows = stdout.split("\n").flatMap((line) => {
      const match = line.match(
        /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+\s+\S+\s+\d+\s+\d+:\d+:\d+\s+\d{4})\s+(.+)$/,
      );
      return match
        ? [
            {
              pid: Number(match[1]),
              parent: Number(match[2]),
              group: Number(match[3]),
              state: match[4]!,
              birth: match[5]!,
              command: match[6]!,
            },
          ]
        : [];
    });
    const chromePid = this.#chrome?.pid;
    const leader = rows.find((row) => row.pid === chromePid);
    const leaderOwned =
      leader &&
      this.#chrome?.exitCode === null &&
      this.#chrome.signalCode === null &&
      (!this.#birth.has(leader.pid) ||
        this.#birth.get(leader.pid) === leader.birth);
    for (const row of rows)
      if (
        (leaderOwned && (row.pid === chromePid || row.group === chromePid)) ||
        row.command.includes(this.#profile)
      )
        this.#known.add(row.pid);
    if (this.#daemonPid) {
      const daemon = rows.find((row) => row.pid === this.#daemonPid);
      if (daemon && !this.#daemonVerified) {
        assert.ok(
          daemon.command.includes("browser_harness.daemon"),
          "owned BH daemon identity was not verified",
        );
        this.#daemonVerified = true;
      }
      this.#known.add(this.#daemonPid);
    }
    this.#known.delete(process.pid);
    assert.equal(this.#known.has(37266), false);
    for (const row of rows)
      if (this.#known.has(row.pid) && !this.#birth.has(row.pid))
        this.#birth.set(row.pid, row.birth);
    return rows;
  }
  async #running() {
    const rows = await this.#remember();
    return [...this.#known].filter((pid) => {
      const driver = this.#drivers.get(pid);
      if (driver && (driver.exitCode !== null || driver.signalCode !== null))
        return false;
      const row = rows.find((row) => row.pid === pid);
      return (
        !!row &&
        !row.state.startsWith("Z") &&
        row.birth === this.#birth.get(pid)
      );
    });
  }
  async start() {
    let launchError: Error | undefined;
    this.#chrome = spawn(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      [
        "--headless=new",
        "--incognito",
        "--no-first-run",
        "--no-default-browser-check",
        "--window-size=1440,1000",
        "--disable-background-networking",
        "--disable-sync",
        "--disable-application-cache",
        "--disk-cache-size=0",
        "--media-cache-size=0",
        "--disable-gpu-shader-disk-cache",
        "--disable-breakpad",
        "--disable-crash-reporter",
        "--password-store=basic",
        "--remote-debugging-address=127.0.0.1",
        "--remote-debugging-port=0",
        `--user-data-dir=${this.#profile}`,
        ...(this.#options.trustSpkiSha256
          ? [
              `--ignore-certificate-errors-spki-list=${this.#options.trustSpkiSha256}`,
            ]
          : []),
        "about:blank",
      ],
      { detached: true, stdio: "ignore" },
    );
    this.#chrome.on("error", (error) => {
      launchError = error;
    });
    if (this.#chrome.pid) this.#known.add(this.#chrome.pid);
    const value = await boundedWait(
      async () => {
        if (launchError) throw launchError;
        return readFile(join(this.#profile, "DevToolsActivePort"), "utf8");
      },
      (value) => /^\d+\n/.test(value),
      "owned Chrome CDP",
    );
    this.#cdpPort = Number(value.split("\n")[0]);
    assert.notEqual(this.#cdpPort, 3000);
  }
  async run(
    driver: string,
    stage: string,
    environment: Record<string, string>,
  ) {
    assert.ok(this.#cdpPort);
    const env = { ...process.env };
    delete env.BU_CDP_WS;
    delete env.BU_AUTOSPAWN;
    delete env.BH_DEBUG_CLICKS;
    const child = spawn("/Users/ljp/.local/bin/browser-harness", [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...env,
        ...environment,
        BU_NAME: this.#options.name,
        BU_CDP_URL: `http://127.0.0.1:${this.#cdpPort}`,
        BH_HOME: this.#bh,
        BH_CONFIG_DIR: this.#bh,
        BH_RUNTIME_DIR: join(this.#bh, "r"),
        BH_TMP_DIR: join(this.#bh, "t"),
        BH_AGENT_WORKSPACE: join(this.#bh, "w"),
        BH_RUNTIME_DIR_SHARED: "0",
        BH_TMP_DIR_SHARED: "0",
        BH_RECORD: "0",
        BH_TELEMETRY: "0",
        BH_DOMAIN_SKILLS: "0",
        BH_REQUIRE_EXISTING_DAEMON: this.#attempted ? "1" : "0",
        UWORK_EXPERIENCE_STAGE: stage,
        UWORK_EXPERIENCE_EVIDENCE: this.#options.evidence,
      },
    });
    this.#attempted = true;
    if (child.pid) {
      this.#known.add(child.pid);
      this.#drivers.set(child.pid, child);
    }
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (bytes: Buffer) => {
      stdout += bytes.toString();
    });
    child.stderr.on("data", (bytes: Buffer) => {
      stderr += bytes.toString();
    });
    const timeout = setTimeout(() => child.kill("SIGKILL"), 60000);
    try {
      child.stdin.end(await readFile(driver, "utf8"));
      const code = await new Promise<number | null>((done, reject) => {
        child.once("error", reject);
        child.once("exit", done);
      });
      await writeFile(
        join(this.#options.evidence, `browser-${stage}.log`),
        this.#options.redact(stdout + stderr),
        { mode: 0o600 },
      );
      assert.equal(code, 0, `browser driver stage failed: ${stage}`);
      const line = stdout
        .split("\n")
        .find((line) => line.startsWith("ADMIN_EXPERIENCE_RESULT="));
      assert.ok(line, `safe DOM result missing: ${stage}`);
      return JSON.parse(
        line.slice("ADMIN_EXPERIENCE_RESULT=".length),
      ) as Record<string, unknown>;
    } finally {
      clearTimeout(timeout);
      this.#pidFiles = await readdir(join(this.#bh, "r")).then(
        (files) =>
          files.filter((file) => /^bu(?:-[A-Za-z0-9_-]+)?\.pid$/.test(file)),
        () => [],
      );
      if (this.#pidFiles.length === 1) {
        const value = Number(
          await readFile(join(this.#bh, "r", this.#pidFiles[0]!), "utf8"),
        );
        if (Number.isInteger(value) && value > 0) {
          assert.ok(
            this.#daemonPid === undefined || this.#daemonPid === value,
            "owned BH daemon PID changed",
          );
          this.#daemonPid = value;
        }
      }
      await this.#remember();
      assert.ok(
        this.#daemonPid && this.#daemonVerified,
        "owned BH daemon PID was not identified",
      );
    }
  }
  close() {
    return (this.#closeTask ??= this.#close());
  }
  async #close(): Promise<Record<string, unknown>> {
    let running = await this.#running();
    if (this.#chrome?.pid && running.includes(this.#chrome.pid))
      try {
        process.kill(-this.#chrome.pid, "SIGTERM");
      } catch {
        /* exited */
      }
    if (
      this.#daemonPid &&
      this.#daemonVerified &&
      running.includes(this.#daemonPid)
    )
      try {
        process.kill(this.#daemonPid, "SIGTERM");
      } catch {
        /* exited */
      }
    const deadline = Date.now() + 5000;
    while ((running = await this.#running()).length && Date.now() < deadline)
      await delay(80);
    for (const pid of running)
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* exited */
      }
    const killedDeadline = Date.now() + 5000;
    while (
      (running = await this.#running()).length &&
      Date.now() < killedDeadline
    )
      await delay(80);
    const pids = [...this.#known].map((pid) => ({
      pid,
      birth: this.#birth.get(pid) ?? null,
      exited: !running.includes(pid),
    }));
    const cdpClosed = this.#cdpPort ? await portClosed(this.#cdpPort) : true;
    const daemonKnown =
      !this.#attempted ||
      !!(
        this.#daemonPid &&
        this.#daemonVerified &&
        !running.includes(this.#daemonPid)
      );
    return {
      pids,
      cdpPort: this.#cdpPort ?? null,
      cdpPortClosed: cdpClosed,
      daemonPid: this.#daemonPid ?? null,
      daemonCommandVerified: this.#daemonVerified,
      actualPidFiles: this.#pidFiles,
      fullyClosed: pids.every((pid) => pid.exited) && cdpClosed && daemonKnown,
    };
  }
}
