# 管理端自动化原页面与后台worker联动

在既有独立后台/合成智能体/本机供应商fixture中选择automation模式，不运行原普通任务或评测场景。原自动化页面新建一条未来once计划并原按钮停用，等待真实due后至少1500ms，原worker不得派发，模型/账本/运行均0；过期后原启用按钮应显示SCHEDULE_EXPIRED/“计划已到期”且不变更记录。

再从原表单新建另一条未来once计划，等待原worker自然派发，恰一条trigger_key=automation:id:due的succeeded运行。页面显示该计划自动停用/next_at空，原任务详情显示真实输入/输出，供应商恰一次、14Credit settled。原计划字段及任务输入由Vault加密，页面计划详情不得带input。

原删除对第一条计划取消应保留DB记录、派发和账务全行不变；再原确认删除并reload，应删除第一条且保留已成功的第二条计划/历史/账本。真实浏览器POST/PATCH/DELETE及审计与数据核对。控制器不调用tick/drain、不改时钟或业务表，只读HTTP/SQLite观察；不配置Webhook或发送员工消息，不接触主3000/企微/远程/MCP/网盘。

等待使用实际Date.now与原1000ms worker，once时刻通过原表单传入。每阶段UI60秒，业务等待有界，总任务2分钟内；所有自有进程/端口/根关闭后才通过。
