# 原问答忽略与后续恢复

仅补原ElicitationDialog“忽略”按钮，不重复多题、待答刷新或历史冷启。源码dismiss发action=decline，原interaction broker返回deny和AskUserQuestion was declined，因此它与accept+answers={}的自动继续不同。

新独立PREPUBLISH_QUESTION_DISMISS=1 profile只提单题。原忽略后对话框消失、AskUserQuestion为canonical error、真实后继模型收到declined原因而非JSON空答案或伪造选项；任务自然完成。原renderer reload请求/完整账本零增，历史卡不把它标为自动继续。随后同任务新的用户请求再次提出单题，原选北京后正常完成，原错误part仍保持，新增completed part答案仅北京。忽略不永久锁死提问或残留交互。

原Main/Host/CLI、HTTP/SQLite与本地供应商参与，Input点击/发送是唯一写入路径。只读证据读取CLI parts及完整ledger；首段3笔66Credit、新请求新增2笔最终5笔110，另一成员完整两行保持。生产代码不改，私有根/四端口/Main和CLI/两类browser-harness按原finally及独立日志关闭。外部MCP、网盘、企微、远程、发布后多系统客户端排除。
