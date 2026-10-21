# 原结构化问答与待答刷新

PREPUBLISH_QUESTIONS=1独立运行当前未打包Main/Host/UI/CLI、真实后台/SQLite及受控供应商。原Composer只发送一个提示，生产AskUserQuestion提出3题：单选、多选加自定义、可跳过单选。回答前原reload应恢复同一个等待交互，供应商Ask只发一次、无后继stream调用；不要求尚未提交的renderer-local草稿跨hard reload保存。

原单选先选北京，多选勾日志/文件并将指标勾选后取消，填中文自定义；原上一题把北京改南京，返回多选后草稿保持，原继续到最后一题直接提交以跳过。实际后继模型必须收到南京、日志/文件/中文自定义，且明确跳过1题，不伪造末题偏好；CLI completed tool记录相同结果，展开原工具卡可看到实际答案，reload保持且无重放。

独立PREPUBLISH_QUESTION_SKIP=1仅通过原页导航到末题提交空答案，后继模型应收到生产“未回答/按最佳判断继续”的合同，而非权限拒绝或伪造选项。每例当前成员Ask提议、后继回复、自然标题共3笔66Credit，另一成员完整账本保持；不写文件或规则，不发Runtime业务RPC代UI，不跑旧队列/回滚/授权流程。退出/端口/两类PID按原finally及独立日志核对。外部MCP、网盘、企微、远端和发布后客户端不参与。

历史展示用独立PREPUBLISH_QUESTION_HISTORY=1最小单题：原选择南京后，实际模型与CLI正确答案、原工具卡展开、renderer reload以及同私有profile Main/CLI冷重启后原task恢复都须展示南京而非未提供回答；不重复多题导航场景。冷恢复期间供应商和完整账本零增，原PID/新PID均精确记录。
