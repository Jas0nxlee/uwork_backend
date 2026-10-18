import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Public fixture paths only. The production Main URL is derived, never caller supplied.
export function createPrimaryMainEntry(options) {
  const keys = ["appRoot", "ownedRoot", "origin", "evidenceDirectory"];
  if (
    !options ||
    Object.keys(options).sort().join() !== keys.sort().join() ||
    keys
      .filter((key) => key !== "origin")
      .some((key) => {
        const value = options[key];
        return (
          typeof value !== "string" ||
          !isAbsolute(value) ||
          resolve(value) !== value ||
          /[\x00-\x1f\x7f]/u.test(value)
        );
      }) ||
    options.appRoot !== join(options.ownedRoot, "runtime/app") ||
    typeof options.origin !== "string" ||
    !/^https:\/\/127\.0\.0\.1:\d{1,5}$/u.test(options.origin)
  )
    throw Error("PRIMARY_ENTRY_REJECTED");
  let origin;
  try {
    origin = new URL(options.origin);
  } catch {
    throw Error("PRIMARY_ENTRY_REJECTED");
  }
  if (
    !origin.port ||
    Number(origin.port) < 1 ||
    origin.port === "3000" ||
    origin.origin !== options.origin
  )
    throw Error("PRIMARY_ENTRY_REJECTED");
  const { appRoot, ownedRoot, evidenceDirectory } = options;
  return `import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
require('./env-guard.cjs');
const electron = require("electron");
const { app } = electron;
const fs = require("node:fs");
fs.writeFileSync(${JSON.stringify(join(evidenceDirectory, "native-runtime-info.json"))}, JSON.stringify({pid:process.pid,isPackaged:app.isPackaged,appPath:app.getAppPath(),helpFallbackPath:require("node:path").join(app.getAppPath(),"../../config/default.json"),dynamicWorkflowMode:process.env.ZCODE_DYNAMIC_WORKFLOW_MODE??null,defaultProtocolRegistrationSuppressed:true,recentDocumentsClearSuppressed:true}), {mode:0o600});
fs.writeFileSync(${JSON.stringify(join(evidenceDirectory, "native-runtime-info-"))}+process.pid+".json", JSON.stringify({pid:process.pid,ppid:process.ppid,isPackaged:app.isPackaged,appPath:app.getAppPath()}), {flag:"wx",mode:0o600});
app.setAsDefaultProtocolClient = () => false;
app.clearRecentDocuments = () => {};
try {
  const { startPrimaryMainEntry } = await import("./native-primary-login-adapter.mjs");
  await startPrimaryMainEntry(electron, process, {
    appRoot: ${JSON.stringify(appRoot)},
    ownedRoot: ${JSON.stringify(ownedRoot)},
    origin: ${JSON.stringify(options.origin)},
    onReject: (code) => {
      try {
        if (!["secondary_argv_shape","owned_workspace","session_guard","main_import","private_channel"].includes(code)) return;
        fs.writeFileSync(${JSON.stringify(join(evidenceDirectory, "native-rejection-"))}+process.pid+".json", JSON.stringify({pid:process.pid,code}), {flag:"wx",mode:0o600});
      } catch {}
    },
    loadMain: () => import(${JSON.stringify(pathToFileURL(join(appRoot, "out/main/index.js")).href)})
  });
} catch { app.exit(70); }
`;
}
