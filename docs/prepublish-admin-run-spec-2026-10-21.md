# 管理页面原执行与取消按钮联动

独占临时SQLite/端口/Chrome/browser-harness，原Fastify和原管理静态页面，worker=true，使用原定时worker而非测试手动drain。通过真实HTTP准备一个已发布、仅调用模型的合成智能体和本机受控供应商。

原登录作为前置；从原企业智能体行“执行”表单提交成功任务→原执行任务列表/详情显示真实输出与空工具列表。再从同一原表单提交暂挂任务，供应商实际收到请求后，从原执行任务行“取消执行”；原详情显示cancelled/CANCELLED、原supplier连接实际关闭，reload后两个终态保持且不多发请求。

必须有两次来自浏览器的POST /runs（202）和一次原取消POST（200 / ok:true，遵循原Runtime路由合同）；controller准备与只读核验HTTP单独标记。原worker、运行记录、加密输入输出、账本和审计均参与；成功usage12/2对应14Credit，取消传输后原reserved等额uncertain，最终无queued/running且两条运行均属于当前用户/租户。测试不写运行/账本表，不替换业务响应或浏览器fetch/store，不启动Docker工具/MCP/网盘，不访问主3000或企微/远程路径。

审计消费增量：从原“操作日志”页面搜索runtime，实际三行必须为两个当前用户/目标的runtime.enqueue与一条对应挂起任务的runtime.cancel，并与原数据库audit行匹配；不能以API有记录代替页面消费。

每轮新profile，原浏览器阶段60秒/业务等待15秒边界，全部自有端口/PID关闭且私有根移除后才算通过。
