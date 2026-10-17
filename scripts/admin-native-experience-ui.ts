// Root 所拥有的 live Native fixture 的串行、有限 Admin DOM 控制器。
import assert from "node:assert/strict";
import {
  readFile,
  writeFile,
  mkdir,
  stat,
  rm,
  realpath,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import { OwnedAdminBrowser } from "./fixtures/owned-admin-browser.js";

const commands = [
  "desktopDraftOn",
  "desktopPublish",
  "desktopOff",
  "sceneDraftTitle",
  "scenePublish",
  "sceneDiscard",
  "close",
] as const;
const parentRoot = resolve("data/client-native-experience-live-20261017");
assert.equal(await realpath(parentRoot), parentRoot);
const statePath = resolve(
  "evidence/client-native-experience-live-20261017/desktop-state.json",
);
const state = JSON.parse(await readFile(statePath, "utf8")) as {
  root: string;
  origin: string;
  certSpkiSha256: string;
  tenantId: string;
};
assert.equal(state.root, parentRoot);
const origin = new URL(state.origin);
assert.equal(origin.protocol, "https:");
assert.equal(origin.hostname, "127.0.0.1");
assert.notEqual(origin.port, "3000");
assert.equal(origin.origin, state.origin);
assert.match(state.tenantId, /^[a-f0-9]{32}$/);
const loginPath = join(parentRoot, "browser-login.json");
assert.equal((await stat(loginPath)).mode & 0o777, 0o600);
const login = JSON.parse(await readFile(loginPath, "utf8")) as {
  email: string;
  password: string;
};
assert.ok(typeof login.email === "string" && login.email.length > 0);
assert.ok(typeof login.password === "string" && login.password.length > 0);
const redact = (text: string) => text.replaceAll(login.password, "[REDACTED]");
const freeze = JSON.parse(
  await readFile(
    resolve(
      "evidence/admin-client-experience-20261017/final-source-freeze.json",
    ),
    "utf8",
  ),
) as { files: { path: string; sha256: string }[] };
for (const file of freeze.files)
  assert.equal(
    createHash("sha256")
      .update(await readFile(resolve(file.path)))
      .digest("hex"),
    file.sha256,
    `frozen source changed: ${file.path}`,
  );
const childRoot = join(parentRoot, "admin-browser");
await mkdir(childRoot, { mode: 0o700 });
const evidence = resolve(
  "evidence/client-native-experience-live-20261017/admin-browser",
);
await mkdir(evidence, { recursive: true, mode: 0o700 });
const browser = new OwnedAdminBrowser({
  root: childRoot,
  evidence,
  name: "native-experience-admin",
  trustSpkiSha256: state.certSpkiSha256,
  redact,
});
const driver = resolve("scripts/admin-native-experience-ui-browser.py");
const environment = {
  UWORK_EXPERIENCE_ORIGIN: state.origin,
  UWORK_EXPERIENCE_PHASE: "native-owned-admin",
  UWORK_NATIVE_ADMIN_TENANT: state.tenantId,
  UWORK_NATIVE_ADMIN_HELPERS: resolve(
    "scripts/admin-client-experience-ui-browser.py",
  ),
};
let sequence = 0;
let input: ReturnType<typeof createInterface> | undefined;
let closing = false;
const emit = async (record: Record<string, unknown>) => {
  const encoded = JSON.stringify(record, null, 2);
  assert.equal(redact(encoded), encoded, "private login material entered ack");
  await writeFile(
    join(
      evidence,
      `${String(sequence).padStart(3, "0")}-${record.command}.json`,
    ),
    encoded,
    { mode: 0o600 },
  );
  console.log("NATIVE_ADMIN_ACK=" + JSON.stringify(record));
};
const run = async (command: string) => {
  const stage = `${String(sequence).padStart(3, "0")}-${command}`;
  return browser.run(driver, stage, {
    ...environment,
    UWORK_NATIVE_ADMIN_COMMAND: command,
    ...(command === "ready"
      ? {
          UWORK_EXPERIENCE_EMAIL: login.email,
          UWORK_EXPERIENCE_PASSWORD: login.password,
        }
      : {}),
  });
};
const shutdown = () => {
  closing = true;
  input?.close();
};
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
try {
  await browser.start();
  const dom = await run("ready");
  await emit({
    command: "ready",
    status: "ready",
    sequence,
    fixturePid: process.pid,
    origin: state.origin,
    tenantId: state.tenantId,
    cdpPort: browser.cdpPort,
    childRoot,
    evidence,
    commands,
    dom,
  });
  input = createInterface({ input: process.stdin, terminal: false });
  for await (const line of input) {
    if (closing) break;
    const command = line.trim();
    sequence += 1;
    if (!(commands as readonly string[]).includes(command)) {
      await emit({ command: "rejected", status: "rejected", sequence });
      continue;
    }
    if (command === "close") break;
    try {
      const dom = await run(command);
      await emit({ command, status: "passed", sequence, dom });
    } catch (error) {
      await emit({
        command,
        status: "failed",
        sequence,
        error: redact(
          error instanceof Error ? error.message : "DOM action failed",
        ),
      });
    }
  }
} catch (error) {
  process.exitCode = 1;
  await emit({
    command: "ready",
    status: "failed",
    sequence,
    error: redact(
      error instanceof Error ? error.message : "owned startup failed",
    ),
  });
} finally {
  input?.close();
  const cleanup = await browser.close();
  if (cleanup.fullyClosed === true)
    await rm(childRoot, { recursive: true, force: true });
  else process.exitCode = 1;
  const rootRemoved = await stat(childRoot).then(
    () => false,
    () => true,
  );
  const parentRetained = await stat(parentRoot).then(
    () => true,
    () => false,
  );
  const parentLoginRetained = await stat(loginPath).then(
    () => true,
    () => false,
  );
  sequence += 1;
  await emit({
    command: "close",
    status: cleanup.fullyClosed === true && rootRemoved ? "passed" : "failed",
    sequence,
    cleanup,
    rootRemoved,
    parentRetained,
    parentLoginRetained,
    parentFixtureClosed: false,
  });
}
