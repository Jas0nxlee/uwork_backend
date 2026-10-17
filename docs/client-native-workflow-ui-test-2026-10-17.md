# Native 动态工作流 UI 联测

2026-10-17。当前正式 CLI 与重建 Desktop out 的原生工作流切片已实际完成：保存确认、运行、取消、原会话冷恢复、当前文件撤权拒绝和运行中 second-instance 目录切换。所有动作经 DOM/AX、鼠标键盘或源码已支持的正式启动参数完成。

这组使用**正式 out 字节、真实 `app.isPackaged=false` 的未打包 Native runtime**，通过原有 dev `ZCODE_DYNAMIC_WORKFLOW_MODE=alwaysOn` 路径开启。它不关闭正式 production 安装包的灰度启用缺口：现用 CodingPlanSubscriptionService 不再请求旧远端 configs，打包 production 的 Main 又删除本地覆盖；Preview 的现有固定 alwaysOn 路径另列。未注入 React/store、业务 RPC、journal 或 workflow 事件，也未增加后台产品功能。

## 产物与真实状态

| 产物                          | SHA-256                                                            |
| ----------------------------- | ------------------------------------------------------------------ |
| 正式 CLI / Desktop staged CLI | `a684e40751e1f9bf7e8e7e3710f8518001451ec33d74964e5502a297a1d23d0c` |
| Main                          | `5d28e6e2075ad32605ddc2491bd5f868925cd650e345aade8bcffa604d417d09` |
| Host                          | `8bb5f4d9953f01320451ca257edc55a5271eaa2c6ec235c163c591a903985b07` |
| Renderer HTML                 | `cf21175f8432ed054a1969bcd14f289af348ef1540f795a72c9b86a8e330cc6a` |

测试快照包含 6,656 个常规文件、10 个目录和 138,694,888 字节；全部源/目标 SHA 相同，0 个符号链接，复制加校验为 14,492ms。正式 CLI/source 与 staged 另以实际 SHA 核对。Main/Host/Renderer 属于父任务已独立审查后重建的版本，包含 renderer-ready 与个人技能管理修复；本组没有 build 或修改产品实现。

run ID 为 `dwfrun-c1aee0ca-2b26-4c7a-b2eb-c7ab8fe4922d`，原 parent session 为 `sess_1f195aac-9484-4bdc-ba26-fe279ccb7993`。

## 实际结果

| 场景                   | 观察与边界                                                                                                                                                                                                                                                                                           |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native 保存批准        | 企业 agents 菜单进入工作流中枢，“通过对话创建”进入普通 Native 会话；明确提示后，真实 SaveWorkflow 富确认显示 project 路径、说明和完整两 ask 脚本。批准前定义目录不存在；点击“允许”后保存 276 字节定义，中枢列出 1 项。定义 SHA `e2689578acd179c051536b4d88c77d488c2808b354451ee94dba8b0cb83e5e34`。  |
| Native 运行            | 点中枢 Run，原 V4 owner 创建新 parent session / run，真实 actor 第一 ask 完成，第二 ask 已到自有供应商后暂缓。UI 详情为 running、1/2 步。                                                                                                                                                            |
| Native 取消            | 从真实详情按钮取消，UI 为 stopped、你停止的、可恢复；第二 ask 的供应商 socket 在暂缓期间真实关闭。取消不是零派发，也未退款或删除账本。                                                                                                                                                               |
| 原会话冷恢复           | 原 Electron/Host/CLI 等 8 个进程全部退出，保留独占后台、身份和存储；冷启动后在原 session 点 Resume，恢复同一 run ID 到 completed。供应商 8→9，只新增第二 ask；第一 ask 总数仍为 1，未重跑。                                                                                                          |
| 当前文件权限拒绝       | 已保存定义可见时，实际后台发布 filesystem=false，再点 Run。UI 显示“工作流启动失败”；供应商 9→9、actor 3→3、任务列表不变，旧定义 SHA 不变。恢复权限后，经原 UI 运行历史核对仍只有原 run 一项。Native UI 使用通用提示，本组未直接采集原 start ACK 的 reason code，不把源码拒绝码当作已捕获的 UI 数据。 |
| 同运行 Main 的目录打开 | 冷恢复后的同一 Main 52040 接收第二进程 53491 的正式 `--open-workspace <owned project-second>`。第二进程 code 0，原 Main 仍在；日志仅 1 次实际路由成功，0 次 cached，DOM 新项目只有 1 项。经普通对话入口核对当前 composer 项目确为 project-second，未手选该项目。                                     |

最终记录 9 次本机供应商请求与 9 条账本：8 settled、1 uncertain（原 id 与 amount=42693 保持）。`onResponse` 记录 336 条后台 HTTP 响应，其中 2 次 `/v1/chat/completions` 为 402，UI 显示“可用额度不足”：它们是取消与恢复后父结果通知遭原测试限额拒绝的真实结果。**run 已完成不等于父结果消息投递成功**；这一成功链未由本组关闭。中断请求不一定进入 onResponse 记录，336 不冒称完整请求总量。没有重置旧账本或改额度制造成功。

## 旧观察、准备失败与清理

初始旧 Main `156106...` 接受 second-instance 后一直 cached，20 秒后 DOM 仍无项目；完整旧日志、真实 argv/进程与 DOM/AX/截图保留在 `evidence/client-native-workflow-ui-20261017/`。父任务确认 UI 没有调用现存 notifyRendererReady，独立修复并重建后，本组在同运行的新 Main 完成上述正向。原生系统目录选择器受 macOS 锁屏阻断，未绕过锁屏，仍未验收；正式冷启动/second-instance 参数路径不能替代它或系统深链注册验收。

串行 clone 准备阶段 10 分钟仅复制部分文件，专属进程和 hash reader 随后按协调停止，三端口关闭、partial 目录删除；记录在 `evidence/client-native-workflow-ui-cold-20261017/preparation-abort-cleanup.json`。新的测试快照 helper 有界并发、失败后停止新 job 并 drain 在飞 IO、保留 hidden/map/空目录、符号链接按原 cp 语义处理，4 个小型文件系统测试通过。没有跳过 map、删除源 out 或将准备中断当作产品失败。

最终 Electron 两次均 code 0，fixture errors=0；外层逐项确认 18 个已知自有进程退出、4 个端口 ECONNREFUSED、独占数据根删除，两个专属浏览器 daemon 在各阶段已退出并删除其目录。源环境读取守卫留证。没有读取主 `.env`、主 DB、主 Vault，未碰外部 checkout，未使用远端或付费模型、真实企微、外部 MCP/网盘。

## 可复核证据

完整目录为 `evidence/client-native-workflow-ui-final-20261017/`：

- `summary.json`、`artifacts.json`、`native-out-snapshot.json`：最终边界、同版产物与全量文件验证。
- `save-workflow-rich-approval.*`、`definitions-before-approval.json`、`approved-definition.json`、`workflow-listed-after-approval.*`：实际批准与定义。
- `workflow-running-detail.*`、`workflow-cancelled-by-ui.*`、`cold-original-run-detail.*`、`cold-same-run-completed.*`：真实状态和同 run 冷恢复。
- `cold-resume-comparison.json`、`final-workflow-proof.json`：完整模型正文、actor 步骤、账本与已记录 HTTP 响应。
- `filesystem-denial-comparison.json`、`run-history-after-denial.json`、`filesystem-revoked-run-settled.*`：当前拒绝与历史保留。
- `second-instance-assertions.json`、`open-workspace-secondary-proof.json`、`second-instance-active-project-chat.*`、`electron.log`：同 Main 目录切换。
- `native-runtime-before-cold.json`、`native-runtime-after-cold-before-secondary.json`、`runtime-env-guard-*.json`、`cold-stop-proof.json`、`outer-cleanup.json`：真实 runtime、冷退出与最终清理。

固定 Node 24.14.0 可只读重跑 `evidence/client-native-workflow-ui-final-20261017/verify-evidence.mjs`；它不启动服务、不请求模型、不读数据库或凭据。交互驱动的首次创建跳转期间输入未实际成为用户消息、过早等待同名旧 DOM 以及过长 BH_HOME 的 AF_UNIX 错误均已作为驱动观察保留，未算作产品失败；正式保存使用已核对的后续用户输入，后续点击使用目标 test-id 就绪后操作。
