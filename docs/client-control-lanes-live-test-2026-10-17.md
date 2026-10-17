# Enterprise 控制载体 owner 修复与真实 Host 验收

2026-10-17，修复 `createZCodeAgentService` 的企业 reverse RPC bridge 只认 chat manager、将当前 plugin/MCP-status client 误判为过期的问题。production 改动仅移动桥的创建位置至三个现有 manager 之后，并从这三个 owner 的既有 `getExistingClient(workspace)` 精确比较 client identity。不新增 helper、owner cache、身份权威或协议，也未关闭 bridge 的 workspace、disposed、异步返回后 owner 重查与取消边界。

## RED 与源码守卫

独立真实 Desktop Host（旧 CLI `0d958862…95454c`）通过正式 McpSync 保存配置、调用状态列表：当前 `personal.connectors` 发布 false→true 均返回 `status=failed/error=enterprise_runtime_obsolete`，独立本机 MCP peer 始终 0 帧。Root 另有独立 Native 证据；此驱动没有操作 Root 的 Native peer。

源码 composition 回归使用真实 process manager 和正式 staged CLI。它观察 manager 返回的真实 client，保留 production 注册的 reverse handler，记录实际 respond 尝试；不伪造 `isCurrent` 或 `getExistingClient` 回执。源码修复前 chat 通过、plugin 被错误拒绝；修复后 chat/plugin/MCP-status 当前 owner 均通过，伪造 workspace 被拒，真实 MCP manager dispose/replacement 后旧回调被拒、新 client 通过，全部 dispose 后三个旧 lane 回调均被拒且 policy 调用数不增长。该迟到回调探针限源码守卫层，不冒充 Native/stdio 的过期消息回放验收。

既有 enterprise bridge 的 6 项 workspace/过期结果/取消/关闭/超时/无效输入回归也全部通过。

## 新正式产物的真实 Host GREEN

Root 统一构建后，未再次修改或构建 out/CLI，直接以 production Desktop Host utilityProcess、MessagePort、实际 McpSync、独立 MCP-status lane、正式 CLI、真实私有后台 HTTP 及自有 loopback TCP MCP peer 复测，1 通过、0 失败/跳过，3.705 秒。

| 当前发布策略                 | 实际状态                                          | 自有 peer 观测                                          |
| ---------------------------- | ------------------------------------------------- | ------------------------------------------------------- |
| `personal.connectors=false`  | `failed`，`enterprise_personal_connectors_denied` | 0 帧                                                    |
| `personal.connectors=true`   | `connected`，`toolCount=1`                        | `initialize`、`notifications/initialized`、`tools/list` |
| 再发布 false，同一 Host/lane | `failed`，`enterprise_personal_connectors_denied` | 新增 0 帧                                               |

保存的个人 MCP 配置字节保持一致，模型调用为 0。状态仍携带既有 `failureKind=network_unreachable`，错误码明确为企业策略拒绝；本报告不将其解释成实际网络故障，也不代替 Root 的 Native 错误展示验收。

| 当前产物            | SHA256                                                             |
| ------------------- | ------------------------------------------------------------------ |
| CLI 源构建与 staged | `a684e40751e1f9bf7e8e7e3710f8518001451ec33d74964e5502a297a1d23d0c` |
| Host                | `dd066c697dd69e519eb835b432d6918c310986bab38b212cf609415c400b78a7` |

自有 Electron/Host/CLI PID 17159、17162、17231 均实际退出；MCP peer 端口 50714 与后台三个端口关闭，临时目录删除。Root 的 peer 61707 与主后端 37266 未参与此测试。

## 文件与检查

spec：`clients/uwork/specs/enterprise-control-lane-ownership.md`；源码守卫：`scripts/client-control-lane-owners-source-smoke.ts`；真实 Host 驱动与 transport launcher：`scripts/client-control-lanes-live-smoke.ts`、`scripts/fixtures/client-control-lanes-host-launcher.mjs`。

证据分别位于 `evidence/client-control-lanes-20261017/red/`、`green/` 和 `source/`；保存 summary、RPC、production Host 日志、HTTP 与清理结果。旧源码 RED 在 `source/red-before-fix.json`，旧版源码 GREEN 在 `source/0d958862-green-summary.json`。

精确 Node 24.14.0 下客户端完整 typecheck 通过，Lint 为既有 114 warnings/0 errors，目标 production 文件单独 0 warnings/0 errors；架构 0 violations。新增脚本的后端 tsc、ESLint、定向 Prettier，以及目标 client oxfmt 均通过。结果限本机 Desktop Host/受控 TCP，不扩展为外部 MCP 服务、远程 Host 或跨平台安装验收。

## final-settings 组合复测：19:26

Root 完成最终技能导入的 Node composition/settings-sync 增量并统一重建 Desktop 后，再次对实际 Host `29ed78eadf5f9529ad4909502aa777e8ecaec27f0c543fa8fa90bb0e041312b5`、不变 CLI `a684e40751e1f9bf7e8e7e3710f8518001451ec33d74964e5502a297a1d23d0c` 执行同一真实 MCP case，1 通过、0 失败/跳过，3.629 秒。此处仅确认原 MCP 控制载体组合未回归，不代替独立的技能导入或 Native 验收。

当前 false→true→false 仍分别为 `enterprise_personal_connectors_denied`、`connected/toolCount=1`、`enterprise_personal_connectors_denied`。自有 peer 仅收到允许阶段的 `initialize`、`notifications/initialized`、`tools/list`；撤权后新增 0 帧，模型调用 0，已保存配置字节不变。自有 PID 32518/32521/32531 均退出，peer 64722 与后台三个端口关闭，临时目录删除。

本 phase 独占 `evidence/client-control-lanes-20261017/final-settings/`，未覆盖既有 RED/GREEN/source。驱动新增 `UWORK_CONTROL_LANES_EVIDENCE_DIRECTORY`，只允许选择本仓 evidence 根下的输出目录；未改生产源、out/CLI、tick 或 TTL。该增量的后端 tsc、目标 ESLint 与定向格式检查通过。
