# 原观测页及留存实际删除联动

独立telemetry模式。受控真实HTTP生成两次completion、两个终端事件；仅夹具SQL将一组记录时间推进到8天前（网关缓存2天前），不伪造worker结果。原页面显示2条usage/trace/event，usage聚合切换成员/部门/应用，单组2请求28Credit，查找不存在模型返回空再恢复。

为区分原手动按钮和已启用worker的首轮自动巡检，先在未配置状态等待首个1秒tick，再经HTTP设置7天留存并老化前置数据。原企业页“立即清理”应返回audit/traces/client_events/gateway_calls各1，runs/sandbox_executions0；近期行逐字保留、当前企业老行删除、另一个合成企业相同老记录逐字保持、计费ledger全量逐字保留。原观测页reload之后trace/event1、usage2与聚合28仍一致。再点清理应全0，并有两条purge审计。

其他企业及老时间戳是明确测试前置，不算企业创建或自然等待8天的覆盖；不启动Docker，不接MCP/网盘/真实企微/受拒远程。只使用自有HTTP/私有DB和原页面输入；后台不得被替换为mock，期望计数不得由产品输出回填。
