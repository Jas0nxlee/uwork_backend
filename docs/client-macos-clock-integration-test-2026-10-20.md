# 最新 macOS 原包本地前后端联动

最新原签名 Mac 包的本轮联动 **7/7 全部通过**，controller退出0、完整清理通过。我方26项与Root独立16项均全绿。本轮发现的 Renderer reload 覆盖当前工作区问题已修复并原子提交 `263146f4`；所有历史产品RED及夹具前置失败保留。

## 最终 v6 结果与证据

最终运行目录为 `evidence/client-native-packaged-macos-clock-v6-20261020/`，原命令使用 `scripts/tests/macos-clock-probe.py`、fresh profile `client-native-packaged-macos-clock-v6-20261020` 与 `evidence/client-macos-package-v6-manifest-20261020.json`。该命名是运行轮次；消费的冻结原应用同样为正常 producer v6。

| 原路径                            | 实收结果                                                                                                                                                                                 |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 原 app.asar / FirstRun / 身份配置 | 原签名包、原首次引导、受控后台真实邮箱会话经原加密store恢复；当前成员与模型ID一致                                                                                                        |
| File / Renderer reload            | 原文件树读取唯一sentinel；reload后仍是指定项目、再次原入口读取成功，持久化active index0保持                                                                                              |
| 原 xterm / shell                  | 写唯一marker，shell PID99273、`/dev/ttys001`；live FD与cwd一致，面板隐藏再开保留同shell                                                                                                  |
| 原 Composer / CLI / 后台          | 原回答终态；执行CLI PID99174的包内可执行映射、生产spawn参数与指定项目cwd同时成立；默认目录预热CLI PID99100分列，不误算模型执行目录                                                       |
| 本人账本 / Trace / Supplier       | 本人两条settled、44 Credit、24 input/20 output；两条succeeded Trace同tokens；另一成员两条/44 Credit基线不变；Supplier总4次含其两次基线                                                   |
| 撤席位                            | 原发送友好拒绝，真实configuration GET与authorize POST均403；未新增completion POST、supplier、Trace或账本                                                                                 |
| 原退出 / 冷启动                   | 原logout HTTP204；同controller99045、同profile，Main99059→99498，没有第二次bootstrap/store seed；退出及冷启动identity=false/currentModel空，真实原登录门禁可见，本人成员服务端session剩0 |

最终主请求保留全部32个工具，tool JSON133725字节，原保守inputBound141481+cappedOutput1024在显式500000窗口下HTTP200；标题1443+1024、HTTP200。四条成功HTTP收据包括另一个成员的两条小基线，不能全当成本人新增。原128000失败轮次的精确请求字节未落盘，不把后轮测量值倒填为它的原body；可以确认前轮真实400/CONTEXT_LIMIT、原metadata128000，且没有新增费用。该边界是保守UTF-8字节上界，不宣称实际tokenizer测出超过128k，也不据此覆盖所有128k模型能力。

逐字段独核：

- [运行原结果](../evidence/client-native-packaged-macos-clock-v6-20261020/result.json)、[我方26项独核](../evidence/client-native-packaged-macos-clock-v6-20261020/independent-verdict.json)、[Root独立16项](../evidence/client-native-packaged-macos-clock-v6-20261020/root-independent-verdict.json)。
- [原模型metadata回读](../evidence/client-native-packaged-macos-clock-v6-20261020/controlled-model-metadata.json)、[无正文/凭据的字节与HTTP收据](../evidence/client-native-packaged-macos-clock-v6-20261020/controlled-request-metrics.json)、[真实HTTP traffic](../evidence/client-native-packaged-macos-clock-v6-20261020/desktop-traffic.json)。
- 原readonly DB ledger/Trace分组及当前成员session=0汇总在我方独核；没有直写业务DB种状态。实际发送与拒绝走原UI/Host/CLI/API。
- [冷启动原登录门禁截图](../evidence/client-native-packaged-macos-clock-v6-20261020/cold-ui.png)。本轮未要求删除本地任务历史；冷恢复观察的是身份与当前模型投影不复活，不冒称所有本地历史或内部cache物理清空。

18个精确自有PID（两代Main/Host子树、PTY、secondary、controller、OSguard）在结束时及离线独核时均不存在；四个loopback端口均拒连。两轮BH daemon99092/99529各自不存在，两个私有Unix socket均关闭；OSguard退出并恢复原协议关联，`usesSystemClipboard=false`。原fixture的electronExited/serversClosed=true、errors=[]；profile按0700保留，不声称数据目录删除或系统零FD。原包五项runtime SHA与严格签名再次独核不变。

## 真实 RED 与原因

原正常 Darwin ARM64 build 与 electron-builder ad-hoc `.app` v5 已通过严格签名，包内 Agent 精确为 `cdf781ecf004b9639157fae25e6e96e558b95faefaee7aab09488d5dc650ecac`。在两个独立新 profile 均重现：原 FirstRun、原加密身份恢复、企业模型配置及指定项目的文件预览通过，执行原 Renderer reload 后，身份仍正确，但 composer 改为“选择项目”，活动目录变成默认 conversation backing directory。

第二次在 reload 前只读取得真实 setting：项目与 conversation 两个会话均存在，`lastActiveTabIndex=0` 指向项目；失败后会话列表未丢，却改为 index1/default。不是文件、身份或 SQL 迁移丢失，也不是初次显式目录门禁又失败。

根因位于原 `useRootPlatformEffects`：窗口 URL 的 `initialWorkspacePath` 仍是该窗口最初默认目录，刷新后原 TabStore 已按设置恢复项目，随后 Hook 又无条件 `addTab(initialWorkspaceAbsPath)`，覆盖刚恢复的当前选择。原 reload 判断只抑制草稿重置，没有抑制旧导航入口重放。

原证据保持：

- `evidence/client-native-packaged-macos-clock-v1-20261020/result.json`：两项通过，reload 失败，controller 退出0、进程/四端口/BH/协议关联收口。
- `evidence/client-native-packaged-macos-clock-v2-20261020/result.json`：同包、独立新 profile 精确复现，另有 reload 前后真实设置与有界公开 UI 投影；清理同样通过。
- `evidence/client-macos-package-v5-manifest-20261020.json`：实际旧候选的五核心 SHA，旧 Agent 为新 cdf，app.asar 为 `0751ac067c2e5781dfd50af9e585a489eb67b1b1049fbb41fc1c7f178501480c`。

首次 v4 producer 漏设原 `ZCODE_MAC_ADHOC_SIGN=1`，原 builder 明确跳过签名，验收失败另保留于 `evidence/client-macos-clock-package-v4-20261020/acceptance-result.json`。它是 producer 环境遗漏，未作为产品签名缺陷，也未手工重签旧包。后续 v5 使用原开关正常重产。

## 永久修复与门禁

原 Hook 仅增加派生判断：reload 且当前 active canonical identity/path 确实对应已恢复的 workspace tab 时，不重放旧 initial path/task；空历史、identity 不匹配或普通冷启动仍走原入口。原 TabStore 继续唯一拥有选择；没有新队列、缓存、定时器或平台特例。原 bootstrap 终态、ready IPC 与后续 Main 新显式请求保持原路径。

规格先更新于 `clients/uwork/specs/startup-workspace-intent-order.md`。真实 React Hook + 原 TabStore 永久 RED 为8项中1红，明确 actual `/startup-default` 而 expected `/previous-project`；修复后同矩阵全绿。补强后共12/12，包括 conversation、canonical identity、无效 active fallback、同项目原 SessionStore 的 current task 不被旧 URL initialTaskId 改写、冷启动、新 secondary、StrictMode 和卸载边界。

原 Main→preload→Desktop adapter→Root 集成10/10通过；其中三个平台是同机源码分支，不冒称三平台实机。独立 peer 重新执行12/12和10/10，无实质阻断。完整客户端 typecheck、lint、相关格式、架构与 diff 检查均0；新增第12项测试再单独格式检查0。

证据为 `client-macos-reload-hook-{red,green,boundaries-green,final-green}-20261020.log`、peer-final-green 与 main-peer-green 日志，以及 `evidence/client-macos-reload-quality-20261020/`。

## 正常新候选与接受边界

新候选 v6 绑定修复提交 `263146f4`，由原 Darwin Desktop build 和原 electron-builder 配置生成，继续原 ad-hoc 签名；Agent cdf 保持不变，不重建 Agent/Server。正常 runtime-assets 在 v5 前已准备本机 Agent/native-search/Swift helper；跨平台 remote-assets 使用原 skip 开关避免与其他 owner 重写，不将其算为新远端资产全量刷新。

v6 app.asar 为 `cda1511098c4768c7b0a5cea9f36aa344f7ab43319bdee254a8f8fa78d8253ea`；manifest `evidence/client-macos-package-v6-manifest-20261020.json`、正常 producer/签名均0。后续 HEAD 的测试文档提交不改变已冻结原包字节。

运行 v3 已通过原文件预览、reload 保持原项目及重新读取原文件。其后 terminal toggle 的旧坐标点击没触发 xterm，不定为产品 PTY 故障。v4 采用原 Linux 已验证的真实 mouseMoved→fresh hit-test→稳定坐标输入，实际记录该按钮 x793→753 的移动，未重复提交点击。真实 xterm 创建 `/dev/ttys001`、shell PID94228，写出唯一 marker 文件，shell 的 live FD/cwd 与指定项目逐字匹配，面板保活检查通过。

v4 随后原 Composer 收到真实 HTTP400/CONTEXT_LIMIT，上游仍只有其他成员的两次基线调用，本人没有新增账。只读核对原测试 DB 模型 metadata 为 contextWindow128000/maxOutput1024/supportsTools=true；完整生产工具面导致此前置不足，不能删除 tools 或关闭上下文保护求绿。此前协调消息误口述为8192已立即纠正，真实当前默认与 DB 证据均为128000。后续v5/v6通过原模型管理 API 明确声明受控模型足额窗口，验证允许路径；不冒称外部供应商实际能力。

这两次均完整收尾；v4 记录12个精确自有进程（含原 Main 子树、PTY、secondary、OS guard）消失、四端口闭、BH/socket 闭和协议关联恢复。证据分别为 `evidence/client-native-packaged-macos-clock-v3-20261020/` 与 `...-v4-20261020/`。早期失败没有被改写成完整通过。

v5 独立派生夹具只为本轮受控模型通过原 POST Admin API 声明500000窗口，再经原 GET 实际回读；原共享 fixture 两个 dirty 文件、产品保护及原包均不改。另在原 listen 前增加被动请求数值收据：不改请求或响应、不删工具、不 Mock tokenizer。无 GUI 预检实际 schema/backend 回读通过、controller0；首个派生预检漏独立 assert import 的失败也保留，修复仅在独立夹具。

v5 已通过六项业务：包/身份配置、原文件与 reload、PTY、包内 CLI 对应指定项目实际 cwd、主回答/标题的本人2条 settled/44 Credit及另一成员基线不变、撤席位原发送拒绝且调用与账本零增量。主请求实测 inputBound141481、tool JSON133725字节/32工具、cappedOutput1024，实际 HTTP200；标题 inputBound1443/cappedOutput1024、HTTP200。这是原保守字节上界测量，不是 tokenizer 输出；不能据500000允许路径断言所有128000模型都适用，也没有为此修改生产估算。

v5 整体仍失败在点击屏外身份菜单：文件树按原设计把任务列表整屏滑出，账号按钮保留在 DOM但x=-201，不能直接操作。最终v6仅补原“返回任务”按钮导航，完成原退出/冷启动；不将此记成身份失效产品缺陷。v5的 controller0、12精确自有PID、四端口、BH/OSguard均已收口。证据 `evidence/client-native-packaged-macos-clock-v5-20261020/` 中含逐项结果、模型原API回读、被动字节/HTTP收据及派生源SHA。

真实 UI 切片使用全新自有 app/profile/backend/CDP 与独立 browser-harness daemon；受控 supplier 返回明确测试响应。最终v6按规格通过文件与 reload、原 xterm 的文件/cwd/活 TTY、原发送及当前成员44 Credit双账、撤席位零增量、原退出后同 controller/profile 冷启动。bootstrap 仅 controller 启动时一次 seed，后续 launch 不写身份 store。允许产品保留本地历史任务，企业身份/当前候选/用量的恢复边界分别观察。

没有 host 全局键鼠、个人 Chrome、系统剪贴板操作；protocol-only 守卫只用私有临时 pasteboard并恢复原协议关联。不触真实企微受拒浏览器、外部 MCP 或网盘。此报告只验收当前本地 Mac 原包的具名切片，不等于所有 Mac/远端/生产/签名发布场景完成。
