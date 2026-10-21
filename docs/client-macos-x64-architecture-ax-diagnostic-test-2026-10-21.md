# x64 架构提示 AX 定向只读诊断

正常 x64 v14 的原七项联测在原30秒期限内29.894秒进入页面，随后原辅助工具报 `Owned AX attribute failed`。该原失败未保存具体属性或AX错误码，整体0/7，未到BH、副实例及业务。以下诊断不能恢复该历史错误码，也不替代原七项验收。

## 实际 v8 设施失败

精确计划 `273dfbdbf4b91671a6a4087ad6b79c2fc16eb24fd6d51169e57ccf79c3c91af2`、67来源。新增入口错误地要求配置 witness 未定义，而原 `Fixture` experience 启动环境恒为 `enabled`；实际运行在后端ready之前退出，20.021秒，未启动App、AX或BH。fixture1、`stopNative:BrokenPipeError` 与 `fixture-exit-not-zero` 两项清理错误原样保留，两个已知PID关闭、无已分配端口，OS协议恢复。

旧计划、五份来源、scope及两份实际派生输入已逐SHA归档。修复精确要求原 `enabled`，其余冲突模式继续拒绝。新纯回归实际执行原Fixture构造器、拦截Popen及线程后，将原始环境交给实际Node validator，先RED再GREEN；8项纯合同、默认prepared入口及独审通过。此前只校验手写环境的审查漏项已记录。

[v8原结果](../evidence/client-native-packaged-macos-clock-x64-startup-v8-20261021/result.json) · [Root失败收口](../evidence/client-native-packaged-macos-clock-x64-startup-v8-20261021/root-failure-verdict.json) · [独立失败复核](../evidence/client-macos-asar-metadata-independent-review-20261021/x64-v8-ax-env-failure-verdict.json)。

## 实际 v9 只读观测

精确计划 `1dffca74ed8d8ec7a427162f4f3ef5004a7c002f539c037bb5355c7e1aeefa6a`、67来源。90秒总预算、20秒收尾预留、AX共用5秒；诊断renderer上限60秒没有改变原30秒验收。仅当前Main PID/birth/mapped x64 executable、原file目标及owned AX引用，无AXPress、激活、全局输入、BH、副实例或模型业务。

实际22.198秒结束，AX观察2.932秒。第一次应用 `AXRole` 在0.1秒消息期限下返回 `-25204`，耗时108.292毫秒；随后0.75秒配置下根角色读取成功。两者发生在不同时间，不能据此证明增加超时必然修复原失败。两次 `AXWindows` 各返回一个子引用，但后续子项角色都读为 `AXApplication`，而非预期窗口角色。原收据未存引用身份、元素类型或与根的CFEqual，故 `architectureWarningConfirmed=false` **不构成没有架构提示的证据**，也不能唯一归因锁屏或产品缺陷。

冻结实际适配器的纯CF/AX回调路由，以及独立使用真实CoreFoundation数组的纯验证均未复现引用误路由或指针截断；这仍不足以解释运行时返回。随后v10只补局部引用序号、AX元素类型及本地根相等比较，原5秒总限与零动作边界不变，结果如下。

当前actor完整ledger/Trace/gateway始终为空；另一成员全部行逐值保持两笔44 Credit、24/20 tokens，raw inference与supplier均2且摘要不变。fixture0/cleanup[]，六个已知PID及四个精确TCP监听关闭，OS协议恢复、未使用系统剪贴板；67输入、manifest及实际派生输入核对通过。正常v14严格资源/33生产输入/最终header与Info/fuse/签名再核通过。

[v9实际观测](../evidence/client-native-packaged-macos-clock-x64-startup-v9-20261021/architecture-ax-observation.json) · [原结果](../evidence/client-native-packaged-macos-clock-x64-startup-v9-20261021/result.json) · [Root独核](../evidence/client-native-packaged-macos-clock-x64-startup-v9-20261021/root-verdict.json) · [精确计划独审](../evidence/client-macos-asar-metadata-independent-review-20261021/x64-v9-ax-env-fixed-plan-verdict.json)。

## 实际 v10 引用身份观测

精确计划 `9e29fd0353f92d0df1798dc5790c3f556db99f53f9b04732b8b0e81115200e30`、67来源，10项纯合同及双审通过后仅执行一次。Common与v9逐字相同，派生driver仅变更fresh profile；v9原输入逐SHA归档。只保留两组根读取与首个合格子项角色，不再扫描窗口文本、sheet或子树。

实际19.570秒，AX1.883秒。根 `AXRole` / `AXWindows` 在0.1秒下均返回 `-25204`（117.390/109.269毫秒），后续0.75秒下均成功（297.131/457.786毫秒）。`AXWindows` 唯一元素确为AXUIElement，本地序号2，与序号1的应用根 **CFEqual=true**。适配器按合同过滤，没有retain或进一步查询该元素，原生动作0。本次接口没有提供可验证的真实窗口引用；这解释了v9子项角色异常的API身份，但**不解释锁屏、Rosetta或AX实现内部原因，也不恢复原v14错误码**。

原5秒共享时限、90/20诊断预算、所有身份守卫与原产品/包不变。增大超时或增加一次重读不能解决“窗口项等同应用根”的可识别性，因此没有盲改原取消辅助工具、忽略架构提示或连续重跑原七项。`architectureWarningAbsentEstablished=false`明确保留。

Root和独审分别核对fixture0/cleanup[]、6个已知PID和4个精确TCP监听现已关闭、OS协议恢复、双actor完整账务行及raw/supplier摘要零增。只读SQLite又核Native三类记录全0、另一成员各2笔/44 Credit与24/20 tokens，数据库未变；67来源和33打包输入、最终header/Info/fuse/严格签名保持。正常ARM64 v13的严格只读loader也再次通过。

当前会话最终只读三布尔复查仍为screenLocked=true、onConsole=true、loginDone=true，没有屏幕/其它App枚举、置前或解锁动作。[当前会话布尔](../evidence/client-macos-asar-metadata-acceptance-20261021/current-session-final-booleans.json)。原七项、物理Intel及当前锁屏会话下的原菜单Quit仍未验收；诊断成功标签仅表示有界只读数据已采集。

[v10实际观测](../evidence/client-native-packaged-macos-clock-x64-startup-v10-20261021/architecture-ax-observation.json) · [Root独核](../evidence/client-native-packaged-macos-clock-x64-startup-v10-20261021/root-verdict.json) · [独立最终复核](../evidence/client-macos-asar-metadata-independent-review-20261021/x64-v10-final-readonly-verdict.json)。
