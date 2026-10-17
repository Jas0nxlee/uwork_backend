# 本地 Host 中断、配置恢复与追踪关闭联测

2026-10-18。独立后台与真实未打包 Electron 已完成本轮验收：同一个 Main 和原 CDP target 中，Host 中断后经标准页面重载创建新 Host、自然恢复原身份；新 Host 连接收到关闭配置后，54 次真实设置导航没有新增 Renderer 追踪。帮助禁用入口与用量零增量也已验证。本组使用合成企业会话和本机受控供应商，未执行真实企微 OAuth。

## 实际结果

正式客户端仍为 CLI/stage `39175fd`、Main `c3d27b`、Host `9afc1a`。本轮只修改测试观测层，未重新构建或改变客户端产品代码。

| 阶段         | 实际证据                                                                                                                                                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 故障前       | 54 次实际设置导航，收到 R0 的 12 条导航 span。                                                                                                                                                                                       |
| 单次故障     | 交叉核对本轮模块日志、父子 PID、启动时间与独占 cwd 后，仅对 Host 38889 发一次 SIGKILL；实际退出码 9。                                                                                                                                |
| 同 Main 恢复 | Main 38879 与原 CDP target 保持不变。实际没有错误页重载按钮，使用受控 `Page.reload`；新 Host 39502 从原加密 store 自行恢复账户与模型，测试未重写身份。                                                                               |
| 恢复后       | 另 54 次真实导航，收到不同 Renderer instance R1 的 14 条 span。                                                                                                                                                                      |
| 关闭配置送达 | 真实 API 发布 desktop v2；收据 #58 为 HTTP 200、上游完整结束、下游完整发送，实际字段为 trace=false/0/[]。当时 lsof 核对 H1 的活连接为 `127.0.0.1:55736 → 127.0.0.1:53485`，与代理收到的下游端口一致，H1 父子关系及启动时间前后相同。 |
| 关闭后的行为 | 在该收据发送完成后再做 54 次实际导航，新增 R1 导出 0；旧在途或晚到 span 0。判据检查真实 UUID、span 时间和接收时间，未合成 batch 或替换随机数。                                                                                       |
| 帮助禁用     | 实际命令中心点击“问题上报”，旧工单 Dialog 0、旧反馈 HTTP 0。没有点击外部链接；未单独监视 OS opener，不声称系统层外链已验收。                                                                                                         |
| 用量         | 夹具原有 2 次初始化请求、2 条 settled、44 内部测试 Credit 前后完全相同；本轮 Native 没有发送模型任务。                                                                                                                               |

最终 79 条配置收据全部 `sent`，128 条上限内无丢弃、无 pending；HTTP 没有 400 及以上响应。[完整冻结报告](../evidence/client-native-host-recovery-fixed-20261018/run-report.md) 保留实际输入、日志、配置、TLS 归属、追踪及账本。

## 真实测试纠正了观测层假设

首轮已取得同 Main 的 Host 恢复及 R0/R1 正向，但最终 60 条配置收据全部被观测器拒绝，因此没有继续宣称关闭验证通过。原因是测试层误将 `fetchedAt` 当作 ISO 字符串；真实 `src/client.ts` 使用 `core.now = Date.now`，返回毫秒数值。原 12 个合成测试沿用了同一错误假设，没有证明真实 DTO 兼容。

保留 [首轮部分结果与 RED](../evidence/client-native-host-recovery-20261018/run-report.md) 后，新增独立 createApp、临时 SQLite、随机本机 TCP 后台和代理的回归。默认、开启、关闭三阶段均直接使用真实 JSON；每次运行 13 个实际 API 请求，校验版本 0/1/2、原始数字时间处于 GET 时间窗、转发字节与响应头相同，模型/账本/凭据均为 0。修复前全部拒绝，修复后全部 `sent`。不转换 API 或旧证据，不增加 number|string 兼容。

数字合同修复提交 `91d2ba5`；13 项合成反例和真实 TCP 回归均经独立复跑，Required none。详见 [真实 HTTP RED→GREEN](../evidence/client-native-configuration-witness-fetched-at-20261018/report.md) 与 [独立审查](../evidence/client-native-configuration-witness-fetched-at-review-20261018/peer-NHC3Yt/review.md)。原夹具与 OTLP 接收逻辑 SHA 保持不变，新 profile 另起复测，旧 JSON 和旧进程没有热补。

## 独立核验与边界

Root 重新计算了两组正向 span、关闭后的判据和模型/账本对照，结果与保存证明一致；核对本轮 134 项及旧 107/70/125 项证据、88 项产品源码和 6 项产物 SHA。11 个已知 PID 全部退出，4 个端口关闭，独占数据根及 BH 目录删除。[Root 复算和资源核验](../evidence/client-experience-20261017/root-host-recovery-final-proof.json) 是保存证据的独立重算，没有重复执行 Native 故障。

这次证明的是受控页面重载恢复，不是错误 UI 按钮或自动重启。相同窗口依据为同一实际 CDP target、Main 启动信息及源码关系，未直接测量 webContents sender ID；两个 Renderer ID 也不替代完整旧 child 迟到 IPC 隔离。正式安装、系统 chooser/Dock/外链、公开市场排序和远端等边界继续保留。真实企微、外部 MCP 和网盘仍未测试。

Root/admin noEmit、lint、新文件定向格式与语法检查通过；全量格式检查仍报告既存无关 `tests/security-sixth-provider-echo.test 2.ts` 的样式问题，该用户文件保持原样。Main 独立检查与 CLI 工具链的既有限制仍列在[覆盖清单](client-integration-coverage-2026-10-17.md)。

最终[主环境只读复核](../evidence/client-experience-20261017/main-after-host-recovery-final.json)：3000 端口 health 200、原 PID 37266，9 张业务表哈希不变，7 个现有静态文件、4 个独立管理页资产和对应源码均不变，相邻客户端仓库干净。本轮没有重启或重新部署主服务；新管理页面使用独立构建验收。

会话分享仍是未完成能力：目前只有自有分享权限校验，发布存储仍依赖旧账号接口。企业内登录访问与外部公开链接的合同已列成[只读方案](../evidence/client-native-sharing-readonly-20261018/plan.md)，正在等待用户选择，不默认开放公开分享。
