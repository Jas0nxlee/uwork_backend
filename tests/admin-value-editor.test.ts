import { test } from "node:test";
import assert from "node:assert/strict";
import type { ReactElement } from "react";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

type TextInput = ReactElement<{
  onChange: (event: { target: { value: string } }) => void;
}>;
async function changeText(name: string, value: unknown, next: string) {
  // Load the real TSX through the existing UI transform without changing the
  // backend's NodeNext compiler or opening an HTTP listener.
  const server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL("../admin", import.meta.url)),
    esbuild: { jsx: "automatic" },
    server: { middlewareMode: true, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: "silent",
  });
  try {
    const module = await server.ssrLoadModule("/src/forms.tsx");
    const ValueEditor = module.ValueEditor as (props: {
      name: string;
      value: unknown;
      onChange: (result: unknown) => void;
    }) => TextInput;
    let changed: unknown;
    const input = ValueEditor({
      name,
      value,
      onChange: (result) => {
        changed = result;
      },
    });
    input.props.onChange({ target: { value: next } });
    return changed;
  } finally {
    await server.close();
  }
}

test("clearing an existing optional MCP Hub emits null", async () => {
  assert.equal(
    await changeText("mcpHub", "https://hub.example.test/", ""),
    null,
  );
});

test("entering an MCP Hub URL preserves its text", async () => {
  assert.equal(
    await changeText("mcpHub", null, "https://hub.example.test/"),
    "https://hub.example.test/",
  );
});

test("clearing ordinary welcome text preserves the empty string", async () => {
  assert.equal(await changeText("welcome", "hello", ""), "");
});
