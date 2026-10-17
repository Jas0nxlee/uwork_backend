# Native 闲时功能关闭时的导航与草稿保留实测

正式 Desktop 客户端的指定关闭路径通过：真实点击后台发布的闲时 action 后，自动化页仅显示定时任务入口；正常返回原工作区时，输入框内容和工作区标识保持原值。再从侧栏进入自动化，打开后台发布的定时模板并取消，未创建任务、触发模型或新增账本消费。这里验收的是当前 `enabled=false` 时可观察的产品行为。

运行使用隔离 profile `client-native-offpeak-disabled-20261018`、专属 BH `/tmp/b/of`、真实后台 HTTP 和原 Main/Host/CLI。生产业务源码、公共夹具和正式产物均未改动。接受候选为 source commit `cd8191d35432191d662694adcbf14199af7f8990`，原始 [候选清单](../evidence/client-native-login-error-root-20261018/artifacts.json) SHA 为 `1a850a63b252dcd5380552a0ca68e74eaebbaa2675bb880490aad6e538277942`；运行时 HEAD 为 `e3034306b929155a5f638b1c8908253d976cf415`。完整 out 共 6,662 个文件，逐项复制并校验，没有使用快捷筛选清单。

| 真实操作                     | 观察结果                                                                                                                          |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 原工作区打开唯一闲时 action  | `project-offpeak-case` 的 composer 存在，后台发布的卡片可见。                                                                     |
| 点击 action                  | 进入自动化；闲时创建按钮和闲时模板容器均为 0，唯一的定时模板可见。                                                                |
| 经设置按钮打开并关闭设置     | 返回原工作区；composer 对象和真实工作区 anchor 前后 deepEqual，未插入 action prompt。原输入内容为空白，未将其描述为非空文本保留。 |
| 侧栏进入自动化并打开定时模板 | 标题、指令、每工作日与 09:00 均来自本次实际发布数据。                                                                             |
| 从表单正常返回               | 没有提交创建，列表仍为空。                                                                                                        |

后台 owner 的三次正常 HTTP 回读均为 scenes version 1 / revision 2，published 正文与本次发布输入完全相同。Native 对 owned backend 的 configuration GET 200 计数为 0→31→33，并真实显示了唯一卡片和模板；没有捕获 Native 配置响应正文版本，因此不能将 owner 回读当作 Native body-version receipt。

三次任务数据库快照均以 SQLite mode=ro、query_only 读取当前 WAL，`totalChanges=0`。`off_peak_tasks`、未结束任务、终态但未结算的 outbox、`automations` 与 `automation_runs` 均为 0；缺表或缺 schema 会直接失败，没有将其替换为空结果。模型请求正文保持 fixture 初始化的 2 次本机受控调用；账本保持 2 笔 settled、总额 44，整行与正文前后 deepEqual，Native 增量为 0。

冻结 driver 起初错误预期独立自动化页存在返回设置按钮，在输入前停止；后续只读 SVG 扫描也有一次 observer TypeError。原始失败均保留，分别归类为驱动定位和只读观察错误。实际顶栏后退为 disabled，没有强制点击；最终使用源码可核对的正常“打开设置→关闭设置”路径返回，没有创建新任务、清空草稿或注入 React/store/RPC。

本次没有独立记录内部 eligibility RPC 或 loading 完成，也没有覆盖 enabled=true 的闲时创建、存量任务 ticket/status/settle 或旧 CodingPlan provider。当前 provider 固定关闭和空任务库是源码前提；现有存量任务路径继续单列。Renderer guard 与 owned backend 的请求记录不构成全局 Node/OS 出口监控。

Native 自身正常退出 0。11 个已知自有 PID、4 个端口和专属 BH 已关闭；新私有 R 因外部系统进程的 8 个写句柄保留为 0700。为避免公共夹具关闭时递归删除仍被占用的根目录，重验 fixture 的 PID/birth/PPID、数据库 FD 和三个 listener 后，仅精准 SIGKILL 该自有 fixture。这不是优雅 fixture close，没有最终全量 desktop-traffic，也不声称根目录已删除。未直接查询或 signal 系统进程，未访问旧 retained R。

17 份准备文件、6 个依赖、95 个相关源和6个正式产物共 124 项前后哈希一致；旧 org145/project252/login144 共 541 项及各自 manifest 均未变。本次 [113 项原始证据与报告](../evidence/client-native-offpeak-disabled-20261018/run-report.md) 已封存，[run-manifest](../evidence/client-native-offpeak-disabled-20261018/run-manifest.json) SHA 为 `a8c52c83cded069e3c803a42db64e9f8cd79596353aadfc432bce74f57e69449`。独立终审另存于 [新目录](../evidence/client-native-offpeak-disabled-final-review-20261018/review.md)，不修改原证据。

Root 在后续 CLI 公开目录测试后只读复核：主服务仍为 PID37266 / health200，9张业务表、原7个静态资源、独占管理页4个产物及10个相关源均未变，外部客户端 checkout 干净。见 [复核收据](../evidence/client-store-order-root-20261018/main-after-cli.json)。没有读取主 .env、解密主 Vault、重启主服务或调用真实付费模型；真实企微、外部 MCP 和网盘仍按用户要求排除。
