# 原计划忽略停轮与后续新请求

独立PREPUBLISH_PLAN_DECLINE=1复用PREPUBLISH_PLAN_APPROVAL入口，只补无反馈decline分支。原用户输入→模型生产EnterPlanMode→ExitPlanMode A→原“忽略”。根据withPlanExitDeniedTurnStop，未批准的Exit应canonical error并停止当前轮次，不能自行继续向模型请求“修订计划”；计划标记仍true，计划文件不存在。原reload不得重放、发起模型请求或写文件。

首段预计2笔stream+自然标题1笔，即本人3笔settled/66Credit；若出现额外供应商调用直接失败，不隐藏重试。另一成员两笔完整ledger保持。随后同任务原新用户输入明确继续，模型只提出ExitPlanMode B，原提交批准后正常完成，旧error逐字段保持，计划标记false，生产计划文件逐字为B；此段新增2笔，最终5笔110。原完成刷新完整请求/账本/parts/文件保持。

原Main/Host/CLI、真实HTTP/SQLite、生产工具与受控供应商参与；原Input是唯一业务写路径，只读SQL/文件和原DOM读取为证据。没有计划反馈steer、详情或冷启复跑。全部自有PID/4端口/私有根/BH按原finally及独立核查闭合。外部MCP、网盘、企微/远程和发布后多系统客户端不参与。
