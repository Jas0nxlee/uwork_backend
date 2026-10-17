# Native 企业模型名称与文件拒绝提示联测

2026-10-17。模型名称从自有后台经现有 Gateway、Provider 同锁写入和 ModelSelection 投影到 Native 控件，实际改名和冷启动对话通过。文件权限拒绝已沿原 exact-code 入口显示中文提示；撤权点击没有改写文件，恢复权限后真实开关能够写入。

## 同版产物与实际结果

正式 CLI 和 Desktop staged 均为 `755438930a2f893a12a2dd339c4b281d06413412ddf3774fd8633f1c33fd63fa`。Main 为 `5170a79a4cd71def9f9420ca16fe0652d0f94fc53a5abe955364cee8f93a1f75`，Host 为 `d717e06c3a76255109aaf4e200b02c215f2c285f12a9947d153934321c116cc6`，Renderer HTML 为 `9c10a96d714ac2832d3282e34bcabd041c6f731a4022ae3b442d9d2be7eabaf6`。完整 manifest 位于 `evidence/client-model-label-20261017/artifacts.json`。

新 strict Provider 字段需要 CLI 与桌面整套迁移；Root 实际按官方 CLI → stage → Desktop 顺序构建，不能将旧 a684 产物当作可兼容版本。独占 Native profile 复制并逐文件核对 production out，运行真实未打包 Electron；初始身份来自真实 email HTTP 登录和生产加密存储恢复，不是真实企微登录。

| 检查         | 实际观察                                                                                                                                                                                                                                                                     |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 初始名称     | 原生 composer 显示 `ucas/联动受控模型`，不再显示不透明模型 ID。                                                                                                                                                                                                              |
| 同 ID 改名   | 夹具经真实 admin GET 当前 revision / PUT 原模型 ID 改名；从 Native 使用统计→企业网关→“重新读取”触发原同步，composer 和展开的模型选择器显示“联动受控模型-原生已改名”。                                                                                                        |
| 改名后对话   | Native 输入并发送 `NATIVE_LABEL_EXECUTION_ONE`，真实助手回复完成，供应商和账本记录主调用与标题调用。                                                                                                                                                                         |
| 撤文件权限   | 先通过实际配置 API 允许个人技能和文件能力，原设置页列出自有输入 `owned-toggle`；延迟真实配置响应保留旧可见开关，后台发布 filesystem=false 后实际点击。显示“企业已限制文件访问，无法读取或修改技能。请联系管理员。”，不再显示内部码；CLI config 仍不存在，技能正文 SHA 不变。 |
| 恢复权限     | 恢复真实配置响应和文件权限，沿同一设置页开关禁用技能；AX 为 unchecked，实际 CLI config 记录原 SKILL.md 的 `enable=false`。                                                                                                                                                   |
| 冷启动新 CLI | 原 Main/Host/CLI 等 9 个已知进程全部退出，保留后台和原存储。冷启动同一 profile 后名称仍正确，发送 `NATIVE_LABEL_EXECUTION_TWO` 再次完成；实际 Provider 文件仍为同一后台模型 ID、当前名称 map、enterprise-session，未出现凭据字段。                                           |

共 6 次本机受控供应商请求、6 条 settled；其中 2 次是另一成员初始化对照，4 次为两组 Native 主调用与标题。实际供应商收到的执行模型始终为原后台映射的 `controlled`，账本模型 ID 均保持原值。没有付费模型调用或前端下载后台 API Key。

名称缺失、换 owner、旧清空迟到、401/403/402 清空与重启属于另一组真实 HTTP/source 13 阶段证据，不冒称 Native 已逐一完成。企业网关目录卡仍按其原设计展示模型 ID；本次名称验收范围为 ModelSelection 控件和运行时。

## 验证与保留边界

完整 enterprise-policy：Core 106、Host 274，全部通过；新增名称 8 项 service、1 项 UI 和1项真实 HTTP 已包含于各相关命令，不与全量数量叠加。独立 reviewer 重跑相关 79 项和 UI/HTTP 2 项均通过，冻结 19 文件 SHA 前后相同。类型检查、严格测试类型、Lint、格式与架构通过；最终 Lint 为 113 条既有 warning、0 error。

新产物另完成 9 项 child/expert/personal 实际 CLI 回归，以及工作流 10、skills stdio 合同 1、私有 relay 5，共 25 个实际命名检查。9 项分组为 996 HTTP、57 supplier/57 settled；工作流/relay 的 15 个隔离 fixture 为 1884 HTTP、62 supplier/62 ledger（60 settled、2 uncertain），skills 合同不虚构其未记录的计数。旧产物证据已归档。

Native 本组两次 Electron 均 code 0，fixture errors=0；17 个已知 Native/Host/CLI/fixture 进程退出、4 个端口关闭、数据根和两阶段专用 browser-harness daemon 已清理。第一次准备因未分配 PTY 导致交互 stdin 关闭，启动产品前已关闭并核对根/端口清理，保留在独立 preparation 目录；它是驱动错误。一次等待使用错误的界面文案，另一次技能初始权限仍为默认 false，均按实际 DOM 和后台配置纠正，没有算作产品失败。

日志另发现 desktop context prompt、client-scenes 和 help 配置请求 404，当前正按现有功能合同调查，不能据本组对话成功声称全部后台配置链路已通过。原生系统选择器受锁屏限制、生产安装包工作流启用来源、Native 分享/组织切换、managed remote/手机及跨平台安装继续单列；真实企微、外部 MCP 和网盘继续排除。

证据目录 `evidence/client-native-model-label-20261017/` 保留初始/改名/选择器/对话/拒绝与恢复/冷启动的 DOM、AX、截图，`cold-provider-model-identity-proof.json`、`filesystem-denial-proof.json`、`filesystem-restored-proof.json`、`final-ledger-proof.json` 和 `outer-cleanup.json`。`evidence/client-model-label-20261017/main-final-proof.json` 只读核对主后台 health=200、原 PID 37266、9 张业务表哈希未变，相邻客户端 checkout 仍干净；未读主 .env、解密主 Vault 或重启主服务。
