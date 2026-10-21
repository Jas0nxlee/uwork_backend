# Mac 已完成任务崩溃一致性：实际执行记录

**当前结果：v5 完整崩溃恢复与新执行通过。** 真正强杀后，同任务原UI/持久语义零重放恢复，再从原UI新建任务正常执行；旧任务和另一成员账务保持。原七项也在本轮保留通过。下文 v2/v3 保留测试取证设施的历史失败，v4是先行强杀观察。

首轮 `client-native-packaged-macos-clock-arm64-consistency-v2-20261021` 使用正常签名 ARM64 v12，计划 SHA `08dabf4eabbf20103f0efe31381ceb24d99db52aef480b3a974dfb00d050539c`。Root 与独立审查通过后实际运行，结果 **FAILED，尚未发送 SIGKILL**。

原暖阶段五项通过：签名包 renderer、原登录/模型/工作区、文件预览及 reload、真实 PTY/cwd/TTY、原 CLI→真实后端及本人两笔 settled/44 Credit（24 input、20 output），另一成员原两笔44保留。已保存同任务 UI/只读库语义与双成员完整账务和原始请求基线。

失败发生在测试自己的 executable 取证：遍历 owned 进程的 txt 映射时，一个已卸载的系统临时 plist 路径返回 ENOENT。完整进程捕获未结束，没有 `crash-owned-generation-before.json` 或 `crash-signal-exit.json`，所以不能当产品强杀、残留或恢复缺陷。该失败保持原状；下一步仅修读映射的夹具，对消失的非必需映射保留缺失处理，同时仍要求实际 MH_EXECUTE、birth、路径与归属守卫。旧输入归档后用新 profile 另测，不重写失败。

原 fixture exit0、cleanup errors为空。Root 独立核对55输入未变、13 known PID及额外BH PID31053均消失、四TCP关闭、私有BH socket关闭和原OS协议恢复；系统剪贴板未用。常驻后端 `/health` 仍正常、版本0.1.0，未重启。

[实际结果](../evidence/client-native-packaged-macos-clock-arm64-consistency-v2-20261021/result.json) · [Root独立失败收口](../evidence/client-native-packaged-macos-clock-arm64-consistency-v2-20261021/root-failure-verdict.json) · [范围与未执行阶段](client-macos-crash-task-consistency-spec-2026-10-21.md)。同 profile 恢复、新任务、此切片后的 seat/logout 均未执行，不冒称原七项或完整崩溃目标通过。

v3 的窄 ENOENT 修复通过 15 项 Node / 4 项 Python 后，另冻结计划 `6e87178b10886000deb941099d1c45630d84b64165c4b79f1b18410c7d4bdb9c` 并实际运行。暖五项再次通过，但仍在强杀前读到无关受保护映射而 EACCES。完整捕获与信号收据仍未生成，所以依旧没有产品崩溃结论。Root 与 peer 各自确认13 known 加 BH32615、四TCP、原OS协议均关闭恢复，fixture0/cleanup[]；55源与旧输入也已归档。

该结果暴露了测试读取器取证范围过宽。后续只核内核报告的实际 executable 与精确 live txt 映射，只读取该可执行文件的 Mach-O 头，保留 birth/进程图/固定预算守卫；不读取其它映射，不提权或吞真实 executable 的权限错误。v3 的[失败结果](../evidence/client-native-packaged-macos-clock-arm64-consistency-v3-20261021/result.json)与[独立关闭核查](../evidence/client-native-packaged-macos-clock-arm64-consistency-v3-20261021/root-failure-verdict.json)保留。下一次必须用新 profile，不能把旧失败覆盖为成功。

## v4 真正强杀观察

`client-native-packaged-macos-clock-arm64-consistency-v4-20261021`，计划 SHA `87369761f558eb8e0dd3f9468079a0bea70246fdbea35fe43b1e6f8103f04f50`。只改测试取证为 `proc_pidpath` 内核路径、精确 live txt 映射及唯一 MH_EXECUTE 头读取；ps 的 comm 仅作前后稳定诊断，因为实际 Main/Host/CLI 会设置进程标题。16 Node / 4 Python、实际 Node/zsh metadata 预检及独立审核后，单次运行取得 **6 项通过**，其中5项是必要暖控制、1项为新增强杀观察。

- Main34460 原 child 真实退出为 `code=null, signal=SIGKILL`；杀前完整 parent/group/birth/kernel-exe 捕获10个自有进程。
- Host34503与原Main同组；CLI34542/34579、PTY34686分别为独立进程组。它们均在配置上限5秒的观察中消失，`residualBeforeAnyCleanup=[]`；没有生成残留清理收据或发补杀。不把同组强杀称自然 exit0，也不把5秒配置写成实测耗时。
- raw inference POST、supplier调用/完整请求摘要均保持4；本人及另一成员分别两笔 settled/44 Credit、24 input/20 output，ledger/Trace/gateway全行保持。
- 原fixture0、cleanup[]；Root独立18项通过：14个自有/控制PID、四TCP及BH私有socket关闭、协议恢复、剪贴板未用、55源未变、常驻后端健康。

[实际结果](../evidence/client-native-packaged-macos-clock-arm64-consistency-v4-20261021/result.json) · [真实信号及进程身份](../evidence/client-native-packaged-macos-clock-arm64-consistency-v4-20261021/crash-signal-exit.json) · [Root独核](../evidence/client-native-packaged-macos-clock-arm64-consistency-v4-20261021/root-verdict.json)。本次没有重启客户端、恢复任务或发送新任务，不能称该v4切片完成了恢复或原七项；完整后续在下节v5另行完成。

## v5 同任务恢复与新执行

正常 v12 的 fresh `client-native-packaged-macos-clock-arm64-consistency-v5-20261021`，最终计划 SHA `0a72615b16b414e997310b3d85d7e1dd9c1fe1b9f2adbc8b2923ee5489c706dc`。原七项与新增两项共 **9项通过，Root30项、独立32项通过**。初准备多余打开身份下拉框会挡侧栏新任务，已在App启动前删除该一行并保旧计划；不算产品缺陷或一次Native运行。

实际链路：Main38122 原 child 收到SIGKILL，旧10进程代全部消失且无补杀；同controller/profile原launch得到Main38722，原UI重新打开已完成任务A。任务/session、消息/part IDs与正文、title、完成态、模型/reasoning、workspace/cwd和原库语义保持；真实inference POST、供应商摘要及双成员完整账务保持4/4。

随后原侧栏 `enterprise-menu-chat` 与Composer新建B，session与A不同；真实供应商新主请求含32 tools、正确cwd与唯一marker，另有一条标题请求。新代CLI38888由原spawn、live kernel executable/birth、cwd和原数据库FD交叉绑定。同模型选择落库，A再次打开/只读语义仍完全相同。本人仅新增2 settled/44 Credit、24 input/20 output，合计4/88/48/40；另一成员2/44及原ledger/Trace/gateway全行保持。B完成后的UI投影workspace字段为null；本报告以原草稿项目label、实际supplier cwd、持久任务路径及CLI cwd证明工作区，不伪称不存在的完成态标签。

原撤席位发送以新B基线拒绝且无账务新增；原注销后第三代Main39162冷启无身份/当前模型复活。fixture0/cleanup[]，27 known及三BH（38162/38848/39211）共30PID、四TCP与三个私有socket分别独核关闭，原OS协议恢复、剪贴板未用，63输入保持；常驻后端健康且未重启。

[v5实际结果](../evidence/client-native-packaged-macos-clock-arm64-consistency-v5-20261021/result.json) · [Root独核](../evidence/client-native-packaged-macos-clock-arm64-consistency-v5-20261021/root-verdict.json) · [独立复核](../evidence/client-native-packaged-macos-clock-arm64-consistency-v5-20261021/coverage-independent-verdict.json)。Trace按真实actor/model/application/tokens集合核对，没有虚构request-key外键。这关闭完成任务崩溃恢复后新执行，不外推在途任务强杀恢复或全部平台。
