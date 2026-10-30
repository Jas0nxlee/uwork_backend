import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * 发布门禁回归：干净 checkout 下根 npm ci 之后，根 typecheck 会拉入
 * 静态引用 clients/uwork 源码的脚本。门禁必须在 CI 里安装客户端锁定的
 * pnpm workspace 并生成声明产物，而不是删除或排除这些脚本。
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readJson<T>(path: string): T {
  const absolute = join(root, path);
  assert.ok(existsSync(absolute), `缺少文件 ${path}`);
  return JSON.parse(readFileSync(absolute, "utf8")) as T;
}

function readText(path: string): string {
  const absolute = join(root, path);
  assert.ok(existsSync(absolute), `缺少文件 ${path}`);
  return readFileSync(absolute, "utf8");
}

function toPosix(path: string): string {
  return path.split(sep).join("/");
}

function typescriptSources(directory: string): string[] {
  const absolute = join(root, directory);
  return readdirSync(absolute, { recursive: true })
    .map((entry) => toPosix(String(entry)))
    .filter((entry) => entry.endsWith(".ts"))
    .map((entry) => `${directory}/${entry}`)
    .sort();
}

function workflowJob(name: string): string {
  const lines = readText(".github/workflows/backend.yml").split("\n");
  const start = lines.findIndex((line) =>
    new RegExp(`^ {2}${name}:\\s*$`).test(line),
  );
  assert.ok(start >= 0, `工作流缺少 ${name} job`);
  const body: string[] = [];
  for (let index = start + 1; index < lines.length; index++) {
    const line = lines[index]!;
    if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(line) || /^\S/.test(line)) break;
    body.push(line);
  }
  return body.join("\n");
}

function versionParts(version: string): number[] {
  return version
    .split("-")[0]!
    .split(".")
    .map((part) => Number.parseInt(part, 10));
}

function gte(version: string, minimum: string): boolean {
  const left = versionParts(version);
  const right = versionParts(minimum);
  for (let index = 0; index < 3; index++) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
}

test("verify job 在根 typecheck 前安装锁定的客户端 pnpm workspace 并生成声明产物", () => {
  const job = workflowJob("verify");
  const clientPackageManager = readJson<{ packageManager?: string }>(
    "clients/uwork/package.json",
  ).packageManager;
  assert.match(
    clientPackageManager ?? "",
    /^pnpm@\d+\.\d+\.\d+$/,
    "客户端必须锁定 pnpm 版本",
  );
  const pinnedPnpm = clientPackageManager!.slice("pnpm@".length);
  const position = (needle: string): number => {
    const found = job.indexOf(needle);
    assert.ok(found >= 0, `verify job 缺少步骤：${needle}`);
    return found;
  };
  const rootInstall = position("npm ci --ignore-scripts");
  const pnpmSetup = position("pnpm/action-setup@v4");
  const pnpmPin = position(`version: ${pinnedPnpm}`);
  const clientInstall = position("pnpm install --frozen-lockfile");
  const clientBuild = position(
    "tsc -b packages/shared packages/rpc packages/provider packages/provider-node packages/services",
  );
  const typecheck = position("npm run typecheck");
  assert.ok(
    rootInstall < pnpmSetup &&
      pnpmSetup < pnpmPin &&
      pnpmPin < clientInstall &&
      clientInstall < clientBuild &&
      clientBuild < typecheck,
    "顺序必须是：根依赖 → 客户端 pnpm 安装 → 客户端声明构建 → 根 typecheck",
  );
  assert.ok(
    job.split("working-directory: clients/uwork").length - 1 >= 2,
    "客户端安装与声明构建都必须在 clients/uwork 下执行",
  );
});

test("根 typecheck 保留 src、tests、scripts 全量覆盖，没有靠排除降门禁", () => {
  const verifyConfig = readJson<{
    include?: string[];
    exclude?: string[];
  }>("tsconfig.verify.json");
  assert.deepEqual(verifyConfig.include, [
    "src/**/*.ts",
    "tests/**/*.ts",
    "scripts/**/*.ts",
  ]);
  assert.equal(
    verifyConfig.exclude,
    undefined,
    "根 typecheck 不能排除脚本或测试",
  );

  const crossSourceScripts = typescriptSources("scripts").filter((file) =>
    /["'](?:\.\.\/)+clients\/uwork\//.test(readText(file)),
  );
  assert.ok(
    crossSourceScripts.length > 0,
    "没有发现静态引用 clients/uwork 的脚本，检测规则可能已经失效",
  );

  const workflow = readText(".github/workflows/backend.yml");
  assert.equal(
    workflow.split("npm run typecheck").length - 1,
    1,
    "根 typecheck 必须在工作流中恰好执行一次",
  );
  const job = workflowJob("verify");
  assert.ok(
    job.includes("npm test") &&
      job.includes("npm run lint") &&
      job.includes("npm run format:check") &&
      job.includes("npm run ledger:check") &&
      job.includes("npm run build") &&
      job.includes("npm audit --audit-level=high"),
    "verify job 不能删除既有门禁步骤",
  );
});

test("审计门禁依赖已升级到修复版本，未回退到已知漏洞区间", () => {
  const packageJson = readJson<{
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  }>("package.json");
  const undiciRange =
    packageJson.dependencies?.undici ?? packageJson.devDependencies?.undici;
  assert.match(undiciRange ?? "", /^\d+\.\d+\.\d+$/, "undici 必须是精确版本");
  const vulnerableUndici = (version: string): boolean =>
    gte(version, "7.0.0") && !gte(version, "7.30.1");
  const vulnerableFastUri = (version: string): boolean =>
    (gte(version, "3.0.0") && !gte(version, "3.1.9")) ||
    (gte(version, "4.0.0") && !gte(version, "4.2.3"));
  assert.ok(
    !vulnerableUndici(undiciRange!),
    `undici ${undiciRange} 落在 GHSA 通告影响区间（<7.30.1）`,
  );

  const lock = readJson<{
    packages?: Record<string, { version?: string }>;
  }>("package-lock.json");
  const locked: Record<string, string[]> = { undici: [], "fast-uri": [] };
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    const name = path.split("/").pop() ?? "";
    if (name in locked && entry.version) locked[name]!.push(entry.version);
  }
  assert.ok((locked.undici?.length ?? 0) > 0, "lock 中缺少 undici");
  assert.ok((locked["fast-uri"]?.length ?? 0) > 0, "lock 中缺少 fast-uri");
  for (const version of locked.undici!) {
    assert.ok(
      !vulnerableUndici(version),
      `lock 中 undici ${version} 不可用于发布`,
    );
  }
  for (const version of locked["fast-uri"]!) {
    assert.ok(
      !vulnerableFastUri(version),
      `lock 中 fast-uri ${version} 不可用于发布`,
    );
  }
});

test("部署文档声明源码实际 schema 版本并列出 v6 分享存储", () => {
  const versions = [
    ...readText("src/db.ts").matchAll(
      /INSERT OR IGNORE INTO schema_version VALUES\((\d+)/g,
    ),
  ].map((match) => Number.parseInt(match[1]!, 10));
  assert.ok(versions.length >= 6, "src/db.ts 应包含全部 schema 版本标记");
  const latest = Math.max(...versions);
  assert.equal(latest, 6, "当前源码 schema 最高版本应为 6");

  const doc = readText("docs/deployment.md").replace(/\s+/g, " ");
  assert.ok(
    doc.includes(`当前 schema 为 v${latest}`),
    `docs/deployment.md 必须写明当前 schema 为 v${latest}`,
  );
  assert.ok(
    !doc.includes("当前 schema 为 v5"),
    "部署文档不能保留旧的 schema v5 描述",
  );
  for (const table of ["conversation_shares", "conversation_share_artifacts"]) {
    assert.ok(doc.includes(table), `部署文档缺少 v6 分享存储 ${table}`);
  }
});

test("Dockerfile 固定基础镜像摘要并以非 root 用户运行", () => {
  const dockerfile = readText("Dockerfile");
  const stages = dockerfile.split(/^FROM /m).slice(1);
  assert.ok(stages.length >= 2, "Dockerfile 必须是多阶段构建");
  const fromLines = dockerfile
    .split("\n")
    .filter((line) => line.startsWith("FROM "));
  for (const line of fromLines) {
    assert.match(
      line,
      /@sha256:[0-9a-f]{64}\b/,
      `基础镜像必须固定摘要：${line}`,
    );
  }
  const finalStage = stages.at(-1)!;
  assert.match(
    finalStage,
    /^USER node$/m,
    "最终阶段必须以非 root 的 node 用户运行",
  );
  assert.doesNotMatch(finalStage, /^USER root$/m);
  assert.match(finalStage, /^VOLUME \["\/app\/data"\]$/m);
  assert.match(finalStage, /^HEALTHCHECK[^\n]*\/health/m);
  assert.match(finalStage, /^CMD \["node", "dist\/server\.js"\]$/m);

  const imageVersion = fromLines[0]!.match(/^FROM node:(\d+\.\d+\.\d+)-/)?.[1];
  assert.ok(imageVersion, "基础镜像必须声明明确的 Node 版本");
  const workflowVersions = new Set(
    [
      ...readText(".github/workflows/backend.yml").matchAll(
        /node-version: (\S+)/g,
      ),
    ].map((match) => match[1]!),
  );
  assert.deepEqual(
    workflowVersions,
    new Set([imageVersion]),
    "CI 与镜像使用的 Node 版本必须一致",
  );
});

test("Compose 只绑定 loopback、持久数据并降权，sandbox 叠加要求专用 socket", () => {
  const compose = readText("compose.yaml");
  assert.match(compose, /^ {2}backend:$/m);
  assert.match(compose, /^ {4}build: \.$/m);
  assert.match(compose, /^ {4}env_file: \.env$/m);
  assert.match(compose, /^ {6}HOST: 0\.0\.0\.0$/m);
  assert.match(compose, /^ {6}DATABASE_PATH: \/app\/data\/uwork\.sqlite$/m);
  assert.match(compose, /^ {6}- "127\.0\.0\.1:3000:3000"$/m);
  assert.match(compose, /^ {6}- \.\/data:\/app\/data$/m);
  assert.match(compose, /^ {4}stop_grace_period: 45s$/m);
  assert.match(compose, /^ {4}read_only: true$/m);
  assert.match(compose, /^ {4}tmpfs:\n {6}- \/tmp:size=64m$/m);
  assert.match(compose, /^ {6}- no-new-privileges:true$/m);
  assert.match(compose, /^ {4}cap_drop:\n {6}- ALL$/m);
  assert.doesNotMatch(compose, /0\.0\.0\.0:3000:3000/);
  assert.doesNotMatch(compose, /privileged: true/);
  assert.doesNotMatch(compose, /docker\.sock/);
  assert.doesNotMatch(compose, /:rw\b/);

  const sandbox = readText("compose.sandbox.yaml");
  assert.match(
    sandbox,
    /^ {6}SANDBOX_DOCKER_SOCKET: \/run\/uwork-sandbox\.sock$/m,
  );
  assert.match(
    sandbox,
    /^ {6}- \$\{SANDBOX_HOST_SOCKET:\?[^}]+\}:\/run\/uwork-sandbox\.sock$/m,
    "sandbox 叠加必须要求显式的宿主 socket 路径",
  );
  assert.match(
    sandbox,
    /^ {4}group_add:\n {6}- \$\{SANDBOX_SOCKET_GID:\?[^}]+\}$/m,
    "sandbox 叠加必须要求显式的 socket 组",
  );
  assert.doesNotMatch(sandbox, /:rw\b/);
  assert.doesNotMatch(sandbox, /privileged: true/);
  assert.doesNotMatch(sandbox, /\/var\/run\/docker\.sock/);
});

test("工作流只做验证：没有 secrets、镜像推送、SSH 部署或 production environment", () => {
  const workflow = readText(".github/workflows/backend.yml");
  assert.doesNotMatch(workflow, /secrets\./);
  assert.doesNotMatch(workflow, /docker push/);
  assert.doesNotMatch(workflow, /^\s+(?:ssh|scp)\s/m);
  assert.doesNotMatch(workflow, /pull_request_target/);
  assert.doesNotMatch(workflow, /^ {2}environment:\s*$/m);

  const dockerJob = workflowJob("docker");
  assert.ok(
    dockerJob.includes("compose config (main + sandbox overlay)"),
    "docker job 必须解析 Compose 配置",
  );
  assert.ok(dockerJob.includes('-f "$workspace/compose.yaml"'));
  assert.ok(dockerJob.includes("compose.sandbox.yaml"));
  assert.ok(
    dockerJob.includes("compose synthetic acceptance (isolated project)"),
    "docker job 必须包含隔离的合成 Compose 验收",
  );
  assert.ok(
    dockerJob.includes('project="uwork-ci-'),
    "合成 Compose 验收必须使用隔离的临时项目名",
  );
  assert.ok(dockerJob.includes("mktemp -d"));
  assert.ok(dockerJob.includes("node dist/cli.js init"));
  assert.ok(dockerJob.includes("/health"));
  assert.ok(dockerJob.includes("down -v"));
  for (const smoke of [
    "scripts/docker-smoke.ts",
    "scripts/sandbox-driver-smoke.ts",
    "scripts/sandbox-api-smoke.ts",
    "scripts/sandbox-crash-smoke.ts",
    "scripts/agent-sandbox-smoke.ts",
    "scripts/agent-container-smoke.ts",
    "scripts/agent-crash-smoke.ts",
    "scripts/lease-namespace-smoke.ts",
  ]) {
    assert.ok(
      dockerJob.includes(smoke),
      `docker job 不能删除既有 smoke：${smoke}`,
    );
  }
});

test("verify job 引用 production:simulate 时不会指向不存在的脚本", () => {
  const scripts =
    readJson<{ scripts?: Record<string, string> }>("package.json").scripts ??
    {};
  const workflow = readText(".github/workflows/backend.yml");
  const verify = workflowJob("verify");
  assert.ok(
    verify.includes("npm run production:simulate"),
    "verify job 必须包含无 Docker 的生产仿真入口",
  );
  if (!("production:simulate" in scripts)) {
    const guard = verify.indexOf("['production:simulate']");
    const run = verify.indexOf("npm run production:simulate");
    assert.ok(
      guard >= 0 && guard < run,
      "package.json 缺少 production:simulate 时必须先检查再执行，避免工作流引用不存在的脚本",
    );
  }

  for (const match of workflow.matchAll(/npm run ([A-Za-z0-9:_-]+)/g)) {
    const name = match[1]!;
    if (name in scripts) continue;
    const guard = workflow.indexOf(`['${name}']`);
    assert.ok(
      guard >= 0 && guard < (match.index ?? -1),
      `工作流引用了不存在的 npm 脚本 ${name}`,
    );
  }
});

test(".env.example 覆盖应用与 Compose 变量且只含占位值", () => {
  const envExample = readText(".env.example");
  for (const key of [
    "MASTER_KEY",
    "DATABASE_PATH",
    "PUBLIC_URL",
    "HOST",
    "PORT",
    "ALLOW_PRIVATE_UPSTREAMS",
    "PRIVATE_MODEL_ORIGINS",
    "SANDBOX_IMAGE",
  ]) {
    assert.match(envExample, new RegExp(`^${key}=`, "m"), `缺少 ${key}`);
  }
  for (const key of [
    "BOOTSTRAP_EMAIL",
    "BOOTSTRAP_PASSWORD",
    "BOOTSTRAP_ORGANIZATION",
    "SANDBOX_DOCKER_SOCKET",
    "SANDBOX_HOST_SOCKET",
    "SANDBOX_SOCKET_GID",
  ]) {
    assert.match(
      envExample,
      new RegExp(`^# ${key}=`, "m"),
      `${key} 必须存在并以注释形式给出`,
    );
  }
  assert.match(envExample, /^MASTER_KEY=replace_with_64_hex_characters$/m);
  assert.doesNotMatch(
    envExample,
    /^MASTER_KEY=[0-9a-f]{64}$/m,
    "示例文件不能包含可用的真实主密钥",
  );
  assert.match(envExample, /openssl rand -hex 32/);
  assert.doesNotMatch(envExample, /BOOTSTRAP_PASSWORD=.+/);

  const configKeys = [
    ...readText("src/config.ts").matchAll(/^ {6}([A-Z][A-Z0-9_]+): z\b/gm),
  ].map((match) => match[1]!);
  assert.ok(configKeys.length >= 8, "未解析到应用环境变量清单");
  for (const key of configKeys) {
    assert.match(
      envExample,
      new RegExp(`^(?:# )?${key}=`, "m"),
      `.env.example 缺少应用读取的 ${key}`,
    );
  }
});
