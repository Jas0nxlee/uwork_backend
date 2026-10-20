// ESM 在 Electron ready 前完成加载，保留原隔离目录与出站守卫的安装顺序。
import { app, BrowserWindow, session } from "electron";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
const root = process.argv[2],
  evidence = process.argv[3],
  port = process.argv[4];
if (!/^\/tmp\/uke-[A-Za-z0-9]+$/.test(root) || !/^\d+$/.test(port))
  throw Error("Exact new scratch and CDP port required");
const page = path.join(evidence, "form.html");
for (const key of ["userData", "sessionData", "logs", "crashDumps"])
  app.setPath(key, path.join(root, key));
app.commandLine.appendSwitch("remote-debugging-address", "127.0.0.1");
app.commandLine.appendSwitch("remote-debugging-port", port);
for (const flag of [
  "disable-background-networking",
  "disable-component-update",
  "disable-sync",
  "disable-extensions",
  "disable-breakpad",
  "no-first-run",
  "no-proxy-server",
])
  app.commandLine.appendSwitch(flag);
app.commandLine.appendSwitch(
  "host-resolver-rules",
  "MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost",
);
const seen = new WeakSet();
const guard = { allowed: 0, blocked: 0, sessions: 0, otherUrlHashes: [] };
const save = () => {
  fs.writeFileSync(
    path.join(evidence, "egress.json.tmp"),
    JSON.stringify(guard, null, 2),
    { mode: 0o600 },
  );
  fs.renameSync(
    path.join(evidence, "egress.json.tmp"),
    path.join(evidence, "egress.json"),
  );
};
function attach(s) {
  if (seen.has(s)) return;
  seen.add(s);
  guard.sessions++;
  s.webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, (d, cb) => {
    let allowed = d.url === "about:blank" || d.url === pathToFileURL(page).href;
    if (allowed) guard.allowed++;
    else {
      guard.blocked++;
      if (guard.otherUrlHashes.length < 8)
        guard.otherUrlHashes.push(
          createHash("sha256").update(d.url).digest("hex"),
        );
    }
    save();
    cb({ cancel: !allowed });
  });
  save();
}
app.on("session-created", attach);
app.on("web-contents-created", (_e, c) => attach(c.session));
let window;
app.whenReady().then(async () => {
  attach(session.defaultSession);
  window = new BrowserWindow({
    width: 1100,
    height: 850,
    show: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  await window.loadFile(page);
  fs.writeFileSync(
    path.join(evidence, "engine.json"),
    JSON.stringify(
      {
        pid: process.pid,
        versions: process.versions,
        pageReady: true,
        userData: app.getPath("userData"),
        fixtureOnly: true,
      },
      null,
      2,
    ),
    { flag: "wx", mode: 0o600 },
  );
  process.stdout.write("OWNED_PAGE_READY\n");
});
process.stdin.setEncoding("utf8");
let input = "";
process.stdin.on("data", (value) => {
  input += value;
  if (input === "quit\n") {
    if (window && !window.isDestroyed()) window.close();
    app.quit();
  }
});
app.on("window-all-closed", () => app.quit());
app.on("will-quit", save);
