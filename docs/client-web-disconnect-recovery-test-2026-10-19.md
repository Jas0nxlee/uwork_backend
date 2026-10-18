# W02 Web 断线与显式重试联测（2026-10-19）

W02 新增覆盖已完成：修复连接关闭后 RPC/UI 不退场，以及恢复工作区改变 Hook 调用序列的两个问题。最终 42 项相关回归、完整门禁、Server/Web/Desktop 正常构建均通过；Electron41 独立 Web 的真实断线、四种宽度、原键盘 Retry、Cookie/项目/文件恢复通过，脚本与控制台错误均为 0。测试控制器的非零退出仅涉及保留诊断目录，详见资源边界。

既有 W01 手动新建 WebSocket 和 Web v8 页面 reload 没有覆盖成功连接后的关闭。此前“本机当前可运行独有切片已完成”的结论过宽，已撤回；本报告只验收明确列出的 W02 范围。

## 确认的缺陷与修复

旧版 `a85570c5771cccd9e0548457fa8baf604032e7f1` 的 Web `onClose` 为空，连接持有者没有释放 `ChannelClient`。原生 WebSocket 和原 RPC 的两项合同实际失败：在途、初始化前排队以及关闭后新请求保持 pending。浏览器通过原界面完成 Cookie、引导、目录和文件预览后，精确停止该轮服务端；同一页面的已认证连接确实关闭，但旧工作区仍显示，没有断线提示或 Retry。

修复提交 `409c0601d43cbc072c33981c813db3a7145847a3` 仅涉及客户端七个文件：规格、三个产品文件和三个永久测试。连接私有持有并幂等释放原 RPC、协议与 socket；error 可以先释放资源，公开 onClose 仍只传递随后真实 CloseEvent。Web 防止迟到的启动结果重新挂载旧 Root，显示静态中英文断线提示，聚焦标题，沿现有 Retry 按钮 reload。没有新增自动重连或业务请求重放。

## 已执行证据

| 层次                 | 结果与范围                                                                                                                                                                                         | 证据                                                                                                                                                                        |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 原 RPC RED           | 2 项实际失败，4 个 pending 观察；真实 loopback、原 ChannelServer/Client 与文件读取，模型 0                                                                                                         | [原始记录](../evidence/client-web-close-rpc-preparation-20261019/manifest.json)、[独立复核](../evidence/client-web-disconnect-audit-20261019/rpc-red-independent.json)      |
| 浏览器 v1/v2         | 测试驱动基线失败，不计产品 RED。v2 定位到跨页面累积的两个 101 候选；旧页面导航未产生可用 Closed 事件，不能据此推断旧 TCP 状态                                                                      | [v1](../evidence/client-web-w02-red-20261019/manifest.json)、[v2](../evidence/client-web-w02-red-v2-20261019/manifest.json)                                                 |
| 浏览器 v3 RED        | 6 项基线通过；匹配当前页面原 101 连接的实际 Closed，error/Retry/旧工作区隐藏均 false；原 PTY exit1，未重启或 reload                                                                                | [原始记录](../evidence/client-web-w02-red-v3-20261019/manifest.json)、[独立复核](../evidence/client-web-disconnect-audit-20261019/browser-v3-independent.json)              |
| 正式永久合同         | 14/14，skip0，exit0；真实 WS/RPC 拒绝、实际 CloseEvent 一次通知、listener 释放、onOpen 竞态、启动时序及双语 React markup；定向格式/Lint/架构通过                                                   | [正式收据](../evidence/client-web-close-formal-20261019/manifest.json)                                                                                                      |
| 标准门禁与正常构建   | 根 `pnpm typecheck --force`、`pnpm lint`、`pnpm architecture:check`、Server tsup、Web build 全部 exit0；Lint 113 项既有警告、0 错误；架构 0 违例                                                   | [构建记录](../evidence/client-web-disconnect-green-build-20261019/manifest.json)、[独立复核](../evidence/client-web-disconnect-audit-20261019/green-build-independent.json) |
| 修复版浏览器首次复测 | 基线 6 项、断线 8 项通过；320/768/1024/1440 无横向溢出，标题/按钮可见，真实 Tab 聚焦。原 Enter 重试已走到恢复文件点击，但恢复阶段有 1 条未知控制台错误，未取得完整恢复通过结果；原 PTY exit1       | [原始记录](../evidence/client-web-w02-green-20261019/manifest.json)、[独立复核](../evidence/client-web-disconnect-audit-20261019/browser-green-v1-independent.json)         |
| 恢复诊断 v2/v3       | Enter、新 document、Cookie200、引导、工作区、文件预览及新 WS 的实际方法均返回成功；仅最终日志门因 1 条 TypeError 失败。新采样没有 App/Scoped 错误面板，完整联测仍判失败                            | [v2](../evidence/client-web-w02-green-v2-20261019/manifest.json)、[v3](../evidence/client-web-w02-green-v3-20261019/manifest.json)                                          |
| 最终 v4 业务通过     | 修复 Hook 后，基线 6 项、断线 8 项、恢复 6 项全部 true；四种宽度无横向溢出，Tab 聚焦、唯一 Enter Retry、新 Cookie 访问、原项目和文件恢复通过，文件字节不变；console0/script0，三个 UI driver exit0 | [最终记录](../evidence/client-web-w02-green-v4-20261019/manifest.json)、[Root 独立复核](../evidence/client-web-disconnect-audit-20261019/browser-green-v4-independent.json) |

v3 的连接证据从原 `open_app` 导航边界开始，只关联当前页面创建的唯一 101 连接及随后关闭；保留之前累计的脚本和控制台错误计数，没有选择“最新候选”的模糊兜底。浏览器为独占 Electron41 内嵌 Chromium，运行正常 Web/Server；没有 Desktop Main、身份或 Cookie 注入、登录或模型发送。

永久合同中的 React 静态 markup 不证明实际焦点和键盘行为。最终 v4 使用真实 Input 验证 Tab/Enter，恢复步骤布尔只有在原方法返回后才置 true，之前稳定出现的 TypeError 已消失。以上字段是同一端到端流程的检查点，不作为 20 个独立测试重复计数。

## 恢复阶段发现的第二个缺陷

八帧受控错误位置映射到 React 依赖数组比较、`updateCallback`、Zustand、`useTabStore` 和原 workspace 服务解析链。映射必须使用 JavaScript UTF16 字符串及 LF 行切分；Python `splitlines()` 会把构建文件中的其他 Unicode 分隔符也拆成行，不能用于这些 V8 坐标。

静态审查发现 Session、Agent、Task 三个服务 Hook 都采用 `workspacePath ? useWorkspaceServices(...) : useServices()`。前者调用额外的 Tab/Zustand Hooks，恢复工作区后会改变同一组件的 Hook 序列。[真实 React 回归 RED](../evidence/client-workspace-service-hook-preparation-20261019/red-r1.json)的三项路径变化全部复现同样 TypeError；九项无路径、无 TabProvider、当前上下文、远端 identity/registry 等兼容合同通过。

后续修复提交 `cd0127ad1af132978715d2631c09e9895d4c9e72` 将三者统一到固定调用链，最后才选择 workspace 或当前 Context。缺少必需 Provider 时仍在执行 selector 前拒绝；无路径可以使用原空 Tab 元数据，但显式返回当前 Context，不改取注册的 base host。远端身份、缺 registry 时的断连代理及 Task proxy/cache 保持原语义。最终同字节执行新增 Hook 13 项、相邻草稿/模型选择 15 项和原 W02 14 项，合计 42 项全部通过，skip0；此前的 14 项重跑不重复累加。[正式审查及测试记录](../evidence/client-workspace-service-hook-preparation-20261019/manifest.json)保留环境装配失败与修正后的真实结果。独立审查无新增 Required 问题，最终 v4 实际恢复日志为 0 错误。

该提交的新完整门禁及 Server/Web/Desktop 构建全部 exit0，根 Lint 保留 113 项既有警告、0 错误。Root 独立核对 7,332 个当前客户端源码文件、6,150 个 Web/Server/CLI 产物文件和 6,631 个 Desktop 产物文件，源码前后 SHA 相同。见[构建记录](../evidence/client-web-hook-recovery-build-20261019/manifest.json)、[新 Web/Server 交接](../evidence/client-web-hook-recovery-build-20261019/web-server-artifacts.json)、[新 Desktop 交接](../evidence/client-web-hook-recovery-build-20261019/desktop-artifacts.json)及[独立核验](../evidence/client-web-disconnect-audit-20261019/hook-build-independent.json)。最终 Web artifact SHA 为 `a6fad6d87b065f2927573dfdfb7bf70e2073eaaed481c0cd96c03fde0c1292ae`；CLI03ad 没有重建。Desktop 构建通过不代表本轮重跑了 Native 界面验收。

此前修复版浏览器 v1–v3 使用 `409c0601…` 的[首轮产物](../evidence/client-web-disconnect-green-build-20261019/artifacts-with-cli.json)，SHA `05a6ac77…`，对应 7,330 个源码文件和 6,150 个产物文件。该轮只构建 Server/Web，复用 CLI03ad，Desktop 未重建；初始清单漏列已验证的 CLI，已追加新的交接文件，原封存保留。最终 v4 使用上文 `cd0127ad…` 的新正常构建。

## 资源与验收边界

每轮浏览器测试的已知进程与端口分别核对关闭。最终 v4 的 305 条已知进程身份（包含测试查询子进程）均已退出，50952/50953 拒连，`resourcesClosed=true`，三个 UI driver 均 exit0。控制器原 PTY86512 的实际 exit1 仅因根目录 FD 查询不完整而按原策略保留诊断目录；不写成控制器全绿或已证明没有未知写者。私有目录保留 0700，未读取、删除这些目录或调查未知持有者。

Root 于 2026-10-18 21:32:09.788 UTC 完成[主后台最终只读核验](../evidence/client-web-disconnect-audit-20261019/main-final-protection.json)：PID42125 身份/cwd/数据库绑定正确，健康检查、首页和 JS/CSS 全部 200；九张业务表与四个部署资产 SHA 不变。没有重启、重新部署主后台、管理员登录或调用主后台模型。

本项不替代 Web 企业认证、自动重连/跨连接重放、Chrome 兼容、手机/managed 远端或三平台安装验收；真实企微、外部 MCP 和网盘仍按用户要求排除。既有 Native、插件桥、分享及用量结果保留原日期、来源和产物，不计为本轮重新执行。
