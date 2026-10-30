import { createHash } from "node:crypto";
import { createReadStream, realpathSync } from "node:fs";
import { chmod, copyFile, constants, lstat, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "../src/app.js";

/**
 * 备份恢复核验：在独立目标路径上复制快照并逐项验证，绝不修改源快照。
 * 默认拒绝覆盖已有目标，失败时清理自己创建的临时目标。
 * 报告不包含主密钥、登录口令或凭据明文。
 */
export const SUPPORTED_SCHEMA_VERSION = 6;
const REQUIRED_TABLES = [
  "schema_version",
  "instance_lease",
  "tenants",
  "users",
  "members",
  "credentials",
  "ledger",
  "configurations",
  "configuration_history",
  "runs",
  "resources",
  "sandbox_runtimes",
  "conversation_shares",
] as const;
const LEDGER_STATUSES = new Set(["settled", "uncertain", "released"]);

export type RestoreStatus = "pass" | "fail" | "skip";
export interface RestoreCheck {
  code: string;
  status: RestoreStatus;
  detail: string;
}
export interface RestoreVerification {
  ok: boolean;
  snapshot: string;
  target: string;
  snapshotSha256?: string;
  restored?: {
    tenants: number;
    users: number;
    publishedVersions: Record<string, number>;
    runsFailed: number;
    ledgerUncertain: number;
  };
  checks: RestoreCheck[];
}
export interface RestoreOptions {
  snapshot: string;
  target: string;
  masterKey: Buffer;
  email: string;
  password: string;
  publicUrl?: string;
  removeTargetOnFailure?: boolean;
}

const CANDIDATE_CHECKS = [
  "TARGET_IS_SNAPSHOT",
  "TARGET_EXISTS",
  "TARGET_DIRECTORY",
  "TARGET_DIRECTORY_PERMISSIONS",
  "TARGET_COPY",
  "TARGET_PERMISSIONS",
  "INTEGRITY",
  "FOREIGN_KEYS",
  "SCHEMA_VERSION",
  "REQUIRED_TABLES",
  "APPLICATION_START",
  "LOGIN",
  "VAULT_DECRYPTION",
  "PUBLISHED_CONFIGURATION",
  "RUN_STATE",
  "LEDGER_STATE",
  "LEASE_RELEASED",
] as const;

function octal(mode: number) {
  return (mode & 0o777).toString(8).padStart(3, "0");
}
function errorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : "UNKNOWN";
}
function errorDetail(error: unknown) {
  return error instanceof Error && error.message
    ? `${errorCode(error)}: ${error.message}`
    : errorCode(error);
}

async function digestOf(path: string): Promise<string | undefined> {
  try {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    return hash.digest("hex");
  } catch {
    return undefined;
  }
}

async function removeRestored(target: string) {
  for (const suffix of ["", "-wal", "-shm", "-journal"])
    await rm(`${target}${suffix}`, { force: true });
}

export async function verifyRestore(
  options: RestoreOptions,
): Promise<RestoreVerification> {
  const checks: RestoreCheck[] = [];
  const add = (code: string, status: RestoreStatus, detail: string) =>
    checks.push({ code, status, detail });
  const skip = (codes: readonly string[], detail: string) => {
    for (const code of codes)
      if (!checks.some((entry) => entry.code === code))
        add(code, "skip", detail);
  };
  const failed = () => checks.some((entry) => entry.status === "fail");
  const snapshot = resolve(options.snapshot);
  const target = resolve(options.target);
  const removeOnFailure = options.removeTargetOnFailure !== false;
  const progress: {
    snapshotSha256?: string;
    restored?: RestoreVerification["restored"];
  } = {};
  let targetCreated = false;

  const finish = async (): Promise<RestoreVerification> => {
    const after = await digestOf(snapshot);
    if (!progress.snapshotSha256 || !after)
      add("SNAPSHOT_UNCHANGED", "skip", "快照不可读，无法比对内容摘要");
    else
      add(
        "SNAPSHOT_UNCHANGED",
        after === progress.snapshotSha256 ? "pass" : "fail",
        after === progress.snapshotSha256
          ? `快照 sha256 未变化（${progress.snapshotSha256.slice(0, 16)}…）`
          : "快照内容在核验期间发生变化",
      );
    const ok = !failed();
    if (!ok && targetCreated && removeOnFailure) {
      await removeRestored(target);
      targetCreated = false;
    }
    return {
      ok,
      snapshot,
      target,
      snapshotSha256: progress.snapshotSha256,
      restored: progress.restored,
      checks,
    };
  };

  let snapshotStats;
  try {
    snapshotStats = await stat(snapshot);
  } catch (error) {
    add(
      "SNAPSHOT_STATE",
      "fail",
      errorCode(error) === "ENOENT"
        ? `快照不存在：${snapshot}`
        : `无法读取快照（${errorDetail(error)}）`,
    );
  }
  if (!snapshotStats) {
    add("SNAPSHOT_PERMISSIONS", "skip", "快照不可读，未校验权限");
    skip(CANDIDATE_CHECKS, "快照不可用，未执行");
    return await finish();
  }
  if (!snapshotStats.isFile()) {
    add("SNAPSHOT_STATE", "fail", `快照不是普通文件：${snapshot}`);
    add("SNAPSHOT_PERMISSIONS", "skip", "快照不是普通文件，未校验权限");
    skip(CANDIDATE_CHECKS, "快照不可用，未执行");
    return await finish();
  }
  add("SNAPSHOT_STATE", "pass", `快照为普通文件：${snapshot}`);
  progress.snapshotSha256 = await digestOf(snapshot);
  if ((snapshotStats.mode & 0o077) !== 0)
    add(
      "SNAPSHOT_PERMISSIONS",
      "fail",
      `快照权限 ${octal(snapshotStats.mode)} 允许同组或其他用户访问，应保持 0600`,
    );
  else
    add(
      "SNAPSHOT_PERMISSIONS",
      "pass",
      `快照权限 ${octal(snapshotStats.mode)}`,
    );

  const snapshotParent = dirname(snapshot);
  let snapshotParentStats;
  try {
    snapshotParentStats = await lstat(snapshotParent);
  } catch (error) {
    add(
      "SNAPSHOT_DIRECTORY",
      "fail",
      `无法读取快照目录 ${snapshotParent}（${errorCode(error)}）`,
    );
  }
  if (snapshotParentStats) {
    if (!snapshotParentStats.isDirectory())
      add("SNAPSHOT_DIRECTORY", "fail", `快照目录 ${snapshotParent} 不是目录`);
    else if ((snapshotParentStats.mode & 0o077) !== 0)
      add(
        "SNAPSHOT_DIRECTORY",
        "fail",
        `快照目录权限 ${octal(snapshotParentStats.mode)} 允许同组或其他用户访问`,
      );
    else
      add(
        "SNAPSHOT_DIRECTORY",
        "pass",
        `快照目录 ${snapshotParent} 权限 ${octal(snapshotParentStats.mode)}`,
      );
  }
  if (failed()) {
    skip(CANDIDATE_CHECKS, "快照权限或目录不合格，拒绝在不可信输入上恢复");
    return await finish();
  }

  if (snapshot === target)
    add("TARGET_IS_SNAPSHOT", "fail", "目标路径不能是快照本身");
  else add("TARGET_IS_SNAPSHOT", "pass", "目标与快照是不同路径");

  let targetExists = false;
  try {
    await lstat(target);
    targetExists = true;
  } catch (error) {
    if (errorCode(error) !== "ENOENT")
      add("TARGET_EXISTS", "fail", `无法检查目标路径（${errorDetail(error)}）`);
  }
  if (targetExists)
    add("TARGET_EXISTS", "fail", `目标已存在，拒绝覆盖：${target}`);
  else if (!checks.some((entry) => entry.code === "TARGET_EXISTS"))
    add("TARGET_EXISTS", "pass", "目标尚未存在，可以安全恢复");

  const targetParent = dirname(target);
  let targetParentStats;
  try {
    targetParentStats = await lstat(targetParent);
  } catch (error) {
    add(
      "TARGET_DIRECTORY",
      "fail",
      `目标目录 ${targetParent} 不存在或不可读（${errorCode(error)}）`,
    );
  }
  if (targetParentStats) {
    if (!targetParentStats.isDirectory())
      add("TARGET_DIRECTORY", "fail", `目标目录 ${targetParent} 不是目录`);
    else add("TARGET_DIRECTORY", "pass", `目标目录 ${targetParent} 可用`);
  }
  if (targetParentStats?.isDirectory()) {
    if ((targetParentStats.mode & 0o077) !== 0)
      add(
        "TARGET_DIRECTORY_PERMISSIONS",
        "fail",
        `目标目录权限 ${octal(targetParentStats.mode)} 过宽，应保持 0700 级别`,
      );
    else
      add(
        "TARGET_DIRECTORY_PERMISSIONS",
        "pass",
        `目标目录权限 ${octal(targetParentStats.mode)}`,
      );
  } else {
    add("TARGET_DIRECTORY_PERMISSIONS", "skip", "目标目录不可用，未校验权限");
  }
  if (failed()) {
    skip(CANDIDATE_CHECKS.slice(4), "目标路径不合格，未创建任何恢复副本");
    return await finish();
  }

  try {
    await copyFile(snapshot, target, constants.COPYFILE_EXCL);
    targetCreated = true;
    await chmod(target, 0o600);
    add("TARGET_COPY", "pass", `已复制快照到独立目标 ${target}`);
  } catch (error) {
    add("TARGET_COPY", "fail", `复制快照失败（${errorDetail(error)}）`);
    await removeRestored(target);
    skip(CANDIDATE_CHECKS.slice(5), "复制失败，未继续验证");
    return await finish();
  }
  const targetStats = await stat(target);
  if ((targetStats.mode & 0o777) === 0o600)
    add("TARGET_PERMISSIONS", "pass", "恢复副本权限 0600");
  else
    add(
      "TARGET_PERMISSIONS",
      "fail",
      `恢复副本权限 ${octal(targetStats.mode)}，应为 0600`,
    );

  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(target, { readOnly: true });
  } catch (error) {
    add("INTEGRITY", "fail", `无法只读打开恢复副本（${errorDetail(error)}）`);
    add("FOREIGN_KEYS", "skip", "数据库不可读");
    add("SCHEMA_VERSION", "skip", "数据库不可读");
    add("REQUIRED_TABLES", "skip", "数据库不可读");
  }
  let runningBefore = 0,
    reservedBefore = 0;
  if (database) {
    try {
      try {
        const rows = database.prepare("PRAGMA integrity_check").all() as {
          integrity_check: string;
        }[];
        const healthy = rows.length === 1 && rows[0]?.integrity_check === "ok";
        add(
          "INTEGRITY",
          healthy ? "pass" : "fail",
          healthy
            ? "PRAGMA integrity_check 返回 ok"
            : `PRAGMA integrity_check 返回 ${rows.length} 行异常结果`,
        );
      } catch (error) {
        add("INTEGRITY", "fail", `完整性检查无法执行（${errorDetail(error)}）`);
      }
      try {
        const violations = database.prepare("PRAGMA foreign_key_check").all();
        add(
          "FOREIGN_KEYS",
          violations.length === 0 ? "pass" : "fail",
          violations.length === 0
            ? "无外键违规"
            : `存在 ${violations.length} 条外键违规`,
        );
      } catch (error) {
        add(
          "FOREIGN_KEYS",
          "fail",
          `外键检查无法执行（${errorDetail(error)}）`,
        );
      }
      try {
        const table = database
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'",
          )
          .get();
        if (!table)
          add(
            "SCHEMA_VERSION",
            "fail",
            "缺少 schema_version，快照不是本服务数据库",
          );
        else {
          const version = (
            database
              .prepare("SELECT max(version) AS version FROM schema_version")
              .get() as { version: number | null } | undefined
          )?.version;
          if (version === SUPPORTED_SCHEMA_VERSION)
            add("SCHEMA_VERSION", "pass", `schema 版本 ${version}`);
          else
            add(
              "SCHEMA_VERSION",
              "fail",
              `schema 版本 ${String(version)}，恢复核验要求 ${SUPPORTED_SCHEMA_VERSION}`,
            );
        }
      } catch (error) {
        add(
          "SCHEMA_VERSION",
          "fail",
          `无法读取 schema_version（${errorDetail(error)}）`,
        );
      }
      try {
        const present = new Set(
          (
            database
              .prepare("SELECT name FROM sqlite_master WHERE type='table'")
              .all() as { name: string }[]
          ).map((row) => row.name),
        );
        const missing = REQUIRED_TABLES.filter((name) => !present.has(name));
        add(
          "REQUIRED_TABLES",
          missing.length ? "fail" : "pass",
          missing.length
            ? `缺少关键表：${missing.join("、")}`
            : `${REQUIRED_TABLES.length} 张关键表齐全`,
        );
      } catch (error) {
        add(
          "REQUIRED_TABLES",
          "fail",
          `表清单无法读取（${errorDetail(error)}）`,
        );
      }
      if (!failed()) {
        runningBefore =
          (
            database
              .prepare("SELECT count(*) AS n FROM runs WHERE status='running'")
              .get() as { n: number } | undefined
          )?.n ?? 0;
        reservedBefore =
          (
            database
              .prepare(
                "SELECT count(*) AS n FROM ledger WHERE status='reserved'",
              )
              .get() as { n: number } | undefined
          )?.n ?? 0;
      }
    } finally {
      database.close();
    }
  }
  if (failed()) {
    skip(CANDIDATE_CHECKS.slice(10), "恢复副本静态检查失败，未启动应用");
    return await finish();
  }

  const publicUrl = options.publicUrl ?? "http://localhost:3000";
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    app = await createApp({
      database: target,
      masterKey: options.masterKey,
      publicUrl,
      worker: false,
    });
    add("APPLICATION_START", "pass", "应用以 worker=false 在恢复副本上启动");
  } catch (error) {
    add(
      "APPLICATION_START",
      "fail",
      `恢复副本无法启动（${errorDetail(error)}）`,
    );
  }
  if (!app) {
    skip(CANDIDATE_CHECKS.slice(11), "恢复副本无法启动，未验证业务读取");
    return await finish();
  }

  const summary = {
    tenants: 0,
    users: 0,
    publishedVersions: {} as Record<string, number>,
    runsFailed: runningBefore,
    ledgerUncertain: reservedBefore,
  };
  let leaseReleased = false;
  try {
    let token: string | undefined;
    try {
      const login = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email: options.email, password: options.password },
      });
      if (login.statusCode === 200) {
        token = (login.json() as { token?: string }).token;
        add("LOGIN", "pass", "bootstrap 账号可以在恢复副本上登录");
      } else {
        const code =
          (login.json() as { error?: { code?: string } }).error?.code ??
          "UNKNOWN";
        add("LOGIN", "fail", `登录失败（HTTP ${login.statusCode}，${code}）`);
      }
    } catch (error) {
      add("LOGIN", "fail", `登录请求失败（${errorDetail(error)}）`);
    }

    try {
      const credential = app.services.db.get<{
        id: string;
        tenant_id: string;
      }>(
        "SELECT id,tenant_id FROM credentials WHERE revoked=0 ORDER BY created_at LIMIT 1",
      );
      if (!credential)
        add("VAULT_DECRYPTION", "skip", "恢复副本没有可解密的凭据");
      else {
        const value = app.services.vault.read(
          credential.tenant_id,
          credential.id,
        );
        add(
          "VAULT_DECRYPTION",
          "pass",
          `凭据密文解密成功（${value.length} 字符，内容不输出）`,
        );
      }
    } catch (error) {
      add(
        "VAULT_DECRYPTION",
        "fail",
        `凭据无法用提供的主密钥解密（${errorDetail(error)}）`,
      );
    }

    try {
      if (!token)
        add(
          "PUBLISHED_CONFIGURATION",
          "skip",
          "缺少登录令牌，未读取已发布配置",
        );
      else {
        const response = await app.inject({
          method: "GET",
          url: "/api/client/configuration",
          headers: { authorization: `Bearer ${token}` },
        });
        if (response.statusCode !== 200)
          add(
            "PUBLISHED_CONFIGURATION",
            "fail",
            `读取已发布配置失败（HTTP ${response.statusCode}）`,
          );
        else {
          const body = response.json() as {
            configuration?: Record<string, unknown>;
            versions?: Record<string, number>;
          };
          summary.publishedVersions = body.versions ?? {};
          const published = Object.keys(summary.publishedVersions).filter(
            (kind) => (summary.publishedVersions[kind] ?? 0) > 0,
          );
          const missing = published.filter(
            (kind) => !(kind in (body.configuration ?? {})),
          );
          const history =
            app.services.db.get<{ n: number }>(
              "SELECT count(*) AS n FROM configuration_history",
            )?.n ?? 0;
          if (missing.length)
            add(
              "PUBLISHED_CONFIGURATION",
              "fail",
              `已发布配置缺少内容：${missing.join("、")}`,
            );
          else if (published.length && history === 0)
            add(
              "PUBLISHED_CONFIGURATION",
              "fail",
              "存在已发布版本但缺少发布历史",
            );
          else
            add(
              "PUBLISHED_CONFIGURATION",
              "pass",
              published.length
                ? `已发布 ${published.length} 类配置，版本 ${published
                    .map((kind) => `${kind}=${summary.publishedVersions[kind]}`)
                    .join("、")}，发布历史 ${history} 条`
                : "没有已发布版本，返回默认配置",
            );
        }
      }
    } catch (error) {
      add(
        "PUBLISHED_CONFIGURATION",
        "fail",
        `读取已发布配置失败（${errorDetail(error)}）`,
      );
    }

    try {
      const runningAfter =
        app.services.db.get<{ n: number }>(
          "SELECT count(*) AS n FROM runs WHERE status='running'",
        )?.n ?? 0;
      const recovered =
        app.services.db.get<{ n: number }>(
          "SELECT count(*) AS n FROM runs WHERE status='failed' AND error_code='PROCESS_RESTARTED'",
        )?.n ?? 0;
      if (runningAfter)
        add(
          "RUN_STATE",
          "fail",
          `恢复后仍有 ${runningAfter} 条 running 任务，应按既有规则转为 failed`,
        );
      else
        add(
          "RUN_STATE",
          "pass",
          `没有残留 running 任务（PROCESS_RESTARTED 失败 ${recovered} 条，启动前 running ${runningBefore} 条）`,
        );
    } catch (error) {
      add("RUN_STATE", "fail", `任务状态无法读取（${errorDetail(error)}）`);
    }

    try {
      const rows = app.services.db.all<{ status: string; n: number }>(
        "SELECT status,count(*) AS n FROM ledger GROUP BY status",
      );
      const reserved = rows.find((row) => row.status === "reserved")?.n ?? 0;
      const unknown = rows.filter((row) => !LEDGER_STATUSES.has(row.status));
      const uncertain = rows.find((row) => row.status === "uncertain")?.n ?? 0;
      if (reserved)
        add(
          "LEDGER_STATE",
          "fail",
          `恢复后仍有 ${reserved} 条 reserved 账本，应按既有规则转为 uncertain`,
        );
      else if (unknown.length)
        add(
          "LEDGER_STATE",
          "fail",
          `存在未知账本状态：${unknown.map((row) => row.status).join("、")}`,
        );
      else
        add(
          "LEDGER_STATE",
          "pass",
          `账本状态可读（启动前 reserved ${reservedBefore} 条，现 uncertain ${uncertain} 条）`,
        );
    } catch (error) {
      add("LEDGER_STATE", "fail", `账本状态无法读取（${errorDetail(error)}）`);
    }

    summary.tenants =
      app.services.db.get<{ n: number }>("SELECT count(*) AS n FROM tenants")
        ?.n ?? 0;
    summary.users =
      app.services.db.get<{ n: number }>("SELECT count(*) AS n FROM users")
        ?.n ?? 0;
  } finally {
    try {
      await app.close();
      leaseReleased = true;
    } catch (error) {
      add(
        "LEASE_RELEASED",
        "fail",
        `关闭恢复实例失败（${errorDetail(error)}）`,
      );
    }
  }
  progress.restored = summary;

  if (leaseReleased) {
    try {
      const check = new DatabaseSync(target, { readOnly: true });
      try {
        const leases =
          (
            check.prepare("SELECT count(*) AS n FROM instance_lease").get() as
              | { n: number }
              | undefined
          )?.n ?? 0;
        add(
          "LEASE_RELEASED",
          leases === 0 ? "pass" : "fail",
          leases === 0
            ? "恢复核验结束后实例租约已释放"
            : `恢复副本仍有 ${leases} 条实例租约`,
        );
      } finally {
        check.close();
      }
    } catch (error) {
      add(
        "LEASE_RELEASED",
        "fail",
        `无法确认实例租约状态（${errorDetail(error)}）`,
      );
    }
  }

  return await finish();
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

function usage(detail: string): RestoreVerification {
  return {
    ok: false,
    snapshot: "",
    target: "",
    checks: [{ code: "USAGE", status: "fail" as const, detail }],
  };
}

async function main(argv: string[]): Promise<{ exit: number }> {
  const values = new Map<string, string>();
  const report = async (): Promise<RestoreVerification> => {
    const snapshot = values.get("snapshot"),
      target = values.get("target");
    const masterKey = process.env.MASTER_KEY;
    const email = values.get("email") ?? process.env.BOOTSTRAP_EMAIL;
    const password = values.get("password") ?? process.env.BOOTSTRAP_PASSWORD;
    if (!snapshot || !target)
      return usage("用法：--snapshot <快照路径> --target <目标路径>");
    if (!masterKey || !/^[0-9a-f]{64}$/i.test(masterKey))
      return usage("需要在环境变量 MASTER_KEY 提供 64 位十六进制主密钥");
    if (!email || !password)
      return usage(
        "需要 bootstrap 登录凭据：--email/--password 或 BOOTSTRAP_EMAIL/BOOTSTRAP_PASSWORD",
      );
    return await verifyRestore({
      snapshot,
      target,
      masterKey: Buffer.from(masterKey, "hex"),
      email,
      password,
      publicUrl: values.get("public-url"),
    });
  };
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined) {
      printReport(usage(`未知或不完整参数：${flag ?? ""}`));
      return { exit: 2 };
    }
    values.set(flag.slice(2), value);
  }
  const result = await report();
  printReport(result);
  return {
    exit: result.ok ? 0 : result.checks.some((c) => c.code === "USAGE") ? 2 : 1,
  };
}

function printReport(report: RestoreVerification) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.ok) {
    process.stderr.write(`verify:restore 通过：${report.target}\n`);
  } else {
    process.stderr.write(
      `verify:restore 失败：${report.checks
        .filter((check) => check.status === "fail")
        .map((check) => check.code)
        .join(",")}\n`,
    );
  }
}

if (isMain()) {
  const result = await main(process.argv.slice(2));
  process.exitCode = result.exit;
}
