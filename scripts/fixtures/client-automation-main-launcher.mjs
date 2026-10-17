// Electron 的 privileged schemes 必须在 app ready 前注册；入口不能先 await 配置 IO。
// 此 launcher 只立即导入完整 production Main，不替换其 scheduler 或权限处理。
import { app } from "electron";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

app.setAsDefaultProtocolClient = () => false;
createInterface({ input: process.stdin }).on("line", (line) => {
  if (line === "shutdown") app.quit();
});
process.stdin.once("end", () => app.quit());
process.once("SIGTERM", () => app.quit());
import(pathToFileURL(join(app.getAppPath(), "out/main/index.js")).href)
  .then(() => {
    process.stdout.write(
      "UWORK_MAIN_LIFECYCLE " +
        JSON.stringify({ event: "full-main-imported", pid: process.pid }) +
        "\n",
    );
  })
  .catch((error) => {
    process.stderr.write(
      "Owned production Main import failed: " + String(error) + "\n",
    );
    app.exit(1);
  });
