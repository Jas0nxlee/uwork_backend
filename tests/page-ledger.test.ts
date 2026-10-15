import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { createApp } from "../src/app.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
interface ConsolePage {
  columns?: unknown[];
  fields?: unknown[];
  formLabels?: unknown[];
  group?: string;
  key: string;
  label?: string;
  path?: string;
}
interface CoverageRow {
  admin: string[];
  gaps: string[];
  modules: string[];
  status: string;
  surface: string[];
  verification: string[];
}
const inventory: { pages: ConsolePage[] } = JSON.parse(
  readFileSync(
    join(root, "docs/reverse-engineering/runtime-inventory.json"),
    "utf8",
  ),
);
const coverage: {
  pages: Record<string, CoverageRow>;
  statuses: string[];
} = JSON.parse(
  readFileSync(
    join(root, "docs/reverse-engineering/page-coverage.json"),
    "utf8",
  ),
);
const statuses = new Set(coverage.statuses);

test("every observed console page has exactly one coverage row and vice versa", () => {
  const observed = new Set(inventory.pages.map((page) => page.key));
  const mapped = new Set(Object.keys(coverage.pages));
  assert.deepEqual(
    [...observed].filter((key) => !mapped.has(key)),
    [],
    "观察到的页面必须有台账行，不能静默遗漏",
  );
  assert.deepEqual(
    [...mapped].filter((key) => !observed.has(key)),
    [],
    "台账不能引用不存在的观察页面",
  );
  assert.equal(observed.size, inventory.pages.length);
});

test("coverage rows carry a known status and explain every gap", () => {
  for (const [key, entry] of Object.entries(coverage.pages)) {
    assert.ok(statuses.has(entry.status), `${key}: 未知状态 ${entry.status}`);
    assert.ok(Array.isArray(entry.verification), `${key}: 缺少验证引用`);
    assert.ok(
      entry.status === "implemented" || entry.gaps.length > 0,
      `${key}: ${entry.status} 必须列出缺口`,
    );
    for (const gap of entry.gaps)
      assert.ok(gap.trim().length > 8, `${key}: 缺口说明过于笼统`);
    for (const module of entry.modules)
      assert.ok(
        existsSync(join(root, "src", module)),
        `${key}: 模块不存在 src/${module}`,
      );
    for (const reference of entry.verification) {
      const [path] = reference.split("（");
      assert.ok(
        existsSync(join(root, path!)) || path!.endsWith(".md"),
        `${key}: 验证引用不存在 ${reference}`,
      );
    }
  }
});

test("claimed backend endpoints and admin views exist", async (t) => {
  const app = await createApp({
    database: ":memory:",
    masterKey: Buffer.alloc(32, 10),
    publicUrl: "http://localhost:3000",
    allowPrivateUpstreams: true,
  });
  t.after(() => app.close());
  const document = (await app.inject({ url: "/api/openapi.json" })).json();
  const routes = new Set(
    Object.keys(document.paths).map((path: string) =>
      path.replace(/\{[a-zA-Z0-9_]+\}/g, "{param}"),
    ),
  );
  const views = new Set(
    [
      ...readFileSync(join(root, "admin/src/catalog.ts"), "utf8").matchAll(
        /id:\s*"([a-z0-9-]+)"/g,
      ),
    ].map((match) => match[1]!),
  );
  for (const [key, entry] of Object.entries(coverage.pages)) {
    for (const endpoint of entry.surface) {
      const path = endpoint
        .split("（")[0]!
        .split(" ")[0]!
        .split("?")[0]!
        .replace(/\{[a-zA-Z0-9_]+\}/g, "{param}");
      // 路径末段可能是 :x 形态的枚举参数（如 configurations/:kind），两种写法都接受。
      assert.ok(
        routes.has(path) || routes.has(path.replace(/\/[^/]+$/, "/{param}")),
        `${key}: 台账引用了不存在的端点 ${endpoint}`,
      );
    }
    for (const view of entry.admin)
      assert.ok(
        views.has(view),
        `${key}: 台账引用了不存在的管理端视图 ${view}`,
      );
  }
});

test("the generated ledger document matches the mapping and evidence", () => {
  execFileSync(
    process.execPath,
    [join(root, "scripts/build_page_ledger.mjs"), "--check"],
    {
      cwd: root,
      stdio: "pipe",
    },
  );
  const document = readFileSync(
    join(root, "docs/reverse-engineering/page-capability-ledger.md"),
    "utf8",
  );
  for (const page of inventory.pages)
    assert.ok(
      document.includes(`\`${page.key}\``),
      `${page.key}: 台账文档缺少该页面`,
    );
});
