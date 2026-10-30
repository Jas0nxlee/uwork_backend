import { createHash, randomBytes } from "node:crypto";
import { createReadStream, realpathSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/identity.js";
import { verifyRestore } from "./verify-restore.js";

/**
 * 无 Docker 的生产仿真：在系统临时目录用合成账号、合成密文和合成账本跑通
 * “真实 HTTP 写入 → online backup → 停源实例 → 独立目录恢复 → verify-restore”，
 * 检查恢复后的任务/账本终态、备份不可覆盖和文件权限。
 * 不启动或重启主服务，不读取仓库 .env 或任何真实凭据，临时资源全部在 finally 清理。
 */
export interface SimulationStep {
  name: string;
  status: "pass" | "fail";
  detail: string;
}
export interface SimulationReport {
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  steps: SimulationStep[];
  boundaries: string[];
}
export interface SimulationOptions {
  keepRoot?: boolean;
}

const BOUNDARIES = [
  "无 Docker：不覆盖容器隔离、镜像、沙箱 driver 或 Compose 行为",
  "不启动主服务：只在进程内以 worker=false 使用 inject 通道",
  "合成账号、合成凭据和合成账本，不代表真实生产数据或供应商账单",
  "本地仿真不能替代真实主机、异地备份和真实企微/MCP/供应商验收",
];

function errorDetail(error: unknown) {
  if (typeof error === "object" && error !== null && "code" in error)
    return `${String(error.code)}: ${error instanceof Error ? error.message : "未知错误"}`;
  return error instanceof Error ? error.message : String(error);
}

async function hashFile(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function readOnly<T>(path: string, sql: string): T[] {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    return (database.prepare(sql).all() as T[]).map((row) => ({ ...row }));
  } finally {
    database.close();
  }
}

export async function runProductionSimulation(
  options: SimulationOptions = {},
): Promise<SimulationReport> {
  const startedAt = new Date().toISOString();
  const steps: SimulationStep[] = [];
  const step = (name: string, status: "pass" | "fail", detail: string) =>
    steps.push({ name, status, detail });
  const run = async (name: string, work: () => Promise<string>) => {
    try {
      const detail = await work();
      step(name, "pass", detail);
      return detail;
    } catch (error) {
      step(name, "fail", errorDetail(error));
      throw error;
    }
  };
  let failure: string | undefined;
  let root: string | undefined;
  try {
    root = await mkdtemp(join(tmpdir(), "uwork-production-simulation-"));
    await chmod(root, 0o700);
    const temporaryRoot = root;
    const sourceDirectory = join(temporaryRoot, "source"),
      backupDirectory = join(temporaryRoot, "backup"),
      restoreDirectory = join(temporaryRoot, "restore");
    await mkdir(sourceDirectory, { mode: 0o700 });
    await mkdir(backupDirectory, { mode: 0o700 });
    await mkdir(restoreDirectory, { mode: 0o700 });
    const database = join(sourceDirectory, "uwork.sqlite"),
      snapshot = join(backupDirectory, "snapshot.sqlite"),
      target = join(restoreDirectory, "uwork.sqlite");
    const masterKey = randomBytes(32),
      email = `simulation-${randomBytes(4).toString("hex")}@example.test`,
      password = randomBytes(24).toString("base64url"),
      credential = `synthetic-${randomBytes(18).toString("base64url")}`;
    await run(
      "temporary-directory",
      async () => `系统临时根目录（0700）已创建`,
    );

    let app: Awaited<ReturnType<typeof createApp>> | undefined;
    try {
      await run("source-instance", async () => {
        app = await createApp({
          database,
          masterKey,
          publicUrl: "http://localhost:3000",
          worker: false,
        });
        return "源实例在进程内以 worker=false 启动（未监听端口）";
      });
      const active = app!;
      const prefix = await run("synthetic-account", async () => {
        const account = await bootstrap(active.services.db, {
          name: "生产仿真企业",
          email,
          password,
        });
        return `/api/tenants/${account.tenantId}`;
      });
      const login = await active.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email, password },
      });
      if (login.statusCode !== 200)
        throw new Error(`合成账号无法登录（HTTP ${login.statusCode}）`);
      const headers = {
        authorization: `Bearer ${(login.json() as { token: string }).token}`,
      };
      await run("synthetic-credential", async () => {
        const created = await active.inject({
          method: "POST",
          url: `${prefix}/credentials`,
          headers,
          payload: { name: "Synthetic", value: credential },
        });
        if (created.statusCode !== 201)
          throw new Error(`写入凭据失败（HTTP ${created.statusCode}）`);
        return "Vault 密文已通过真实 HTTP 写入";
      });
      await run("synthetic-configuration", async () => {
        const saved = await active.inject({
          method: "PUT",
          url: `${prefix}/configurations/new-chat`,
          headers,
          payload: {
            revision: 0,
            data: { welcome: "生产仿真", riskNotice: "重要信息请核实。" },
          },
        });
        if (saved.statusCode !== 200)
          throw new Error(`保存配置草稿失败（HTTP ${saved.statusCode}）`);
        const published = await active.inject({
          method: "POST",
          url: `${prefix}/configurations/new-chat/publish`,
          headers,
          payload: {
            revision: (saved.json() as { revision: number }).revision,
          },
        });
        if (published.statusCode !== 200)
          throw new Error(`发布配置失败（HTTP ${published.statusCode}）`);
        return "new-chat 配置已保存并发布（版本 1）";
      });
      await run("synthetic-work", async () => {
        const tenantId = prefix.slice("/api/tenants/".length);
        const owner = active.services.db.get<{ user_id: string }>(
          "SELECT user_id FROM members WHERE tenant_id=? AND role='owner'",
          tenantId,
        )!.user_id;
        active.services.db.run(
          "INSERT INTO runs(id,tenant_id,user_id,session_id,agent_id,agent_version,status,input,timeout_ms,created_at) VALUES(?,?,?,?,?,1,'running',?,1000,?)",
          "simulation-run",
          tenantId,
          owner,
          "simulation-session",
          "simulation-agent",
          active.services.vault.seal(
            "test",
            `${tenantId}:simulation-run:input`,
          ),
          Date.now(),
        );
        active.services.db.run(
          "INSERT INTO ledger(id,tenant_id,request_key,user_id,application,model_id,period,amount,reserved,status,created_at) VALUES(?,?,?,?,?,?,?,0,100,'reserved',?)",
          "simulation-ledger",
          tenantId,
          "simulation-request",
          owner,
          "simulation",
          "simulation-model",
          "simulation-period",
          Date.now(),
        );
        return "已写入 1 条 running 任务与 1 条 reserved 账本";
      });
      await run("online-backup", async () => {
        await active.services.db.backupTo(snapshot);
        const backupStats = await stat(snapshot);
        if ((backupStats.mode & 0o777) !== 0o600)
          throw new Error(`备份权限 ${backupStats.mode.toString(8)} 不是 0600`);
        let rejected = false;
        try {
          await active.services.db.backupTo(snapshot);
        } catch (error) {
          rejected = /already exists/.test(errorDetail(error));
        }
        if (!rejected) throw new Error("备份目标可被覆盖，应拒绝");
        return "online backup 生成 0600 快照，重复备份被拒绝";
      });
    } finally {
      if (app) await app.close();
    }
    const sourceHash = await hashFile(database);
    await run("source-stopped", async () => {
      const leaseRows = readOnly<{ n: number }>(
        database,
        "SELECT count(*) AS n FROM instance_lease",
      );
      if ((leaseRows[0]?.n ?? 1) !== 0)
        throw new Error("源实例关闭后仍残留实例租约");
      return `源实例已停，租约清零，源库 sha256 ${sourceHash.slice(0, 16)}…`;
    });

    const verification = await verifyRestore({
      snapshot,
      target,
      masterKey,
      email,
      password,
    });
    await run("restore-verification", async () => {
      const failures = verification.checks
        .filter((check) => check.status === "fail")
        .map((check) => check.code);
      if (!verification.ok)
        throw new Error(`verify-restore 失败：${failures.join(",")}`);
      return `独立目录恢复并通过 ${verification.checks.filter((check) => check.status === "pass").length} 项核验`;
    });
    await run("restored-state", async () => {
      const runs = readOnly<{ status: string; error_code: string }>(
        target,
        "SELECT status,error_code FROM runs WHERE id='simulation-run'",
      );
      const ledger = readOnly<{ status: string; amount: number }>(
        target,
        "SELECT status,amount FROM ledger WHERE id='simulation-ledger'",
      );
      const leases = readOnly<{ n: number }>(
        target,
        "SELECT count(*) AS n FROM instance_lease",
      );
      const targetStats = await stat(target);
      if (
        runs[0]?.status !== "failed" ||
        runs[0]?.error_code !== "PROCESS_RESTARTED"
      )
        throw new Error("恢复后 running 任务没有按规则转为 failed");
      if (ledger[0]?.status !== "uncertain" || ledger[0]?.amount !== 100)
        throw new Error("恢复后 reserved 账本没有按规则转为 uncertain");
      if ((leases[0]?.n ?? 1) !== 0) throw new Error("恢复副本仍残留实例租约");
      if ((targetStats.mode & 0o777) !== 0o600)
        throw new Error("恢复副本权限不是 0600");
      return "running→failed(PROCESS_RESTARTED)、reserved→uncertain(amount=100)、租约为空、目标权限 0600";
    });
    await run("source-unchanged", async () => {
      const after = await hashFile(database);
      if (after !== sourceHash) throw new Error("恢复核验改动了源数据库");
      return `源数据库 sha256 未变化（${after.slice(0, 16)}…）`;
    });
  } catch (error) {
    failure = errorDetail(error);
  } finally {
    if (root && !options.keepRoot)
      await rm(root, { recursive: true, force: true });
  }
  step(
    "result",
    failure ? "fail" : "pass",
    failure ? `仿真失败：${failure}` : "端到端仿真全部通过",
  );
  return {
    ok: !failure,
    startedAt,
    finishedAt: new Date().toISOString(),
    steps,
    boundaries: BOUNDARIES,
  };
}

function isMain() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  const report = await runProductionSimulation();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.stderr.write(
    report.ok
      ? "production:simulate 通过（合成数据、无 Docker）\n"
      : `production:simulate 失败：${
          report.steps.find((step) => step.status === "fail")?.detail ?? "未知"
        }\n`,
  );
  process.exitCode = report.ok ? 0 : 1;
}
