# 新 CLI Native 工作流与父结果通知联测

2026-10-17。新正式 CLI/Host 的 Native 完整正向已实际通过：SaveWorkflow 原生批准、工作流中枢运行、UI 取消、原会话同 run 冷恢复，以及完成结果进入父模型请求后形成新的 UI 助手消息。新证据独立于旧 profile；旧 9 条账本和两次父通知 402 保持原样。

## 同版产物与测试配置

| 产物                  | SHA-256                                                            |
| --------------------- | ------------------------------------------------------------------ |
| 正式 CLI / staged CLI | `755438930a2f893a12a2dd339c4b281d06413412ddf3774fd8633f1c33fd63fa` |
| Main                  | `5170a79a4cd71def9f9420ca16fe0652d0f94fc53a5abe955364cee8f93a1f75` |
| Host                  | `d717e06c3a76255109aaf4e200b02c215f2c285f12a9947d153934321c116cc6` |
| Scheduler             | `811f073d0eaaf18610aef903c42d70ebe5a002f4b66401252a057847ec82f20d` |
| Renderer HTML         | `9c10a96d714ac2832d3282e34bcabd041c6f731a4022ae3b442d9d2be7eabaf6` |

先核对父任务正式构建 manifest，再启动新独占 profile `client-native-workflow-label-final-20261017`。快照 6,656 个常规文件、10 个目录、138,699,726 字节，全量源/目标 SHA 一致；CLI 与 stage 另行读取实际字节核对。

仅 alwaysOn 测试模式初始经真实后台 `PUT /limits` 配置成员、部门各 3,000,000，再经 `GET /limits` 核对实际 subject/amount。配置时间、对象和数值保存在新 `initial-test-limits.json` 与 metadata；普通无 workflow 模式仍为成员 150,000、部门 200,000。没有万能 API、直接改 DB、重置账本或变更生产额度逻辑。

这组实际是 `app.isPackaged=false` 的 Native runtime，沿现有 dev alwaysOn 环境路径和正式 `--open-workspace` 参数进入真实独占项目。主 `.env`、主 DB、主 Vault、外部 checkout、远端或付费模型均未参与；源环境读取守卫留证。正式生产安装包灰度来源与锁屏原生目录选择器的边界仍保留。

## 实际链路

run 为 `dwfrun-7be76832-052e-4259-9e22-3032cbd898f0`，原 parent session 为 `sess_9a3f8046-7c16-4e76-a418-210c5d0adcd6`。

| 场景           | 实际证据                                                                                                                                                                                                                                                                                                                                             |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 保存批准       | 原 Native 创建入口填入明确测试提示后发送，SaveWorkflow 富确认显示完整两 ask 脚本及 project 落点。批准前目录不存在；点击“允许”后真实保存 276 字节定义，中枢列出。定义 SHA 为 `e2689578acd179c051536b4d88c77d488c2808b354451ee94dba8b0cb83e5e34`。                                                                                                     |
| 运行与取消     | 实际 Run 创建父会话和 run，第一 ask 完成，第二 ask 已到本机供应商后暂缓。真实 UI Cancel 后为 stopped(user)、可恢复；供应商 socket 在暂缓期间关闭。                                                                                                                                                                                                   |
| 取消父通知     | 后续实际供应商请求收到同 run 的 stopped/user 通知；原父 UI 出现助手消息行 4，生成结束，对应账本 settled。新取消账本保留 uncertain，未退款或抹去。                                                                                                                                                                                                    |
| 冷恢复         | 原 Electron/Host/CLI 等 8 个进程全部退出，保留独占身份、后台和存储；冷启动后从原会话点击 Resume，同 run 到 completed。第一 ask 只有 1 次供应商请求，第二 ask 只有已取消的首次和恢复后的重试。                                                                                                                                                        |
| 完成父结果送达 | 冷恢复前供应商 8 次，恢复后 10 次：新增第二 ask 和完成父通知各一次。最后一个真实父请求含同 run 的 `<status>completed</status>`，以及 `<result>` 中 `first=NATIVE_UI_STEP_1_DONE`、`second=NATIVE_UI_STEP_2_DONE`。随后原父 UI 出现完成通知与新助手消息行 6，区别于旧取消通知行 4，且生成结束。该断言没有依赖详情面板“结果以后台消息投递”的固定文案。 |

新 CLI/Host 的严格 Provider 合同在实际创建、保存、actor 与冷恢复路径中完成代表性消费；Native 模型控件显示 `ucas/联动受控模型`，运行会话显示可读模型名称。模型改名和其他错误文案由父任务的独立 profile 验收。

## 计量、清理与可复核证据

最终 10 次本机供应商请求与 10 条账本一致：9 settled、1 uncertain（新 id `2843c2e05936ce08c13522aab83fa394`，amount=43038），该 uncertain 从取消到最终状态保持不变。记录到的模型 HTTP 正常响应均为 200，0 次 402；273 条后台 `onResponse` 记录不冒称包含中断请求的完整请求总量。旧 profile 的 uncertain=42693 与旧 402 证据未改写。

两次 Native Electron 均 code 0，fixture errors=0。外层确认 17 个已知自有进程退出、4 个端口 ECONNREFUSED、独占数据根删除；两个阶段的专属 browser-harness daemon 均退出并删除目录。未 build 或改写产品 out，未注入 React/store/业务 RPC/journal，未重试被安全拒绝的远端探针。

证据目录：`evidence/client-native-workflow-label-final-20261017/`。

- `artifacts.json`、`native-out-snapshot.json`、`initial-test-limits.json`、`desktop-state.json`：同版 SHA、全量文件验证和实际 API 测试额度。
- `save-workflow-rich-approval.*`、`definitions-before-approval.json`、`approved-definition.json`、`workflow-listed.*`：原生保存确认与真实定义。
- `workflow-running-detail.*`、`workflow-cancelled-parent-settled.*`、`cold-original-run-detail.*`、`cold-same-run-completed-parent-delivered.*`：运行、取消和同 run 冷恢复。
- `before-resume-workflow-proof.json`、`resumed-parent-delivered-workflow-proof.json`、`final-workflow-proof.json`：完整实际模型正文、actor 记录和账本。
- `parent-rows-before-resume.json`、`parent-result-delivery-dom.json`、`workflow-positive-assertions.json`、`summary.json`：新的 UI 消息行和父请求完成结果对应。
- `native-runtime-before-cold.json`、`native-runtime-after-cold.json`、`runtime-env-guard-*.json`、`cold-stop-proof.json`、`outer-cleanup.json`：真实 runtime、读取守卫和清理。

固定 Node 24.14.0 运行新目录的 `verify-evidence.mjs`，可只读重核关键证据，不启动服务、不请求模型。该验证器已通过；本轮预算/spec 变更的 Prettier、ESLint、Node 语法检查通过。
