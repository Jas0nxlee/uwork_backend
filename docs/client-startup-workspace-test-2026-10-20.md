# 启动期间指定工作区被默认目录覆盖：修复与真实复测

已确认并修复产品缺陷：Renderer 仅装好事件监听器就通知 Main ready，此时初始工作区恢复还没完成。Main 释放缓存的 `--open-workspace` 请求，指定目录先被打开并写入最近项目，之后 initial workspace 又激活默认目录，实际模型执行落到默认 cwd。

产品修复与永久回归已本地提交 `589e23fc`，没有 push 或发布。

修复沿原所有者链：Main 继续唯一暂存未就绪请求；`useRootPlatformEffects` 仅在初始恢复/注入完成后发出原 ready IPC。不新增导航队列、定时器或业务状态。规格及顺序图见 `clients/uwork/specs/startup-workspace-intent-order.md`。

## RED 与 GREEN

| 层次                          | 修复前                                                                                                                | 修复后                                                                                                                                     |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 实际 React Hook / 原 TabStore | 5 项中 4 红：恢复未完成即通知；最终激活默认目录；StrictMode/卸载时也过早释放                                          | 5/5，显式目录最终激活、历史保留、正常启动及后续打开保持                                                                                    |
| 原签名 v3 包                  | 原 secondary 指定 `…/packaged-workspace`，原 UI 发送后模型上下文和实际 CLI cwd 均为 `…/data/.uwork/workspace/default` | 此旧包证据保持 RED                                                                                                                         |
| 重建签名 v4 包                | —                                                                                                                     | 同一原生链路下，模型上下文仅为指定目录，实际执行 CLI cwd 逐字匹配；正常回答/终态、本人 2 请求/44 Credit，其他成员基线不变；完整清理 exit 0 |

原生 RED：`evidence/client-native-packaged-workspace-red-20261020/probe-result.json`。

原生 GREEN：`evidence/client-native-packaged-workspace-green-v2-20261020/probe-result.json`、`independent-verification.json`。9 个已知 PID 加 BH daemon 已关闭，四端口拒连，包内四项 SHA 不变；OS 协议关联恢复通过。此切片使用 `--protocol-only` 守卫，**不读取或写入系统剪贴板**。

中间 `…workspace-green-20261020` 的模型 cwd 已正确，但探针错误要求所有 CLI 进程 cwd 都相同。产品仍会保留未执行模型请求的默认目录预热 CLI。现改为同时要求“所有实际模型上下文均指向指定目录”和“对应活 CLI 的 cwd 确实匹配”，其他预热进程分列。独立正反证验证仍拒绝旧包、接受新包，Python 四项覆盖默认执行、匹配 CLI 缺失和混合上下文；之后按永久探针重新跑出最终 GREEN，未改历史结果。

## 回归与产物

- 实际 React Hook 相关套件 **24/24**，包含本次五项。
- 原 Main→preload→Desktop platform→Root 协议联测 **10/10**，包括 held restore；darwin/win32/linux 是同机源码分支验证，不冒称三平台实机。旧夹具原先固定 `canBootstrapInitialWorkspace=false` 却期待 ready，已将默认场景改为恢复完成，并新增明确 held-restore 场景，原业务断言保留。
- 启动 fallback/cwd **2 项 + 1 个集成入口**通过；集成入口重新在固定 Node 24 运行，见 `client-startup-fallback-node24-20261020.log`。
- 新正常 Desktop 构建、v4 `.app` 打包及严格签名验证通过；manifest 为 `evidence/client-macos-package-v4-manifest-20261020.json`。CLI 源码未变，复用此前正式 stage，不称重新构建 CLI。
- G04k 原空身份 A 登录→退出→B 登录/选模/发送在新 Desktop 上 **15 项通过**，独立收口见 `evidence/client-native-g04k-startup-regression-v2-20261020/`。初次探针在身份标签刚显示时立即要求模型就绪而失败；改为有界观察原模型目录实际 ready，没有重复登录或手选 A 模型，最终通过。
- 客户端 typecheck、lint（113 既有 warning、0 error）、架构（0 违例）、相关格式及 diff 检查通过。

真实企微、外部 MCP、网盘继续排除。默认浏览器外链及更大范围平台/生产验收仍保持开放，不因本缺陷修复而关闭整体目标。
