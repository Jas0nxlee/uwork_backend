import { defineConfig } from "tsup";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// tsup 配置自身会被打包，构建工具需保留原始文件位置，不能被内联后重定位。
const { loadBuiltinProviderConfig } = await import(
  pathToFileURL(resolve(import.meta.dirname, "../../scripts/builtin-provider-config.mjs")).href
);

const { content: zcodeBuiltinProviderConfigJson } = await loadBuiltinProviderConfig();
// 与 stageCli 的 manifest.appVersion 共用根 package.json，避免正式包的状态与 HTTP 仍报告 dev 版本。
const { version: appVersion } = JSON.parse(
  await readFile(resolve(import.meta.dirname, "../../package.json"), "utf8"),
) as { version: string };

export const SERVER_CLI_DEFINES = {
  __ZCODE_BUILTIN_PROVIDER_CONFIG_JSON__: JSON.stringify(zcodeBuiltinProviderConfigJson),
  __ZCODE_VERSION__: JSON.stringify(appVersion),
};

export default defineConfig({
  entry: {
    "server-cli": "src/main.ts",
    "server-core": "src/server-core/entry.ts",
  },
  outDir: "dist",
  format: ["esm"],
  platform: "node",
  target: "node22",
  sourcemap: true,
  splitting: false,
  banner: {
    // ESM 内打包的 CommonJS 仍需 Node require；只补文件路径会在 CLI/Core 加载前失败。
    js: 'import { createRequire as __zcodeCreateRequire } from "node:module"; import { fileURLToPath as __zcodeFileURLToPath } from "node:url"; import { dirname as __zcodeDirname } from "node:path"; const require = __zcodeCreateRequire(import.meta.url); const __filename = __zcodeFileURLToPath(import.meta.url); const __dirname = __zcodeDirname(__filename);',
  },
  noExternal: ["@zcode/shared", "@zcode/rpc", "@zcode/services"],
  define: SERVER_CLI_DEFINES,
  external: [
    "node-pty",
    "ssh2",
    "yaml",
    "@peculiar/asn1-schema",
    "@peculiar/asn1-x509",
    "undici",
    "axios",
    "form-data",
    "combined-stream",
    "proxy-from-env",
    "follow-redirects",
    "@lydell/node-pty-darwin-arm64",
    "@lydell/node-pty-darwin-x64",
    "@lydell/node-pty-linux-arm64",
    "@lydell/node-pty-linux-x64",
  ],
});
