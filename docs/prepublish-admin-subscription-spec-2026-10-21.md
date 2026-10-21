# 原订阅表单到实际模型准入

仅补原 Settings“调整订阅”消费者。独立临时 Fastify/SQLite/原worker、独占Chrome和受控HTTP供应商，不读主.env/主库，不接外部MCP/网盘，不构建安装包。

前置用原HTTP创建第二个有席位成员；原表单减至1席位应409 SEATS_ASSIGNED，原订阅和模型/账本不变，取消仍可用。原表单设2席位/0Credit/订阅月，应实际402 QUOTA_EXCEEDED且无模型/账务新增；升至1000后一次成功14Credit。原表单设过期时间，原Gateway应402 SUBSCRIPTION_INACTIVE；原表单续期后第二次成功14Credit。最终reload总席位2/分配2/Credit1000/已用28，period来自原billingPeriod，成员与模型全行不变、旧ledger保留、四次成功订阅更新审计与原浏览器PUT匹配。

原鼠标/键盘填写所有字段并回读，JS仅观察DOM，不注入React/store或替换业务响应。控制器HTTP负责调用实际Gateway和只读核对，UI写入单独标识；资源收口沿原owned browser finally。
