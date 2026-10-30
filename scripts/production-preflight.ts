import { lstat, stat } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { privateModelOriginsSchema } from "../src/config.js";

/**
 * 生产配置预检：只解析环境变量并以只读方式检查既有数据库，
 * 不启动服务、不取得实例写租约、不迁移 schema。
 * 输出只包含非秘密信息，绝不回显主密钥、租约 owner 或凭据内容。
 */
export const SUPPORTED_SCHEMA_VERSION = 6;
const LEASE_EXPIRY_MS = 120000;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const COMPOSE_SANDBOX_SOCKET = "/run/uwork-sandbox.sock";
const SHARED_ENGINE_SOCKET = "/var/run/docker.sock";

export type PreflightStatus = "pass" | "fail" | "warn" | "skip";
export interface PreflightCheck {
  code: string;
  status: PreflightStatus;
  detail: string;
}
export interface PreflightReport {
  ok: boolean;
  mode: "production" | "development";
  generatedAt: string;
  checks: PreflightCheck[];
}
export interface PreflightOptions {
  production?: boolean;
  env?: Record<string, string | undefined>;
}
export interface ParsedConfiguration {
  database: string;
  masterKey: Buffer;
  masterKeyHex: string;
  publicUrl: string;
  host: string;
  port: number;
  allowPrivateUpstreams: boolean;
  privateModelOrigins: string[];
  sandboxSocket?: string;
  sandboxImage: string;
  sandboxHostSocket?: string;
  sandboxSocketGid?: string;
}
export type ParseResult =
  | { ok: true; config: ParsedConfiguration }
  | { ok: false; code: string; detail: string };

function invalid(code: string, detail: string): ParseResult {
  return { ok: false, code, detail };
}

/** PUBLIC_URL 的形状问题；undefined 表示符合 config.ts 的 origin 约束。 */
function publicUrlShapeProblem(publicUrl: string): string | undefined {
  let url: URL;
  try {
    url = new URL(publicUrl);
  } catch {
    return "PUBLIC_URL 必须是有效 URL";
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    return "PUBLIC_URL 必须是无凭据、无查询、无片段的 HTTP(S) origin";
  return undefined;
}

/**
 * 与 src/config.ts 的 environment() 保持同一判定：相同输入要么得到相同配置，
 * 要么被同一条规则拒绝。这里返回错误码而不是抛异常，便于预检逐项输出。
 */
export function parseEnvironment(
  env: Record<string, string | undefined>,
): ParseResult {
  const masterKeyRaw = env.MASTER_KEY;
  if (!masterKeyRaw || !/^[0-9a-f]{64}$/i.test(masterKeyRaw))
    return invalid("MASTER_KEY_INVALID", "MASTER_KEY 必须是 64 位十六进制字符");
  const database = env.DATABASE_PATH ?? "data/uwork.sqlite";
  const publicUrl = env.PUBLIC_URL ?? "http://localhost:3000";
  const publicUrlProblem = publicUrlShapeProblem(publicUrl);
  if (publicUrlProblem) return invalid("PUBLIC_URL_INVALID", publicUrlProblem);
  const url = new URL(publicUrl);
  if (!publicUrl.startsWith("https://") && !LOOPBACK_HOSTS.has(url.hostname))
    return invalid("PUBLIC_URL_INSECURE", "非环回 PUBLIC_URL 必须使用 HTTPS");
  const port = Number(env.PORT ?? "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    return invalid("PORT_INVALID", "PORT 必须是 1-65535 的整数");
  const allowPrivateUpstreams = env.ALLOW_PRIVATE_UPSTREAMS ?? "false";
  if (allowPrivateUpstreams !== "true" && allowPrivateUpstreams !== "false")
    return invalid(
      "ALLOW_PRIVATE_UPSTREAMS_INVALID",
      "ALLOW_PRIVATE_UPSTREAMS 只能是 true 或 false",
    );
  const originsRaw = env.PRIVATE_MODEL_ORIGINS ?? "";
  if (originsRaw.length > 8192)
    return invalid(
      "PRIVATE_MODEL_ORIGINS_INVALID",
      "PRIVATE_MODEL_ORIGINS 超过 8192 字符",
    );
  const origins = privateModelOriginsSchema.safeParse(
    originsRaw.trim() ? originsRaw.split(",").map((entry) => entry.trim()) : [],
  );
  if (!origins.success)
    return invalid(
      "PRIVATE_MODEL_ORIGINS_INVALID",
      "PRIVATE_MODEL_ORIGINS 只能是逗号分隔的无凭据 HTTPS origin",
    );
  const sandboxSocket = env.SANDBOX_DOCKER_SOCKET;
  if (sandboxSocket !== undefined && sandboxSocket.length > 512)
    return invalid(
      "SANDBOX_SOCKET_INVALID",
      "SANDBOX_DOCKER_SOCKET 不能超过 512 字符",
    );
  const sandboxImage = env.SANDBOX_IMAGE ?? "uwork-sandbox:local";
  if (sandboxImage.length > 256)
    return invalid("SANDBOX_IMAGE_INVALID", "SANDBOX_IMAGE 不能超过 256 字符");
  return {
    ok: true,
    config: {
      database,
      masterKey: Buffer.from(masterKeyRaw, "hex"),
      masterKeyHex: masterKeyRaw.toLowerCase(),
      publicUrl,
      host: env.HOST ?? "127.0.0.1",
      port,
      allowPrivateUpstreams: allowPrivateUpstreams === "true",
      privateModelOrigins: origins.data,
      sandboxSocket,
      sandboxImage,
      sandboxHostSocket: env.SANDBOX_HOST_SOCKET,
      sandboxSocketGid: env.SANDBOX_SOCKET_GID,
    },
  };
}

function octal(mode: number) {
  return (mode & 0o777).toString(8).padStart(3, "0");
}
function isLoopbackHost(host: string) {
  return LOOPBACK_HOSTS.has(host);
}
function looksLikePlaceholder(hex: string) {
  const lower = hex.toLowerCase();
  if (new Set(lower).size < 8) return true;
  if (lower === "0123456789abcdef".repeat(4)) return true;
  if (/(.)\1{15,}/.test(lower)) return true;
  return lower.slice(0, 32) === lower.slice(32);
}
function errorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : "UNKNOWN";
}
function isUnixSocketPath(socket: string) {
  return isAbsolute(socket) && !socket.includes("\\");
}

async function databasePathChecks(
  databaseRaw: string,
  production: boolean,
): Promise<PreflightCheck[]> {
  const checks: PreflightCheck[] = [];
  const add = (code: string, status: PreflightStatus, detail: string) =>
    checks.push({ code, status, detail });
  const addOptional = (code: string, detail: string) =>
    add(code, production ? "fail" : "warn", detail);
  if (!databaseRaw.trim()) {
    addOptional("DATABASE_PATH", "DATABASE_PATH 不能为空");
    add("DATABASE_DIRECTORY", "skip", "DATABASE_PATH 为空");
    add("DATABASE_PERMISSIONS", "skip", "DATABASE_PATH 为空");
    return checks;
  }
  if (databaseRaw === ":memory:") {
    addOptional(
      "DATABASE_PATH",
      "生产必须使用本机持久卷上的文件数据库，不能是 :memory:",
    );
    add("DATABASE_DIRECTORY", "skip", "内存数据库没有父目录");
    add("DATABASE_PERMISSIONS", "skip", "内存数据库没有文件权限");
    return checks;
  }
  add("DATABASE_PATH", "pass", `数据库路径 ${databaseRaw}`);
  const databasePath = resolve(databaseRaw);
  const parent = dirname(databasePath);
  let parentStats;
  try {
    parentStats = await lstat(parent);
  } catch (error) {
    if (errorCode(error) === "ENOENT")
      addOptional("DATABASE_DIRECTORY", `父目录 ${parent} 不存在`);
    else
      add(
        "DATABASE_DIRECTORY",
        "fail",
        `无法读取父目录 ${parent}（${errorCode(error)}）`,
      );
  }
  if (parentStats) {
    if (parentStats.isSymbolicLink())
      add(
        "DATABASE_DIRECTORY",
        "fail",
        `父目录 ${parent} 是符号链接，生产要求真实目录`,
      );
    else if (!parentStats.isDirectory())
      add("DATABASE_DIRECTORY", "fail", `父目录 ${parent} 不是目录`);
    else add("DATABASE_DIRECTORY", "pass", `父目录 ${parent} 为真实目录`);
  }
  if (!parentStats || !parentStats.isDirectory()) {
    add("DATABASE_PERMISSIONS", "skip", "父目录不可用，未校验权限");
    return checks;
  }
  const problems: string[] = [];
  if ((parentStats.mode & 0o077) !== 0)
    problems.push(`父目录权限 ${octal(parentStats.mode)}`);
  let fileStats;
  try {
    fileStats = await lstat(databasePath);
  } catch (error) {
    if (errorCode(error) !== "ENOENT")
      problems.push(`无法读取数据库文件（${errorCode(error)}）`);
  }
  let fileLabel = "尚未创建";
  if (fileStats) {
    fileLabel = octal(fileStats.mode);
    if (fileStats.isSymbolicLink()) problems.push("数据库文件是符号链接");
    else if (!fileStats.isFile()) problems.push("数据库路径不是普通文件");
    else if ((fileStats.mode & 0o077) !== 0)
      problems.push(`数据库文件权限 ${fileLabel}`);
  }
  add(
    "DATABASE_PERMISSIONS",
    problems.length ? "fail" : "pass",
    problems.length
      ? `权限过宽或类型不符：${problems.join("；")}`
      : `父目录 ${octal(parentStats.mode)}，数据库文件 ${fileLabel}`,
  );
  return checks;
}

async function databaseFileChecks(
  databaseRaw: string,
  production: boolean,
): Promise<PreflightCheck[]> {
  const checks: PreflightCheck[] = [];
  const add = (code: string, status: PreflightStatus, detail: string) =>
    checks.push({ code, status, detail });
  const addOptional = (code: string, detail: string) =>
    add(code, production ? "fail" : "warn", detail);
  if (!databaseRaw.trim() || databaseRaw === ":memory:") {
    for (const code of [
      "DATABASE_INTEGRITY",
      "DATABASE_SCHEMA",
      "DATABASE_LEASE",
    ])
      add(code, "skip", "没有可检查的文件数据库");
    return checks;
  }
  const databasePath = resolve(databaseRaw);
  let exists = false;
  try {
    exists = (await stat(databasePath)).isFile();
  } catch (error) {
    if (errorCode(error) !== "ENOENT") {
      add(
        "DATABASE_INTEGRITY",
        "fail",
        `无法读取数据库文件（${errorCode(error)}）`,
      );
      add("DATABASE_SCHEMA", "skip", "数据库不可读");
      add("DATABASE_LEASE", "skip", "数据库不可读");
      return checks;
    }
  }
  if (!exists) {
    add("DATABASE_INTEGRITY", "skip", "数据库文件尚未创建");
    add("DATABASE_SCHEMA", "skip", "数据库文件尚未创建");
    add("DATABASE_LEASE", "skip", "数据库文件尚未创建");
    return checks;
  }
  let database: DatabaseSync;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
  } catch (error) {
    add(
      "DATABASE_INTEGRITY",
      "fail",
      `无法只读打开数据库（${errorCode(error)}）`,
    );
    add("DATABASE_SCHEMA", "skip", "数据库不可读");
    add("DATABASE_LEASE", "skip", "数据库不可读");
    return checks;
  }
  try {
    try {
      const rows = database.prepare("PRAGMA integrity_check").all() as {
        integrity_check: string;
      }[];
      const healthy = rows.length === 1 && rows[0]?.integrity_check === "ok";
      add(
        "DATABASE_INTEGRITY",
        healthy ? "pass" : "fail",
        healthy
          ? "PRAGMA integrity_check 返回 ok"
          : `PRAGMA integrity_check 失败（${rows.length} 行结果）`,
      );
    } catch (error) {
      add(
        "DATABASE_INTEGRITY",
        "fail",
        `无法校验数据库完整性（${errorCode(error)}）`,
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
          "DATABASE_SCHEMA",
          "skip",
          "数据库尚未初始化（缺少 schema_version）",
        );
      else {
        const version = (
          database
            .prepare("SELECT max(version) AS version FROM schema_version")
            .get() as { version: number | null } | undefined
        )?.version;
        if (version === null || version === undefined)
          add("DATABASE_SCHEMA", "skip", "schema_version 为空");
        else if (version > SUPPORTED_SCHEMA_VERSION)
          add(
            "DATABASE_SCHEMA",
            "fail",
            `数据库 schema 版本 ${version} 高于服务支持的 ${SUPPORTED_SCHEMA_VERSION}`,
          );
        else if (version < SUPPORTED_SCHEMA_VERSION)
          add(
            "DATABASE_SCHEMA",
            "warn",
            `数据库 schema 版本 ${version} 落后，服务启动时会迁移到 ${SUPPORTED_SCHEMA_VERSION}`,
          );
        else
          add(
            "DATABASE_SCHEMA",
            "pass",
            `schema 版本 ${SUPPORTED_SCHEMA_VERSION}`,
          );
      }
    } catch (error) {
      add(
        "DATABASE_SCHEMA",
        "fail",
        `无法读取 schema_version（${errorCode(error)}）`,
      );
    }
    try {
      const table = database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='instance_lease'",
        )
        .get();
      if (!table) add("DATABASE_LEASE", "skip", "数据库尚未初始化（无租约表）");
      else {
        const columns = database
          .prepare("PRAGMA table_info(instance_lease)")
          .all() as { name: string }[];
        const row = database
          .prepare("SELECT * FROM instance_lease WHERE id=1")
          .get() as Record<string, unknown> | undefined;
        const heartbeat = row?.heartbeat_at;
        if (!row) add("DATABASE_LEASE", "pass", "没有实例租约记录");
        else if (
          !columns.some((column) => column.name === "heartbeat_at") ||
          typeof heartbeat !== "number"
        )
          addOptional(
            "DATABASE_LEASE",
            "租约表缺少心跳字段，无法确认是否有活动实例，启动前需人工确认",
          );
        else {
          const age = Date.now() - heartbeat;
          if (age < LEASE_EXPIRY_MS)
            add(
              "DATABASE_LEASE",
              "fail",
              `存在活动实例租约（pid ${String(row.pid)}，心跳 ${Math.max(0, Math.round(age / 1000))} 秒前）；请先停止该实例`,
            );
          else
            add(
              "DATABASE_LEASE",
              "warn",
              `租约已过期（心跳 ${Math.round(age / 1000)} 秒前），服务启动时会按租约规则接管`,
            );
        }
      }
    } catch (error) {
      add("DATABASE_LEASE", "fail", `无法读取实例租约（${errorCode(error)}）`);
    }
  } finally {
    database.close();
  }
  return checks;
}

export async function runPreflight(
  options: PreflightOptions = {},
): Promise<PreflightReport> {
  const production = options.production ?? false;
  const env = options.env ?? process.env;
  const checks: PreflightCheck[] = [];
  const add = (code: string, status: PreflightStatus, detail: string) =>
    checks.push({ code, status, detail });
  const addOptional = (code: string, detail: string) =>
    add(code, production ? "fail" : "warn", detail);
  const parsed = parseEnvironment(env);
  const config = parsed.ok ? parsed.config : undefined;
  const databaseRaw = env.DATABASE_PATH ?? "data/uwork.sqlite";

  if (parsed.ok) add("CONFIG_PARSE", "pass", "环境变量按服务解析规则通过");
  else add("CONFIG_PARSE", "fail", `${parsed.code}: ${parsed.detail}`);

  if (!parsed.ok && parsed.code === "MASTER_KEY_INVALID")
    add(
      "MASTER_KEY_SHAPE",
      "fail",
      "MASTER_KEY 必须是 64 位十六进制字符且不是占位值",
    );
  else if (config && looksLikePlaceholder(config.masterKeyHex))
    add(
      "MASTER_KEY_SHAPE",
      "fail",
      "MASTER_KEY 疑似示例/占位值，必须在目标环境重新生成随机密钥",
    );
  else add("MASTER_KEY_SHAPE", "pass", "64 位十六进制，且不是已知占位值");

  checks.push(...(await databasePathChecks(databaseRaw, production)));

  const rawPublicUrl = env.PUBLIC_URL ?? "http://localhost:3000";
  const shapeProblem = publicUrlShapeProblem(rawPublicUrl);
  const publicHostname = shapeProblem
    ? undefined
    : new URL(rawPublicUrl).hostname;

  if (shapeProblem) add("PUBLIC_URL_SHAPE", "fail", shapeProblem);
  else add("PUBLIC_URL_SHAPE", "pass", `公开地址 ${rawPublicUrl}`);

  if (!production)
    add("PUBLIC_URL_HTTPS", "skip", "仅生产模式校验 HTTPS 公开地址");
  else if (shapeProblem)
    add("PUBLIC_URL_HTTPS", "skip", "公开地址格式无效，未校验 HTTPS");
  else if (rawPublicUrl.startsWith("https://"))
    add("PUBLIC_URL_HTTPS", "pass", "公开地址为 HTTPS");
  else if (publicHostname && LOOPBACK_HOSTS.has(publicHostname))
    add("PUBLIC_URL_HTTPS", "pass", "公开地址位于环回地址，允许 HTTP");
  else add("PUBLIC_URL_HTTPS", "fail", "非环回 PUBLIC_URL 必须使用 HTTPS");

  if (!production) add("HOST_EXPOSURE", "skip", "仅生产模式校验公开暴露边界");
  else if (shapeProblem)
    add("HOST_EXPOSURE", "skip", "公开地址格式无效，未校验监听边界");
  else {
    const host = env.HOST ?? "127.0.0.1";
    if (isLoopbackHost(host))
      add("HOST_EXPOSURE", "pass", `HOST ${host} 只监听环回地址`);
    else if (!rawPublicUrl.startsWith("https://"))
      add(
        "HOST_EXPOSURE",
        "fail",
        `HOST ${host} 监听非环回地址，但 PUBLIC_URL 不是 HTTPS，会明文暴露`,
      );
    else if (publicHostname && LOOPBACK_HOSTS.has(publicHostname))
      add(
        "HOST_EXPOSURE",
        "warn",
        `HOST ${host} 监听非环回地址，但 PUBLIC_URL 指向环回地址，外部访问边界不明确`,
      );
    else add("HOST_EXPOSURE", "pass", `HOST ${host} 与 HTTPS 公开地址配合`);
  }

  if (!parsed.ok && parsed.code === "ALLOW_PRIVATE_UPSTREAMS_INVALID")
    add("PRIVATE_UPSTREAMS", "fail", parsed.detail);
  else if (config?.allowPrivateUpstreams)
    addOptional(
      "PRIVATE_UPSTREAMS",
      "ALLOW_PRIVATE_UPSTREAMS=true 会允许访问私网上游，生产必须保持关闭",
    );
  else add("PRIVATE_UPSTREAMS", "pass", "ALLOW_PRIVATE_UPSTREAMS=false");

  if (!parsed.ok && parsed.code === "PRIVATE_MODEL_ORIGINS_INVALID")
    add("PRIVATE_MODEL_ORIGINS", "fail", parsed.detail);
  else if (config?.privateModelOrigins.length)
    add(
      "PRIVATE_MODEL_ORIGINS",
      "pass",
      `已配置 ${config.privateModelOrigins.length} 个显式 HTTPS origin`,
    );
  else add("PRIVATE_MODEL_ORIGINS", "pass", "未配置私有模型 origin");

  const socket = config?.sandboxSocket?.trim();
  if (!socket) add("SANDBOX_SOCKET_PATH", "skip", "未配置专用沙箱 socket");
  else if (!isUnixSocketPath(socket))
    add(
      "SANDBOX_SOCKET_PATH",
      "fail",
      "SANDBOX_DOCKER_SOCKET 必须是绝对 Unix socket 路径，不能是命名管道",
    );
  else add("SANDBOX_SOCKET_PATH", "pass", `沙箱 socket ${socket}`);

  if (!socket) add("SANDBOX_SOCKET_STATE", "skip", "未配置专用沙箱 socket");
  else if (!isUnixSocketPath(socket))
    add("SANDBOX_SOCKET_STATE", "skip", "socket 路径无效，未检查文件状态");
  else {
    let socketStats;
    try {
      socketStats = await stat(socket);
    } catch (error) {
      if (errorCode(error) === "ENOENT")
        addOptional("SANDBOX_SOCKET_STATE", `socket ${socket} 不存在`);
      else
        add(
          "SANDBOX_SOCKET_STATE",
          "fail",
          `无法读取 socket ${socket}（${errorCode(error)}）`,
        );
    }
    if (socketStats) {
      if (!socketStats.isSocket())
        add("SANDBOX_SOCKET_STATE", "fail", `${socket} 不是 Unix socket`);
      else if ((socketStats.mode & 0o002) !== 0)
        add(
          "SANDBOX_SOCKET_STATE",
          "fail",
          `socket 权限 ${octal(socketStats.mode)} 允许任意用户写入`,
        );
      else
        add(
          "SANDBOX_SOCKET_STATE",
          "pass",
          `Unix socket，权限 ${octal(socketStats.mode)}，非 world-writable`,
        );
    }
  }

  if (!socket) add("SANDBOX_SOCKET_GROUP", "skip", "未配置专用沙箱 socket");
  else {
    const hostSocket = config?.sandboxHostSocket?.trim();
    const gid = config?.sandboxSocketGid?.trim();
    const problems: string[] = [];
    if (hostSocket && !hostSocket.startsWith("/"))
      problems.push("SANDBOX_HOST_SOCKET 必须是绝对路径");
    if (gid !== undefined && !/^\d+$/.test(gid))
      problems.push("SANDBOX_SOCKET_GID 必须是数字");
    if (socket === COMPOSE_SANDBOX_SOCKET) {
      if (!hostSocket)
        problems.push("Compose 专用 socket 缺少 SANDBOX_HOST_SOCKET");
      if (!gid) problems.push("Compose 专用 socket 缺少 SANDBOX_SOCKET_GID");
    }
    add(
      "SANDBOX_SOCKET_GROUP",
      problems.length ? "fail" : "pass",
      problems.length ? problems.join("；") : "socket 路径与 GID 变量完整",
    );
  }

  if (!socket) add("SANDBOX_SOCKET_ENGINE", "skip", "未配置专用沙箱 socket");
  else if (resolve(socket) === SHARED_ENGINE_SOCKET)
    addOptional(
      "SANDBOX_SOCKET_ENGINE",
      "沙箱不能共享主机默认 Docker engine socket，必须使用专用 engine",
    );
  else
    add(
      "SANDBOX_SOCKET_ENGINE",
      "pass",
      "使用专用沙箱 socket，不是主机默认 engine",
    );

  checks.push(...(await databaseFileChecks(databaseRaw, production)));

  return {
    ok: checks.every((check) => check.status !== "fail"),
    mode: production ? "production" : "development",
    generatedAt: new Date().toISOString(),
    checks,
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

async function main(argv: string[]) {
  const unknown = argv.filter((argument) => argument !== "--production");
  if (unknown.length) {
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: false,
          mode: "development",
          generatedAt: new Date().toISOString(),
          checks: [
            {
              code: "USAGE",
              status: "fail",
              detail: `未知参数：${unknown.join(" ")}；仅支持 --production`,
            },
          ],
        },
        null,
        2,
      )}\n`,
    );
    return 2;
  }
  const report = await runPreflight({
    production: argv.includes("--production"),
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.ok) {
    process.stderr.write(
      `preflight ${report.mode}: 通过 ${report.checks.filter((check) => check.status === "pass").length} 项检查\n`,
    );
  } else {
    const failures = report.checks
      .filter((check) => check.status === "fail")
      .map((check) => check.code);
    process.stderr.write(
      `preflight ${report.mode}: 失败 ${failures.join(",")}\n`,
    );
  }
  return report.ok ? 0 : 1;
}

if (isMain()) process.exitCode = await main(process.argv.slice(2));
