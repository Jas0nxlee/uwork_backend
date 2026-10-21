# 原计划反馈、批准、文件与详情联动

本轮新增原EnterPlanMode/ExitPlanMode消费者，使用当前共享UI、未打包Main/Host/CLI、真实隔离HTTP/SQLite、受控HTTP模型和生产计划文件写入。原Composer、反馈textarea、主提交按钮、工作组、计划卡和侧栏均实际参与；不发Runtime业务RPC代替输入，不注入session mode或写计划文件作正例。

| 具名边界              | 实际证据                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v52反馈与批准阶段通过 | 生产Enter后原计划标记true，原A审批出现，计划文件不存在。原中文多行反馈经plan_approval_feedback成为真实steer user message，后继模型收到标准未批准tool结果和独立用户反馈；首个Exit canonical error逐字保留反馈，仍在计划状态，未写A。模型提出B后原待答reload恢复同一审批且无模型/完整账本增量。无选项/反馈时原主提交正确批准，Exit completed、计划标记false，生产文件逐字为B，模型收到批准B。本人5笔settled/110Credit，另一成员完整两行保持。 |
| v53仅补详情及完成刷新 | 不重跑反馈A阶段，仅用Enter→Exit B→原批准作新详情的最小前置。原完成工作组展开，精确含B的原卡点击，原side pane的toolCallId=owned-plan-revised且正文仅B。最终renderer reload后原完成状态/计划标记false、canonical parts/完整请求/账本/计划文件全部保持。本人4笔settled/88Credit，另一成员保持。                                                                                                                                                |

不能把v52整体状态改成passed：它在上述具名阶段通过后因完成工作组折叠、设施未先展开而找不到计划卡，原result仍failed。v53只补该缺失消费者，不把反馈流程重复执行一遍，也不声称在同一profile完成了全部组合。上述分项均有实际原始收据。

## 失败处理与门禁

v50在读取canonical证据时把message.role当独立SQL列，真实schema把role保存在message.data JSON；此时用户审批还未提交。改为json_extract读取，不改产品。v51因反馈读回JavaScript表达式多一个右括号，在输入反馈但尚未提交时停止；修正表达式，并新增执行实际驱动表达式的纯语法预检，目前11条DOM读表达式均可编译，避免同类设施错误再启动真实case。两轮错误、原源码、result和清理收据保留。

v52的业务通过与设施失败严格分开。v53展开原工作组后详情全通过。当前控制器按模式预期1或2个原工作组并选择最后一组，不修改产品折叠行为。v53执行源码归档在此模式记录调整之前；该调整只把完整反馈模式的“两段工作组”纳入明确计数，没有再跑已通过反馈阶段。

本批没有产品代码变化，未重复既有全量测试和类型检查。新增目标MJS ESLint/Prettier、Node语法、Python AST/原finally AST一致、实际JavaScript预检均通过；复用此前正常CLI与Desktop构建，运行源码5087输入/6669产物逐hash校验。没有构建安装包或连接外部MCP。

## 独立核对

[最终独立复核](../evidence/prepublish-continuation-20261021/plan-approval-final-verification.json)读取真实供应商请求、CLI parts、真实反馈user文本、完整ledger及计划文件：v52状态completed/error/completed，v53状态completed/completed；文件只有B，未把工具accepted当成实际写入。v52原待答快照完全相同，v53最终快照完全相同。所有v50–v53的Primary Main、Host、CLI和fixture PID均不存在，4自有端口均拒连、私有运行根移除、cleanup.errors为空、fixtureExit0、browser-harness daemon/socket关闭。

- [v52具名通过阶段与整体失败](../evidence/client-native-prepublish-v52-20261021/result.json) / [原完整canonical](../evidence/client-native-prepublish-v52-20261021/plan-completed-canonical.json)
- [v53详情与刷新通过](../evidence/client-native-prepublish-v53-20261021/result.json) / [实际侧栏正文](../evidence/client-native-prepublish-v53-20261021/plan-revised-detail.json) / [实际批准文件](../evidence/client-native-prepublish-v53-20261021/approved-plan.md)
- [v50 SQL设施失败](../evidence/client-native-prepublish-v50-20261021/result.json) / [v51表达式设施失败](../evidence/client-native-prepublish-v51-20261021/result.json)
- [JS预检](../evidence/prepublish-continuation-20261021/plan-final-javascript-preflight.log) / [原finally保持](../evidence/prepublish-continuation-20261021/plan-final-python-ast.json)

计划反馈、修订批准、原默认提交、文件写入、待答刷新、完成详情与刷新已新增覆盖；纯“忽略计划→停turn”仍是独立入口，不能从反馈或普通问答忽略推断。整体目标active，下一轮先补该入口并核对本地Git原stage/commit消费者的历史证据。企微OAuth/远程不阻挡其他源码联动；外部MCP、网盘、发布后多系统客户端继续排除。
