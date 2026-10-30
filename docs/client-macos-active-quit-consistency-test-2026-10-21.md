# Mac 原菜单活动任务 Quit：执行记录

当前仍未验收原菜单 Cancel/Allow；随后读取的当前Mac会话布尔元数据明确为锁屏，暂停需要前台的重复用例。完整强杀恢复和PDF分享已分别通过，本页只记录另一独立退出边界。

| 用例           | 实际结果                     | 边界及收口                                                                                                                                                                                                     |
| -------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| active-quit-v1 | FAILED0，未启动App/AX        | 测试预算 helper `remaining()` 与原run.finally本地变量冲突，入口UnboundLocalError。fixture0/cleanup[]；2PID和从已初始化metadata补核的4TCP关闭、OS恢复                                                           |
| active-quit-v2 | FAILED5，已到真实held请求    | 原正常包/登录/PTY/模型暖控制和真实第五主请求的header-only hold通过；原菜单前要求App已frontmost，但BH后台UI没有主动置前。未发Quit、Cancel或Allow。fixture0/cleanup[]；13known+BH、四TCP和私有socket关闭、OS恢复 |
| active-quit-v3 | FAILED5，置前立即回读false   | 同PID/birth/exe守卫后，AXFrontmost可设且设置返回0，但立即回读false；未发原菜单动作。14PID、四TCP、BH/OS关闭恢复                                                                                                |
| active-quit-v4 | FAILED5，同5秒只读等待未置前 | 仍仅设置一次，40个直接样本265–4905ms均false，按原deadline停止，无重设/fallback/原菜单动作。14PID、四TCP、BH/OS关闭恢复                                                                                         |

v1 原输入已归档，私有预算helper改名并补完整实际derived run词法回归；v2继续保原输入与FAILED。v2已见raw/supplier5、原running UI和真实reserved行，但最终测试清理时发生的取消不能当作原菜单退出的正例。

Root授权的最薄测试前置已在v3/v4实际执行：只对本case PID/birth/mapped executable均已复验的AXApplication设置frontmost，读回成功后才操作该App原菜单；不使用全局按键、不读取或操作其它应用。没有修改产品退出逻辑或取消账务规则。

v4之后用公开 `CGSessionCopyCurrentDictionary` 仅投影三个布尔字段：`CGSSessionScreenIsLocked=true`、`kCGSSessionOnConsoleKey=true`、`kCGSessionLoginDoneKey=true`。没有读取用户信息、其它应用或屏幕内容，也没有尝试解锁或绕过锁屏。此为当前环境事实，与无法置前的观察一致；不虚构v3以前的精确锁屏起点。需要原生前台菜单的验收继续开放，停止重复相同受限入口，转去修复及验证不依赖前台的打包问题。

[v4真实采样及独核](../evidence/client-native-packaged-macos-clock-arm64-active-quit-v4-20261021/root-failure-verdict.json) · [当前会话布尔投影](../evidence/client-macos-active-quit-preparation-review-20261021/current-session-booleans.json)。该限制不影响已完成的原客户端后台DOM、真实Host/CLI、强杀恢复和PDF分享的具名证据；也不把这些证据升级为原菜单Quit通过。

[v1结果](../evidence/client-native-packaged-macos-clock-arm64-active-quit-v1-20261021/result.json) · [v1独核](../evidence/client-native-packaged-macos-clock-arm64-active-quit-v1-20261021/root-failure-verdict.json) · [v2结果](../evidence/client-native-packaged-macos-clock-arm64-active-quit-v2-20261021/result.json) · [v2独核](../evidence/client-native-packaged-macos-clock-arm64-active-quit-v2-20261021/root-failure-verdict.json)。本页不宣称已测原应用退出确认，也不从观察到的hold费用推断退款。
