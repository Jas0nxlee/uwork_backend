# 原队列手动停止与恢复

使用原未打包共享UI/CLI/后台独立夹具，A真实供应商在途暂挂、B入队后删除、C入队待发。点原Stop后，原paused banner/resume按钮出现，C保持且没有派发；刷新后仍暂停，模型/账本不变。点原Resume后C恰一次执行，队列清空。

A在真实传输取消后按后台既有合同保留uncertain，amount必须等于停止前同id的reserved；不能把未知远端费用算免费或退款。C和标题按实际usage结算，另一成员原账本保持。原CLI用户历史为A/C，后续归档删除与reload不重放模型。使用 `PREPUBLISH_QUEUE_PAUSE=1`，不与编辑/排序模式组合，不增加原240秒总预算。
