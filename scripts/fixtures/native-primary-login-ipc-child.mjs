// Node-only finite transport probe. No Electron, Window, backend or identity is loaded.
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { fstatSync } from "node:fs";
import {
  startPrimaryMainEntry,
  PRIMARY_AUTH_EXPRESSION,
} from "./native-primary-login-adapter.mjs";

const app = new EventEmitter();
app.isReady = () => true;
app.exit = (code) => process.exit(code);
const makeSession = () => ({
  webRequest: {
    onBeforeRequest(_filter, handler) {
      this.handler = handler;
    },
  },
});
const defaultSession = makeSession(),
  loginSession = makeSession();
const owner = new EventEmitter();
owner.id = 7;
let visible = false,
  cancelled = 0;
owner.executeJavaScript = async (expression) => {
  if (expression !== PRIMARY_AUTH_EXPRESSION) process.exit(73);
  return {
    authenticated: visible,
    signedOut: !visible,
    loginVisible: !visible,
  };
};
const guest = new EventEmitter();
guest.id = 8;
guest.session = loginSession;
const electron = {
  app,
  session: { defaultSession },
  shell: {
    openExternal() {
      process.exit(74);
    },
  },
  webContents: { fromId: (id) => (id === guest.id ? guest : undefined) },
  BrowserWindow: {
    getAllWindows: () => [
      {
        webContents: owner,
        contentView: { children: [{ webContents: guest }] },
      },
    ],
  },
};
const origin = "https://127.0.0.1:50301";
// Exercise explicit scrub even when Node itself consumed the original channel env.
process.env.NODE_CHANNEL_FD = "3";
process.env.NODE_CHANNEL_SERIALIZATION_MODE = "json";
process.env.UWORK_NATIVE_PRIMARY_LOGIN = "controlled";
process.env.UWORK_NATIVE_VIEWER_AUTH = "controlled";
await startPrimaryMainEntry(electron, process, {
  appRoot: import.meta.dirname,
  ownedRoot: import.meta.dirname,
  origin,
  onStop: () => process.exit(cancelled ? 75 : 0),
  loadMain: async (init) => {
    const controlFd = process.channel?.fd;
    if (!Number.isInteger(controlFd) || controlFd < 3 || controlFd > 63)
      process.exit(81);
    const control = fstatSync(controlFd, { bigint: true });
    if (!(control.isSocket() || control.isFIFO()) || control.ino === 0n)
      process.exit(82);
    // An unrelated Node runtime socket can occupy fd 3. Compare the actual
    // private channel's kernel identity rather than rejecting any socket.
    const controlSignature = `${control.dev}:${control.ino}`;
    const grandchild = spawn(
      process.execPath,
      [
        "-e",
        `const fs=require('node:fs');if(process.send||process.connected||Object.keys(process.env).some(k=>k==='NODE_CHANNEL_FD'||k==='NODE_CHANNEL_SERIALIZATION_MODE'||k.startsWith('UWORK_NATIVE_')))process.exit(79);for(let fd=3;fd<64;fd++){let s;try{s=fs.fstatSync(fd,{bigint:true})}catch{continue}if(String(s.dev)+':'+String(s.ino)===${JSON.stringify(controlSignature)})process.exit(80)}`,
      ],
      { env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"] },
    );
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        grandchild.kill("SIGKILL");
        reject(Error("Finite descendant deadline"));
      }, 1500);
      grandchild.once("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else process.exit(code ?? 78);
      });
      grandchild.once("error", () => {
        clearTimeout(timer);
        reject(Error("Finite descendant failed"));
      });
    });
    const state = createHash("sha256")
      .update(init.nonce + "probe-state")
      .digest("hex");
    const url = new URL("https://login.work.weixin.qq.com/wwlogin/sso/login");
    for (const [key, value] of Object.entries({
      appid: "ww-synthetic-never-called",
      agentid: "1",
      redirect_uri: origin + "/api/auth/wecom/callback",
      state,
      login_type: "CorpApp",
      lang: "zh",
    }))
      url.searchParams.set(key, value);
    for (const privateValue of [init.nonce, state, url.href]) {
      if (
        process.argv.some((arg) => arg.includes(privateValue)) ||
        Object.values(process.env).some((value) =>
          value?.includes(privateValue),
        )
      )
        process.exit(76);
    }
    // Real stdout/stderr contain public markers only; private values stay on anonymous IPC.
    process.stdout.write("owned stdout\n");
    process.stderr.write("owned stderr\n");
    app.emit("session-created", loginSession);
    app.emit("web-contents-created", {}, guest);
    loginSession.webRequest.handler(
      {
        id: 11,
        method: "GET",
        resourceType: "mainFrame",
        webContentsId: guest.id,
        url: url.href,
      },
      () => {
        cancelled++;
      },
    );
    setTimeout(() => {
      visible = true;
      guest.emit("destroyed");
    }, 300);
  },
});
