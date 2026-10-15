import assert from "node:assert/strict";
import { test } from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

interface Route {
  body: string;
  file: string;
  line: number;
  path: string;
}

function routes(): Route[] {
  const found: Route[] = [];
  for (const file of readdirSync(join(root, "src")).filter((name) =>
    name.endsWith(".ts"),
  )) {
    const lines = readFileSync(join(root, "src", file), "utf8").split("\n");
    lines.forEach((line, index) => {
      if (!/^\s*app\.(get|post|put|patch|delete)\(/.test(line)) return;
      const block: string[] = [];
      let depth = 0,
        started = false;
      for (
        let cursor = index;
        cursor < Math.min(index + 90, lines.length);
        cursor++
      ) {
        const current = lines[cursor]!;
        block.push(current);
        if (current.includes("{")) started = true;
        depth +=
          (current.match(/\{/g)?.length ?? 0) -
          (current.match(/\}/g)?.length ?? 0);
        if (started && depth <= 0 && cursor > index) break;
      }
      const path = /app\.\w+\(\s*[`"']([^`"']+)/.exec(line)?.[1] ?? "";
      found.push({
        body: block.join("\n"),
        file,
        line: index + 1,
        path: path.replace(/\$\{p\}/g, "/api/tenants/:tenantId"),
      });
    });
  }
  return found;
}

/** 公开入口：登录、企微扫码/回调、健康检查、OpenAPI 与静态资源。 */
const publicPaths = [
  "/api/auth/login",
  "/api/auth/wecom/attempts",
  "/api/auth/wecom/attempts/:id/complete",
  "/api/auth/wecom/attempts/:id/claim",
  "/api/auth/wecom/attempts/:id/cancel",
  "/api/auth/wecom/callback",
  "/api/openapi.json",
];
/** 权限判定写在被调用服务内部的端点。 */
const serviceChecked = [
  "/api/tenants/:tenantId/runs",
  "/api/tenants/:tenantId/runs/:id/cancel",
];

test("every business route authenticates and checks a permission", () => {
  const offenders: string[] = [];
  for (const route of routes()) {
    if (!route.path.startsWith("/api/") && !route.path.startsWith("/v1/"))
      continue;
    if (publicPaths.includes(route.path)) continue;
    if (!route.body.includes("authenticate("))
      offenders.push(`${route.file}:${route.line} ${route.path} 未认证`);
    if (
      route.path.startsWith("/api/tenants/") &&
      !route.body.includes("requirePermission(") &&
      !route.body.includes("tenantAccess(") &&
      !serviceChecked.includes(route.path)
    )
      offenders.push(`${route.file}:${route.line} ${route.path} 未做权限判定`);
  }
  assert.deepEqual(
    offenders,
    [],
    `路由认证/权限不变量被破坏：\n${offenders.join("\n")}`,
  );
});

test("a tenant-scoped route never authorises with a caller-supplied tenant id", () => {
  const offenders: string[] = [];
  for (const route of routes()) {
    if (!route.body.includes("params as { tenantId")) continue;
    // 参数里的 tenantId 只能交给 tenantAccess 校验；越权与否由登录态决定。
    if (!route.body.includes("tenantAccess("))
      offenders.push(
        `${route.file}:${route.line} ${route.path} 直接使用请求参数里的 tenantId`,
      );
  }
  assert.deepEqual(
    offenders,
    [],
    `跨租户信任被破坏：\n${offenders.join("\n")}`,
  );
});

test("client and gateway routes gate on execute permission and the current tenant", () => {
  const offenders: string[] = [];
  for (const route of routes()) {
    const scoped =
      route.path.startsWith("/api/client/") || route.path.startsWith("/v1/");
    if (!scoped || route.path === "/api/client/events") continue;
    if (!route.body.includes("authenticate("))
      offenders.push(`${route.file}:${route.line} ${route.path} 未认证`);
    if (
      !route.body.includes("requirePermission(") &&
      !route.body.includes("assertExecution(") &&
      !route.body.includes("gateway.complete(") &&
      !route.body.includes("connectors.rpc(") &&
      !route.body.includes("connectors.authorize(")
    )
      offenders.push(
        `${route.file}:${route.line} ${route.path} 缺少执行权限判定`,
      );
    // 组织绑定可以由处理器自己做，也可以在被调用服务内部（连接器/网关）完成。
    const bound =
      route.body.includes(".tenantId") ||
      route.body.includes("connectors.rpc(") ||
      route.body.includes("connectors.release(") ||
      route.body.includes("connectors.authorize(") ||
      route.body.includes("gateway.complete(");
    if (!bound)
      offenders.push(
        `${route.file}:${route.line} ${route.path} 未绑定当前组织的 tenant`,
      );
  }
  assert.deepEqual(
    offenders,
    [],
    `客户端入口不变量被破坏：\n${offenders.join("\n")}`,
  );
});
