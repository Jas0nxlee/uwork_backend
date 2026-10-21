# Mac x64 Main CPU诊断记录

2026-10-21 v5取得真实Main CPU profile，结果为`passed-diagnostic-only`，coverage独核25项通过。这只证明定长诊断链路与资源关闭完成，不是原7项业务、30秒renderer就绪或10秒副实例验收通过，也没有产品修复结论。

- [coverage25项独核](../evidence/client-native-packaged-macos-clock-x64-startup-v5-20261021/coverage-independent-verdict.json)
- [v5安全时间轴](../evidence/client-native-packaged-macos-clock-x64-startup-v5-20261021/safe-primary-startup-timeline.json)
- [架构提示源绑定](../evidence/client-native-packaged-macos-clock-x64-startup-v5-20261021/architecture-warning-source-binding.json)
- [v5原result](../evidence/client-native-packaged-macos-clock-x64-startup-v5-20261021/result.json)
- [私有profile的元数据与资源独核](../evidence/client-native-packaged-macos-clock-x64-startup-v5-20261021/owned-independent-closure.json)
- [安全CPU摘要](../evidence/client-native-packaged-macos-clock-x64-startup-v5-20261021/main-cpu-summary.json)
- [冻结计划](../data/sandbox-verification/client-native-packaged-macos-clock-x64-startup-v5-20261021/preparation.json)
- [诊断范围](client-macos-x64-cpu-diagnostic-scope-2026-10-21.md)

## 固定边界

沿用原v9 x64包/source d0a、manifest SHA `767ad9e77e3c8afb755d31d041c61d6baa5543e11545b2e0090c0e9a87494468`及CDF Agent。App、fuses、原secondary函数1c/stdio ignore/10秒期限均未修改；本轮未执行secondary、业务UI或模型prompt，没有使用/usr/bin/sample、Runtime.evaluate、Heap或业务/身份getter。

只给本轮primary添加官方Node inspector入口`--inspect-brk=127.0.0.1:<独占端口>`及显式`--user-data-dir=<本case/root/userdata>`，与原ZCODE_DESKTOP_USER_DATA_DIR相同，保护暂停前的profile归属。断点/Profiler会改变时序，不能把本次观察直接当作原运行速度或修复后的对照。Apple Silicon上Rosetta兼容运行不代表物理Intel Mac。

新profile `client-native-packaged-macos-clock-x64-startup-v5-20261021`，plan SHA `3eb605b04647268530d4f728a251a56e5050c71c06b82590a4c047f131a36374`，40源冻结。case总预算90秒，工作RPC统一deadline-20秒，完整30秒与协议清理预算不足则失败；没有延长原业务预算或自动重试同case。

## 先前设施失败保留

- v3原session18597在backend-ready前失败，fixture exit13、Node报告unsettled top-level await。entry等待Common、Common反向import entry运行函数形成ESM依赖环。实际安全逐字警告、旧5源及完整derived均保留；仅exit13不能单独证明TLA原因。真实无App/inspector/profile，2个known PID关闭，未分配5个应用端口，不伪造端口验收。独立小Node模块图复现旧结构13、新独立runtime结构0，不启动Common/backend/App。
- v4原session32025在构造诊断参数时失败：Common只绑定join，而新handler误用entry作用域的resolve。3个known PID与已分配5端口关闭、fixture0，未取得profile；未执行inspector RPC，inspector是否曾监听没有观测，不从它推断产品能力。7源及完整derived保留。真实解析并执行actual handler、只绑定原Common node:path名字的纯测试复现ReferenceError；窄改为`join(process.cwd(),evidence,...)`后通过。

两次属于新诊断设施错误，未归因到客户端、Rosetta或Inspector。其原结果、cleanup差异与源快照保持原样；v5为另一个fresh输入、独立review/Go。

## v5实际采集

原Main PID7976、birth `Wed Oct 21 02:19:41 2026`、x86_64 Mach-O映射和专属127.0.0.1:55709监听在每个JSON/WS动作前重新核对。刚启动的前两次检查尚无owned监听，未发送请求；约360ms后才进入合法Node target发现。只接纳该端口的单个node target/canonical UUID，无代理、重定向、credentials/query或其它进程目标。

实际方法只有：Profiler.enable、Profiler.setSamplingInterval、Debugger.enable、Profiler.start、Runtime.runIfWaitingForDebugger、Debugger.resume、Profiler.stop。原始首Break on start只resume一次，完整定长采集等待`30001.12825ms`，socket与helper timers收口；没有任意RPC或运行时求值。

原始CPU文件保存在本case私有证据根，**1534194B、mode0600、SHA `104435cc249ca1885193ae0a877d23fa2aa12aa08d4a03e241e957319aa6dd95`**，实际写入字节含末尾换行。raw profile6069 nodes、21197 samples；Profiler从start到stop的window为33622.323ms，包含release前协议/初始断点阶段，不能与resume后完整30秒等待混为一个数。

安全摘要仅保函数名、脚本basename/受限node标识及URL摘要；另一个离线`owned-cpu-script-map.json`只将raw数据中字符串上属于冻结App的路径映射到app-relative路径，没有打开或fetch这些URL。原始profile不作公开正文复制。

| 采样热点                                           | 原摘要self/inclusive权重 |
| -------------------------------------------------- | ------------------------ |
| `(idle)`                                           | 10139.809 / 10139.809ms  |
| `Mv`，原App out/main/index.js，line636/column46522 | 5940.770 / 9526.348ms    |
| Electron `b.loadURL`                               | 3538.271 / 3538.271ms    |
| Electron `get defaultSession`                      | 1868.151 / 1870.479ms    |

这些是CPU profile按timeDeltas计算的采样权重，不能直接当成OS CPU利用率、严格函数墙钟或关键路径总和。minified函数名需按相同原包离线定位后才可提出代码假设；本报告不由`Mv`或loadURL热点直接宣布import、logger、原生模块或锁根因。Node采集也不覆盖inspector就绪前的全部native/Rosetta初始化成本。

## 账务与关闭

采集前后原raw inference POST/供应商调用均为2（原乙seed）；当前甲operator的ledger/Trace/gateway保持空，乙原2settled/44 Credit及全部行不变。身份初始化为原隔离email/store前置，不是UI重新认证或业务成功证明。

case实际38.71174141600204秒，原controller与fixture均exit0，cleanup errors为空。通过原controller stopNative停止，不声称用户点击UI Quit。6个known PID再次独核不存在，5个TCP端口关闭，原协议恢复、系统clipboard未使用，40源SHA不变；无业务BH被启动。正常后台PID92288、VM及其它用户进程未触碰，没有继续下一case。

原[正确profile v2](client-macos-x64-startup-diagnostic-test-2026-10-21.md)仍是30秒renderer门失败、0/7、未到secondary。v5提供后续只读分析依据，不改变它或历史10秒二实例失败的结论。

离线原日志补充：v5 createdAt→mainStart约10958ms、appReady约14479ms、loadUrl约23847ms；primary锁返回acquired true/74.467ms。02:20:16.861进入原controller停止/quit准备，16.866 host清理完成；17.172的ERR_FAILED(-2)导航拒绝发生在停止之后，不能直接作原启动失败原因。02:20:08.967架构warn对应原bundle显式命名tag Ov→maybeWarnArchitectureMismatch，源码按translation flag异步showMessageBox，caller void且在创建主窗口后；是预期Rosetta提示，本例未点下载，不将该消息框本身定为故障。
