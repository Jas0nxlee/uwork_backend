# macOS 原注册 Server：隔离修复与更新状态保持（2026-10-20）

本轮真实 Darwin arm64 原构建、launchd 和公开 WebSocket SDK 测试通过 8 项。不是 Desktop 更新；Desktop updater 仍未开启。旧、新包均为 3.16.0，结论只称同版构建替换。

## 实际缺陷与 RED → GREEN

原 `ServerLayout.dataBaseDir` 对非标准显式 root 已约定隔离，但 Supervisor 只覆盖 `ZCODE_DATA_BASE_DIR`：业务 paths 优先读取继承的 `UWORK_DATA_BASE_DIR`，Setting 使用桌面 HOME，SettingSync/其他默认路径使用 HOME/homedir。注册服务不继承调用 CLI 的临时 HOME，直接测原包可能写真实用户目录，因此先使用全部自有 temp roots 重现。

永久测试 `clients/uwork/packages/zcode-server-cli/test/serverCoreDataRootIsolation.e2e.mjs` 启动原 staged Core，使用原 ReleaseManager 安装所有权、原 fork/IPC 和原 SDK。HOME、UWORK、DESKTOP_HOME、Storage 是四个冲突临时目录；显式 server root 为第五个临时目录。旧包真实输出：System.home 在 home、默认 workspace 在 uwork、Setting 在 desktop，RED。测试关闭 Core exit0 并删除临时目录。前两次测试框架问题（缺少原安装所有权 marker）不算产品 RED，实际 RED 是 v3。

修复用一个纯 Server profile 工厂，Supervisor 在 fork 前合入；Core entry 在动态加载业务服务前再次绑定，支持旧 Supervisor 启动新 Core。HOME/USERPROFILE、桌面 HOME、UWORK/ZCODE data base、Storage 与 server-root 均归属原 layout。父进程和 launchctl 全局环境不变。标准 `<home>/.zcode/server` 仍映射原 home。此合同是默认 profile 所有权，不是文件系统 sandbox，不限制显式外部路径。

证据：

- [真实 RED v3](../evidence/client-server-core-profile-isolation-red-v3-20261020.log)
- [原新发行 Core E2E GREEN](../evidence/client-server-core-profile-isolation-green-20261020.log)，1/1，约 1.7 秒；这同时验证了 tsup 打包后动态初始化顺序。
- [纯工厂及既有 Server 回归](../evidence/client-server-core-profile-unit-green-20261020.log)，9/9。
- [spec](../clients/uwork/specs/server-core-profile-isolation.md)

## 原发行链和隔离守卫

HEAD 1db59c77 基础上正常执行 `pnpm --filter @zcode/server-cli build` 与原 `stageCli.ts --target darwin-arm64 --skip-agent-build`。未重写原版本、manifest、SHA 或归档；未构建 Desktop、未重建 Agent。

| 原产物           | SHA-256                                                            |
| ---------------- | ------------------------------------------------------------------ |
| 旧 Darwin 3.16.0 | `d365b09a5a1cc523248ac3cb67fb3b67c647d57bacd43150206d18b729adc635` |
| 新 Darwin 3.16.0 | `1d3fe925c269c9e75cce860095b240a963742807aad93a4d58451bf6ac7972d1` |
| 两包 Agent       | `cdf781ecf004b9639157fae25e6e96e558b95faefaee7aab09488d5dc650ecac` |

原包完整树和 tar 分别冻结在 `/Users/ljp/Library/Caches/uwork-backend/client-macos-server-service-update-20261020/{old,new}` 与 `{old,new}.tar.gz`。本轮 producer 前后 Linux 7774 原包及 cdf Agent 不变；随后 Linux 产物交由 Root 单独 staging，不能把后续 Linux 归档算本轮 Darwin 更改。

真实测试只有自有 `/private/tmp/uwmupd-RMAodJ/server` 和唯一 label `com.zhipu.zcode.server.76bc6464`。注册前 exact job 不存在，且该 label 无 disabled override。核原生成 plist/stable launcher；从 `ps eww` 仅提取并记录七个允许的 profile 字段，不保存完整进程环境；SDK `System.info().homedir` 必须等于本轮 root，随后默认 workspace 也必须在 root，才能进行业务写入。

为保护真实 HOME，注册的是新安全 Supervisor；原 update 首先安装旧原包 Core，再更新新原包 Core。没有注册不安全的旧 Supervisor，不能据此宣称旧 Supervisor 自身的注册环境已修复；旧 Supervisor→新 Core 路径由永久 staged Core E2E 独立覆盖。

## 真实结果

[机器结果](../evidence/client-macos-server-service-update-v1-20261020/result.json)；[原命令日志](../evidence/client-macos-server-service-update-v1-20261020.log)。

Root 随后独立核验原 v1 的归档、四 Core profile、SDK 同 ID 完整状态、三 Agent、HTTP、双确认及资源闭环，16/16 通过，见[独立 verdict](../evidence/client-macos-server-service-update-v1-20261020/root-independent-verdict.json)。Root 也实际重跑 [staged Core E2E](../evidence/client-server-core-profile-root-e2e-20261020.log)，1/1 通过。

1. 唯一 label 缺席；原 `serve --daemon` 真实注册并 ready。
2. 四个实际 Core（bootstrap、旧包、新包、restart）七项 exec profile 与 SDK homedir 全部归本轮 root，HTTP 均 3.16.0。
3. 旧 Core 原 SDK 写 `.zcodeignore`、locale/terminal 设置、个人本地 fixture Provider、两条明确标注的 importedHistory；没有模型 prompt。
4. 保持旧 SDK WebSocket 连接执行原 CLI update；原旧→新归档发生替换，原 `current.json.archiveSha256` 等于新原包。旧 socket 自然关闭，旧 proxy 明确拒绝而非观察超时。
5. 新 SDK 使用原 `resumeTask` 冷恢复同 task/session ID，完整消息对象、消息 ID/正文、task title、观察到的独立 session title、mode/model/thought、Provider、设置、文件完全保持。没有手写业务数据库或补写 current/pending。
6. 原 restart 再换 Core 与 Agent PID，第二次 cold resume 后同样状态保持。
7. 原 stop 后实际等待 12 秒，未被 launchd 重拉。
8. 原 uninstall 收到每个真实提示才分别输入 DELETE，exit0、两次确认，job/plist 均消失。

实际 HTTP 收据只有两次 `/catalog.json` 及各一次 `/old.tar.gz`、`/new.tar.gz`，没有模型 inference 请求。Supervisor/Core/Agent 共 8 个 PID 全退出，catalog/Core 共 5 个端口全关闭，原卸载保留用户 Setting 数据后，本测试单独删除全部自有临时目录。后台 3000/PID92288 保持原进程且 health200，见[产物与主服务后验](../evidence/client-macos-server-service-update-final-artifacts-20261020.json)。

**精确系统边界：** 原 `launchctl unload -w` 留下本轮 label 的 disabled 元数据；loaded job 已不存在且无进程/监听。既有其他四个 disabled override 逐项未变。未编辑系统持久 override 数据，不声称系统痕迹全部清除，也不把 disabled 元数据等同残留运行服务。

## 复跑入口与门禁

从 backend 根运行（使用已冻结原 Darwin 包，不重跑 producer、不碰 Desktop）：

```sh
/Users/ljp/.cache/uwork-client-toolchain/node-v24.14.0-darwin-arm64/bin/node \
  --import ./clients/uwork/node_modules/tsx/dist/loader.mjs \
  scripts/tests/macos-server-service-update-probe.mjs \
  client-macos-server-service-update-next-20261020
```

每次生成独立目录/label；传入新的证据名称。脚本的后续自有临时目录删除自动进行；v1 的同等目录删除在成功结果后单独执行并写回实收 cleanup 字段，没有再次调用业务 API。

本轮 `pnpm typecheck`、`pnpm lint`、`pnpm architecture:check --changed`、目标文件 oxfmt check 均 exit0，记录分别在 `evidence/client-server-core-profile-{typecheck,lint,architecture-after,format}-20261020.log`。源仅涉及 Server factory、CLI fork 和 Core entry；永久测试/spec 与独立 Mac probe 另列，未动 Desktop Main/原始客户端仓库。Root 独立审核通过后，按明确授权以六文件原子提交 `a53f8930` 固化源、spec 和永久测试；独立 Mac probe/本报告另保留，未混入该修复提交。

未覆盖：真实不同发行版本升级；旧不安全 Supervisor 的直接 macOS 注册；外部 MCP/网盘、真实企微浏览器和推理。Linux systemd 属 Root 的独立证据，不与本轮混算。
