import assert from "node:assert/strict";
import { connectViaWebSocket } from "../../clients/uwork/packages/client/src/websocket.ts";

const [port, root, phase] = process.argv.slice(2);
assert.match(root, /^\/tmp\/uwsysd-[A-Za-z0-9_-]+\/server$/);
assert.ok(["seed", "read"].includes(phase));
let socket;
const deadline = setTimeout(() => {
  throw new Error("Owned systemd SDK observation deadline");
}, 20000);
try {
  const services = await connectViaWebSocket(`ws://127.0.0.1:${Number(port)}/ws`, {
    onOpenSocket(value) { socket = value; },
  });
  const workspace = await services.fileService.ensureConversationWorkspace();
  assert.ok(workspace.path.startsWith(root + "/.uwork/"));
  const content = "# UWORK_SYSTEMD_OWNED_20261020\nowned-systemd-ignore/**\n";
  if (phase === "seed") {
    await services.fileService.writeWorkspaceFileSearchIgnore({ rootPath: workspace.path, content });
    await services.settingService.update({ locale: "en-US", terminalInheritSystemProfile: false });
  }
  const file = await services.fileService.readTextFile({ path: workspace.path + "/.zcodeignore" });
  const settings = await services.settingService.get();
  assert.equal(file.content, content);
  assert.equal(settings.locale, "en-US");
  assert.equal(settings.terminalInheritSystemProfile, false);
  console.log(JSON.stringify({ phase, workspacePath: workspace.path, fileContent: file.content,
    settings: { locale: settings.locale, terminalInheritSystemProfile: settings.terminalInheritSystemProfile } }));
} finally {
  clearTimeout(deadline);
  socket?.close();
}
