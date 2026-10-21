# macOS Server 原生服务注册与卸载（2026-10-20）

原 `serve --daemon` 默认 launchd 路径已真实通过，补齐 W03/W04 显式不注册服务的范围。过程中发现并修复原 CLI 的确认输入生命周期缺陷：卸载业务完成后 stdin 仍为 flowing，输入端保持打开时进程无法自然退出；取消确认同样挂起。

## 修复与回归

`packages/zcode-server-cli/src/main.ts` 继续唯一拥有输入适配，在原 `runServerCli` Promise 完成后暂停 stdin。没有强制 process.exit、没有提前终止长运行 serve，也未修改卸载所有权、双确认、服务注册或删除白名单。

永久测试运行实际 main.ts 转译后的独立 Node 进程，只把业务端口换成固定双确认/取消/无确认命令，父进程保持输入管道打开。旧源码 **2 RED / 1 PASS**，修复后 **3/3**；联合实际 ESM 构建加载测试 **4/4**。本地原子提交 `231c0919`，未推送。

- [旧入口回归失败](../evidence/client-server-stdin-red-20261020.log)
- [四项回归](../evidence/client-server-stdin-regression-20261020.log)
- [正常 Server CLI/Core 构建](../evidence/client-server-stdin-build-v2-20261020.log)
- [类型检查](../evidence/client-server-stdin-typecheck-v2-20261020.log)、[Lint](../evidence/client-server-stdin-lint-v2-20261020.log)：通过，0 error / 113 既有 warning；架构 0 违例、改动格式与 diff whitespace 通过。

## 实际原命令链

[v3 原运行结果](../evidence/client-server-service-v3-20261020/result.json)六项通过：

1. 新建 0700 私有根生成唯一服务 Label；启动前精确 job 不存在。
2. 原 CLI 写私有 plist/稳定 launcher，launchd 实际拉起 Supervisor/Core；原 status ready、serviceRegistered=true，`/api/server-info` 返回 200。
3. 第二次原 `serve --daemon` 复用相同 Core PID 与 generation。
4. 原 `restart` 返回异步受理后，原 status 从 starting 到 ready，Core generation 1→2、PID 改变。
5. 原 `stop` 后等待 12 秒，原 status 仍为 stopped、PID/port 为空；此为本轮有限观察窗口。
6. 原 `uninstall` 两次看到提示后各输入一次 DELETE；父输入端仍打开时 CLI 自然 exit 0。精确 job、私有 descriptor/launcher/install marker/run 已不存在，uninstalled marker 为 true。

[独立复核](../evidence/client-server-service-independent-verdict-20261020.json)再次检查三轮精确 job、所有已知 Supervisor/Core PID、端口均关闭；未观察到三轮自有 Label 的 disabled override 残留。测试根和非安装业务目录按原卸载规则保留，没有删除未知内容。

## 原始失败与边界

- v1 的启动/幂等已通过；探针误把 restart 的 `{restarting:true}` 当成 ready DTO，KeyError 后清理精确服务。修正为原 status 有界等待，产品不因此修改。
- v2 已完成真实重启与停止；两次确认后实际卸载产物/服务已经清除，但 CLI 仍存活，20 秒后探针终止它。只读检查确认 uninstalled marker 存在、安装文件消失。永久测试进一步独立复现 stdin 持有根因。
- 初次干净环境构建/门禁命令遗漏 pnpm 所在 PATH，exit 127；保留原日志，显式绝对 pnpm 路径后正常执行。

原始 v1/v2 证据不覆盖、不改为成功。测试使用 Node24、本机正常构建 `0.0.0-dev`，未采用正式发行下载/更新链，也未连接企业 managed remote authority、模型供应商或其他平台。真实企微、外部 MCP、网盘继续排除。此结果不等同于三平台部署或远端 CI 全部验收。
