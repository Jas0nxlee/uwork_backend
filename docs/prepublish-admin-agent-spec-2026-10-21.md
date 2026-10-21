# 原企业智能体版本到worker执行

独立agent模式。原新建表单创建私有智能体V1；未发布原执行403 AGENT_DENIED且无run/供应商/账本。原发布版本1后原行执行，由原定时worker完成，实际供应商system消息等于V1。原编辑产生V2，未发布前再从原行执行仍使用已发布V1，版本1原行保持。原发布2后第三次执行消费V2。原停用确认/reload后，同原执行入口403且无新增。

三笔实际run均成功，agent_version为1/1/2、supplier相同版本顺序，各settled14Credit共42；无工具/外部连接器、无手动tick或替换worker。前置已有agent保持原行，其历史不混入新消费者；原浏览器POST/PUT/publish/DELETE/run及审计逐项核对。
