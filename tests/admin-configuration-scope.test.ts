import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

test("actual Configuration disables all writes until the current tenant/kind loads", async () => {
  const server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL("../admin", import.meta.url)),
    esbuild: { jsx: "automatic" },
    server: { middlewareMode: true, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: "silent",
  });
  try {
    const forms = await server.ssrLoadModule("/src/forms.tsx");
    const html = renderToStaticMarkup(
      createElement(forms.Configuration, {
        base: "/api/tenants/current",
        notify() {},
      }),
    ) as string;
    const buttons = [
      ...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g),
    ];
    for (const label of ["保存草稿", "放弃草稿", "发布"]) {
      const button = buttons.find(
        (match) => match[2]!.replace(/<[^>]*>/g, "").trim() === label,
      );
      assert.ok(button, `actual action button exists: ${label}`);
      assert.match(
        button[1]!,
        /\bdisabled\b/,
        `${label} must not send unbound data`,
      );
    }
  } finally {
    await server.close();
  }
});
