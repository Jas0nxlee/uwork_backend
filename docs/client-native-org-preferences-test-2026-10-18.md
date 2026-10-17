# Native 企业登录应用偏好与失败提示联测

真实退出、公司偏好 A/B 选择、跳过重开及同 profile 冷恢复通过。旧版本发现的登录错误提示残留已修复：新正式桌面产物的12阶段、4次真实503复测通过，重开或成功换公司可清除旧提示，新失败及直接重试仍显示当前错误。原始失败完整保留；这不是企微认证成功或已认证多企业切换验收。

## 原生基线

使用本仓库正式 Main、Host、CLI 和完整 out 的独占副本，自有 TLS 后台、SQLite、HOME 与 Electron profile。暖 Main59774、冷 Main60334 使用同一后台53050；暖实例与专属 BH 全部退出后才冷启动，未重新写入配置、偏好或初始会话。`app.isPackaged=false`，不是安装包验证。

| 实际操作                 | 观察结果                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------- |
| 初始 A 恢复              | 显示合成 A 账号与公司；初始条件来自合法 email HTTP 及生产加密 store，不是企微扫码成功 |
| 正常退出                 | 真实 logout204，界面未登录                                                            |
| 真实 radio 选择 A/B/A/B  | Host 投影与按钮公司一致，偏好由正常生产路径保存                                       |
| B 上跳过并重开           | B 仍预选                                                                              |
| 同 profile 冷启动        | B 偏好保留，A 认证没有复活                                                            |
| 未配置 B 实际登录一次    | 唯一 `/api/auth/wecom/attempts` 返回503，显示“登录未完成，请重试或跳过登录。”         |
| 失败后跳过、重开、改选 A | 旧错误仍显示；原 AX、文本和截图一致，保留为真实 RED                                   |

A/B 是登录应用偏好，不是已认证多企业 membership 切换。A 有效 begin 始终未点击；B 没有配置企微，也未被认证。没有直接捕获响应错误码，不从服务源码推断本次精确错误码。

两代 Electron Session guard 均在正式 Main 加载前安装，覆盖默认 Session；各2个 Session、283次 owned file 请求，没有外部请求或阻断。守卫范围仅是 Electron Session，不能扩大为 Host/CLI Node 或 OS 防火墙验证。未执行外网挑战，外部取消分支另有纯测试。

模型基线与最终均为夹具初始化的2次本机 supplier 请求、2笔 settled、合计44；Native 操作新增模型和账本均为0、uncertain 为0。没有真实企微、付费模型、外部 MCP 或网盘调用。

## 证据与清理

原始145工件及 manifest 已封存：[run-manifest.json](../evidence/client-native-org-preferences-20261018/run-manifest.json)，manifest SHA 为 `fafdd37ea6752cef978e4656180c2e291689832a6f2d47b0ff01fe7b156af84e`。12阶段、请求、偏好与范围见 [run-summary.json](../evidence/client-native-org-preferences-20261018/run-summary.json) 和 [run-report.md](../evidence/client-native-org-preferences-20261018/run-report.md)。旧错误不是测试驱动误判。

[独立终审](../evidence/client-native-org-preferences-final-review-20261018/review.md) 在封存报告范围内 Required none：15项纯测试、7项语法检查以及 canonical/AX/文本/完整模型正文和账本重放通过；145工件和18准备项、88生产源、6正式产物前后匹配。该审查不把已记录的 UI 缺陷改成成功。

17个自有 PID、4个端口及专属 BH 已退出。私有 `data/client-native-org-preferences-20261018` 因系统 fileproviderd791 仍持8个写句柄而以0700保留，未终止系统进程。仅精确停止已核验的自有后台53050，以避免 common close/TERM 删除仍有外部写者的目录；这是非优雅停止，不是根目录已删除或完整清理。

## 修复验收范围

修复只管理本窗口失败提示的生命周期，Host 继续拥有身份、偏好及诊断。按 service owner 分配窗口句柄，用当前操作的 ticket 和已确认的 attempt ID 区分提示；保留原取消屏障和真实身份投影，不新增后台读取请求。认证成功、旧 start/poll/selection/logout 迟到、偏好写失败及 owner 变更的边界都有定向回归。返回公司选择与跳过仍使用不同的正常交互。

原始 Provider 的真实业务断言先失败，随后11项纯测试、23个真实 React 交互场景与3项既有登录回归通过。首轮 CDP 取值错误、4个不符合正式授权协议的夹具准备失败均单独保留，没有当作产品故障或业务 RED。[代码独审](../evidence/client-native-login-error-code-review-20261018/review.md) Required none；完整 client typecheck、架构与改动格式检查通过，Lint 为113项既有警告、0错误，未放宽门槛。

生产修复与共享 UI 测试分别提交为 `05e1408`、`cd8191d`。正式 Desktop-only 构建通过，CLI/staged CLI 保持 `39175fd…`；新 Main `4d8f2455…`、Host `11a99a27…`、Renderer HTML `08a7b59c…`。新候选记录95项相关源及6项产物，完整 out 的6,662文件、10目录、0链接、138,790,573字节沿原全树快照复制并逐项校验，未筛选或套用旧清单。见 [新候选](../evidence/client-native-login-error-root-20261018/artifacts.json)。

新 Native 使用独立 profile，A 仅作合法初始恢复后正常退出，始终不点击 A 登录。四次 B 请求分别在实际点击后先取得真实 HTTP 503，再确认当前页面：

| 实际链路                       | 新产物结果                            |
| ------------------------------ | ------------------------------------- |
| 第一次失败 → 跳过 → 重开 B     | B 仍预选，旧提示清除                  |
| 第二次失败可见 → 成功选择 A    | A 的正常投影和公开偏好一致，提示清除  |
| 选择 B → 第三次实际失败        | 新错误正常显示                        |
| 同 B 直接重试 → 第四次实际失败 | 取得新的第四次503后，当前失败正常显示 |

每次按独立请求累计1/2/3/4及页面结果共同判定，未把原提示当作重试已完成。最后正常跳过，保持未登录。该12阶段没有驱动失败或业务注入。

新 run 的完整模型请求正文和账本在 before/after/final 中深等价：仍为2次夹具初始化请求、2笔 settled、合计44，Native 增量0、uncertain0。这些是本机夹具初始化调用；本次新 run 只有一个 Main，未重复冷启动。Electron guard 前后均为2个 Session、283次 owned file 请求、0阻断、0官方授权请求，只覆盖 Electron Session。

本次144工件封存于 [run-manifest.json](../evidence/client-native-login-error-fixed-20261018/run-manifest.json)，原文 SHA 为 `534f9b6e41c80b017a9943f6939889119ec1f64ce4bc6f90edc6ae6b20893051`。完整结果见 [run-summary.json](../evidence/client-native-login-error-fixed-20261018/run-summary.json) 和 [run-report.md](../evidence/client-native-login-error-fixed-20261018/run-report.md)。27项准备/依赖及95相关源、6产物共128项前后匹配，旧145与252工件及其 manifest 保持原样。

9个已知自有 PID、4个端口和 BH 均已关闭，Native 正常退出0。新私有目录 `data/client-native-login-error-fixed-20261018` 因系统进程的8个写句柄而以0700保留；仅精确停止已验证身份的自有后台85862，未运行会递归删根的 common close/TERM。这是后台非优雅停止，未声称根目录已删或有完整最终 desktop-traffic。详见 [cleanup.json](../evidence/client-native-login-error-fixed-20261018/cleanup.json)。

Root 后置只读复核：主服务 health200/PID37266，9张业务表、原7个静态资源、4个独占 admin 产物和10项相关源哈希不变，相邻客户端 checkout 干净；见 [main-after.json](../evidence/client-native-login-error-root-20261018/main-after.json)。未读取主 .env、解密主 Vault、重启主服务或将新管理页部署到主实例。

[新 run 独立终审](../evidence/client-native-login-error-native-final-review-20261018/review.md) Required none：144工件与 manifest 前后同，逐一目检12张截图并重放AX/文本、4次请求与时间顺序，重建实际 collect 输入和 verdict 后深等价；128保护项、7项代码及7项运行时源档案、旧397工件与两个 manifest 均保持原样。清理范围和非优雅停止同样保留，不扩为认证验收。

原基线和新 run 的 `fullLoginExperienceAccepted=false` 均保留；本次完成的是窗口失败提示链路。真实企微成功、已认证多企业切换、分享、managed remote/手机及跨平台安装继续单列，本报告不关闭整体 U02/U03/U04/U05。
