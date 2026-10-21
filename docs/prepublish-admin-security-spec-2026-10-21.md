# 原客户端安全策略表单

独立security模式，原客户端安全页新建全员低优先级deny-network策略，真实client/configuration和成员权限预览一致，Gateway403 NETWORK_DISABLED且supplier/ledger零新增。再原表单创建高优先级allow-network策略，其shell/filesystem/sandbox/dangerousSkills均false，完整赢家必须整条取值，不得与低优先级true合并；真实Gateway成功14Credit。

原高策略停用→低策略重新阻止；原启用→高策略恢复；原删除高策略取消/确认/reload→低策略继续阻止；删除低策略→默认恢复、Gateway再14Credit。原模型、成员、配置资源不变，旧ledger行保持；只用原UI写策略，HTTP读实际配置并执行Gateway。浏览器POST/PATCH/DELETE、策略创建/删除/切换审计与实际操作匹配。与原model deny例不同，此例验证security专用表单、优先级和整条规则消费。
