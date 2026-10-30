import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  NO_CAPABILITIES,
  type Capabilities,
} from "../admin/src/permissions.js";

function labels(html: string) {
  return [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(
    (match) => match[2]!.replace(/<[^>]*>/g, "").trim(),
  );
}

async function withSettings(
  fn: (render: (view: string, capabilities: Capabilities) => string) => void,
) {
  const server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL("../admin", import.meta.url)),
    esbuild: { jsx: "automatic" },
    server: { middlewareMode: true, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: "silent",
  });
  try {
    const settings = await server.ssrLoadModule("/src/Settings.tsx");
    fn(
      (view, capabilities) =>
        renderToStaticMarkup(
          createElement(settings.Settings, {
            view,
            base: "/api/tenants/current",
            notify() {},
            capabilities,
          }),
        ) as string,
    );
  } finally {
    await server.close();
  }
}

const ENTERPRISE_MUTATIONS = [
  "修改企业信息",
  "设置留存",
  "立即清理",
  "配置应用",
  "应用与回调",
  "绑定身份",
  "同步通讯录",
];

test("无能力时 Settings 不渲染任何可能 403 的按钮", async () => {
  await withSettings((render) => {
    for (const view of ["enterprise", "integrations"]) {
      const html = render(view, NO_CAPABILITIES);
      const found = labels(html);
      for (const label of [
        ...ENTERPRISE_MUTATIONS,
        "角色权限",
        "配置",
        "容量策略",
      ])
        assert.ok(!found.includes(label), `${view}:${label} 不应出现`);
      for (const label of ["导出", "保存", "发布"])
        assert.ok(!found.includes(label));
    }
  });
});

test("只读审计角色只保留读取入口", async () => {
  await withSettings((render) => {
    const html = render("enterprise", { ...NO_CAPABILITIES, read: true });
    const found = labels(html);
    assert.ok(found.includes("角色权限"), "read 可读取权限声明");
    for (const label of ENTERPRISE_MUTATIONS)
      assert.ok(!found.includes(label), `${label} 需要更高权限`);
  });
});

test("identity 才渲染身份与留存操作，vault 才渲染企微凭据配置", async () => {
  await withSettings((render) => {
    const identity = labels(
      render("enterprise", { ...NO_CAPABILITIES, read: true, identity: true }),
    );
    for (const label of [
      "修改企业信息",
      "设置留存",
      "立即清理",
      "应用与回调",
      "绑定身份",
      "同步通讯录",
    ])
      assert.ok(identity.includes(label), `${label} 需要 identity`);
    assert.ok(!identity.includes("配置应用"), "PUT /wecom 需要 vault");

    const vault = labels(
      render("enterprise", { ...NO_CAPABILITIES, read: true, vault: true }),
    );
    assert.ok(vault.includes("配置应用"), "vault 可写入企微 Secret 凭据");
    assert.ok(!vault.includes("修改企业信息"), "vault 不包含 identity 操作");
    assert.ok(!vault.includes("同步通讯录"));
  });
});

test("终端凭据只对交互会话开放", async () => {
  await withSettings((render) => {
    const device = labels(
      render("enterprise", {
        ...NO_CAPABILITIES,
        read: true,
        interactive: false,
      }),
    );
    assert.ok(!device.includes("查看我的终端凭据"));
    assert.ok(!device.includes("签发凭据"));
    const interactive = labels(
      render("enterprise", {
        ...NO_CAPABILITIES,
        read: true,
        interactive: true,
      }),
    );
    assert.ok(interactive.includes("查看我的终端凭据"));
    assert.ok(interactive.includes("签发凭据"));
  });
});

test("集成页按 read/vault/identity 拆分能力", async () => {
  await withSettings((render) => {
    const read = labels(
      render("integrations", { ...NO_CAPABILITIES, read: true }),
    );
    for (const label of ["连接状态", "容量", "文件", "日志"])
      assert.ok(read.includes(label), label);
    assert.ok(!read.includes("配置"), "网盘写入需要 vault");
    assert.ok(!read.includes("容量策略"), "容量策略需要 identity");

    const vault = labels(
      render("integrations", { ...NO_CAPABILITIES, read: true, vault: true }),
    );
    assert.ok(vault.includes("配置"));
    assert.ok(!vault.includes("容量策略"));

    const identity = labels(
      render("integrations", {
        ...NO_CAPABILITIES,
        read: true,
        identity: true,
      }),
    );
    assert.ok(identity.includes("容量策略"));
    assert.ok(!identity.includes("配置"));
  });
});

test("main 以服务器能力裁决入口，不再按角色粗放行", async () => {
  const source = await readFile(
    new URL("../admin/src/main.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /capabilitiesFromRoles/, "能力必须来自 GET /roles 解析");
  assert.match(
    source,
    /viewAccess\(v\.id, capabilities\)\.read/,
    "导航入口按 read 能力过滤",
  );
  assert.match(
    source,
    /capabilities=\{capabilities\}/,
    "Settings 与 Collection 消费同一能力对象",
  );
  assert.doesNotMatch(source, /me\.role === "member"/, "不按角色名粗放行");
  assert.doesNotMatch(source, /\["owner", "admin"/, "不保留角色白名单");
  assert.doesNotMatch(
    source,
    /canWrite=|canManageIdentity=/,
    "旧粗粒度 props 已移除",
  );
});
