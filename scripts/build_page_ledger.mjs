// 生成逐页面/表单能力台账：控制台证据 + 自有实现的实现位置、验证与缺口。
//
// 证据侧只读 docs/reverse-engineering/runtime-inventory.json（页面/表单观察），
// 映射侧读 docs/reverse-engineering/page-coverage.json（人工维护，测试保证不漂移）。
// 用法：node scripts/build_page_ledger.mjs [--check]
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const inventory = JSON.parse(
  readFileSync(join(root, "docs/reverse-engineering/runtime-inventory.json"), "utf8"),
);
const coverage = JSON.parse(
  readFileSync(join(root, "docs/reverse-engineering/page-coverage.json"), "utf8"),
);
const output = join(root, "docs/reverse-engineering/page-capability-ledger.md");
const statusLabels = {
  implemented: "已实现",
  partial: "部分实现",
  external: "外部依赖",
};

const rows = new Map(Object.entries(coverage.pages));
const groups = new Map();
for (const page of inventory.pages) {
  const group = page.group ?? "未分组";
  if (!groups.has(group)) groups.set(group, []);
  groups.get(group).push(page);
}
const escape = (value) => String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
const cell = (values, empty = "—") =>
  values && values.length ? values.map(escape).join("<br>") : empty;
const formSummary = (page) => {
  const fields = page.fields ?? [];
  const labels = page.formLabels ?? [];
  const columns = page.columns ?? [];
  const parts = [];
  if (fields.length) parts.push(`表单字段 ${fields.length}`);
  if (labels.length) parts.push(`表单标签 ${labels.length}`);
  if (columns.length) parts.push(`列表列 ${columns.length}`);
  return parts.length ? parts.join(" / ") : "纯浏览页（无表单字段观察）";
};
const counts = { implemented: 0, partial: 0, external: 0 };
for (const page of inventory.pages) {
  const entry = rows.get(page.key);
  if (entry) counts[entry.status] = (counts[entry.status] ?? 0) + 1;
}

const lines = [];
lines.push("# 逐页面/表单能力台账");
lines.push("");
lines.push(
  "本台账由 `scripts/build_page_ledger.mjs` 从控制台页面观察（`runtime-inventory.json`）与人工维护的映射（`page-coverage.json`）生成；测试校验两边双向完整、状态合法、缺口有说明，并核对声称的后端端点确实存在。",
);
lines.push("");
lines.push("| 项目 | 值 |");
lines.push("| --- | --- |");
lines.push(`| 控制台页面观察 | ${inventory.pages.length} |`);
lines.push(`| 已实现 | ${counts.implemented} |`);
lines.push(`| 部分实现 | ${counts.partial} |`);
lines.push(`| 外部依赖 | ${counts.external} |`);
lines.push("");
lines.push(
  "状态含义：已实现＝自有后端/管理端提供该能力并能以行为测试或受控运行验证；部分实现＝服务端事实已具备但终端/管理端应用或真实外部资源未完成（缺口逐条列出）；外部依赖＝需要真实第三方服务，未配置时明确不可用。",
);
lines.push("");
for (const [group, pages] of groups) {
  lines.push(`## ${group}`);
  lines.push("");
  lines.push("| 页面 | 控制台路径 | 观察到的表单/列表 | 自有实现（模块与端点） | 管理端 | 验证 | 状态 | 缺口 |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const page of pages) {
    const entry = rows.get(page.key);
    lines.push(
      "| " +
        [
          `${escape(page.label ?? page.key)}（\`${escape(page.key)}\`）`,
          `\`${escape(page.path ?? "")}\``,
          escape(formSummary(page)),
          [
            ...(entry?.modules ?? []).map((module) => `\`${module}\``),
            ...(entry?.surface ?? []).map((endpoint) => `\`${endpoint}\``),
          ].join("<br>") || "—",
          cell(entry?.admin ?? []),
          cell(entry?.verification ?? []),
          entry ? statusLabels[entry.status] : "缺映射",
          cell(entry?.gaps ?? []),
        ].join(" | ") +
        " |",
    );
  }
  lines.push("");
}
lines.push("## 表单字段观察明细");
lines.push("");
lines.push(
  "以下只记录控制台页面观察到的字段/标签名（证据侧），自有实现的字段定义在 `admin/src/catalog.ts`；两侧不做逐字段等价声明。",
);
lines.push("");
for (const [group, pages] of groups) {
  lines.push(`### ${group}`);
  lines.push("");
  for (const page of pages) {
    const labels = [...(page.fields ?? []), ...(page.formLabels ?? [])]
      .map((field) =>
        typeof field === "string"
          ? field
          : [field.label ?? field.name ?? field.key, field.type, field.required ? "必填" : undefined]
              .filter(Boolean)
              .join(":"),
      )
      .filter(Boolean);
    const columns = (page.columns ?? []).map((column) =>
      typeof column === "string" ? column : column.label ?? column.key,
    );
    lines.push(
      `- \`${escape(page.key)}\`：表单 ${labels.length ? labels.map(escape).join("、") : "无观察字段"}；列表列 ${
        columns.length ? columns.map(escape).join("、") : "无观察列"
      }`,
    );
  }
  lines.push("");
}
lines.push("## 已知缺口汇总");
lines.push("");
for (const page of inventory.pages) {
  const entry = rows.get(page.key);
  if (!entry || entry.status === "implemented") continue;
  lines.push(`- \`${escape(page.key)}\`（${statusLabels[entry.status]}）：${cell(entry.gaps)}`);
}
lines.push("");
const document = lines.join("\n");
if (process.argv.includes("--check")) {
  const current = (() => {
    try {
      return readFileSync(output, "utf8");
    } catch {
      return "";
    }
  })();
  if (current !== document) {
    console.error(
      "page-capability-ledger.md is stale; run node scripts/build_page_ledger.mjs",
    );
    process.exit(1);
  }
  console.log("page capability ledger is up to date");
} else {
  writeFileSync(output, document);
  console.log(`wrote ${output} (${inventory.pages.length} pages)`);
}
