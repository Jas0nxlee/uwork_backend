# Mac 副实例退出修复：当前验收边界

本轮完成了源码修复和Mac ARM64正常新包原七项回归；x64拒锁副实例的原十秒退出边界也在独立诊断中通过。**x64正常包原七项仍为0/7，首个30秒renderer前置未过；Windows仍无已授权运行环境。整体目标未完成。**

| 项目                  | 实际结果                                                                                                                      | 证据                                                                                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 源码修复              | 本地原子提交`0aeff9adda8b3dd23103cb8dfa6c0cf735d6dbc2`，5文件；拒锁`app.exit(0)`，首窗shell预热只在持锁后创建                 | [规格](../clients/uwork/specs/desktop-secondary-process-exit.md)、[Root源码验收](../evidence/client-desktop-secondary-exit-fix-20261021/root-verdict.json) |
| ARM64 v12正常包       | 原7/7、独立29/29；副实例自然exit0，原UI实际workspace、文件/reload、CLI/PTY与cwd、真实受控HTTP和计费、撤席位零增、注销冷启均过 | [独立验收](../evidence/client-native-packaged-macos-clock-arm64-secondary-exit-v1-20261021/backend-linkage-independent-verdict.md)                         |
| x64 v11正常包         | 原0/7失败；30秒内没有取得原file renderer，未到AX、BH、secondary或业务，不据此判拒锁修复失败                                   | [原result](../evidence/client-native-packaged-macos-clock-x64-secondary-exit-v1-20261021/result.json)                                                      |
| x64 v11独立副实例诊断 | 同一未修改包，原1c/10000ms一次；实际内核身份与false阶段绑定、自然exit0/null/timedOut=false、主实例同代，费用零增              | [具名诊断](client-macos-x64-secondary-exit-candidate-diagnostic-test-2026-10-21.md)                                                                        |

源码旧19项中14RED/5PASS后，新19/19通过；Root扩展相关矩阵75/75及4个实际fallback coordinator场景通过。完整typecheck退出0（包含Desktop host配置，不声称全Main静态类型覆盖）、lint114项既有warning/0error、architecture与5文件格式检查通过，fresh独立五轴审查无阻断。没有删除失败证据、skip测试、延长原30/10秒或改变原7条业务断言。

两新包使用正常三步构建、原CDF Agent及原builder/fuse，29份选定源码绑定当前提交，未把脏checkout宣称全仓clean。ARM首次额外“non-ASAR全部同旧包”检查因Swift helper SHA不同而停下；独立审计证实22节区/全部代码和常量、符号表逐字相同，78差字节仅在UUID与派生签名元数据。保留首验失败后，v2仅接受这份精确新helper完整SHA及审计，不修改、替换或重签产物。[打包报告](client-macos-secondary-exit-packaging-test-2026-10-21.md)记录详情。

ARM实测current两笔settled/44 Credit、24输入/20输出；另一成员两笔/44汇总保持。独立只读SQLite将gateway_call与ledger按真实tenant/user/request_key关联；Trace没有该外键，仅按实际actor/model/application/token集合核对。原七项只保另一成员前后汇总，不能冒称已取其全行before快照。实际工作区UI与供应商cwd另外证明请求被消费，副实例exit0本身不当ACK。

x64 v7诊断总25.916秒，主实例file target在14.197秒选中，仅属于该次最多60秒的诊断前置，不回填此前30秒失败。secondary25190实际内核出生/x64映射与原开始/退出pair绑定，原锁表达式false耗343.55ms，随后退出阶段与自然exit0一致；即时exit没有返回日志不当异常。前后真实raw/supplier均为2，逐请求摘要及双actor全部账务相同、current0。该结果支持这组退出策略修复在本例有效，不分别归因两处改动，也未定位之前的具体C++路径。

ARM19个known PID及2个额外BH、四TCP和私有BH控制均闭；x64首跑6PID/四TCP、独立诊断7PID/四TCP均闭。各次fixture退出0、原清理无错误、协议恢复、剪贴板未使用，冻结输入保持，常驻后端PID92288未重启。当前没有这些case的活动App、GUI、BH、inspector或构建。

仍开放：x64原30秒/完整7项及物理Intel验收；当前合法入口下未能完成的同成员Native重新认证、Mac真实OS-read等待后撤权；Windows真实主机。此前五个ARM64一致性具名边界见[进展索引](client-macos-backend-consistency-progress-2026-10-21.md)，不将重复基线相加当新功能。Linux按要求不新增，外部MCP/网盘及受拒真实OAuth保持边界。
