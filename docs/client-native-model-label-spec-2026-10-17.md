# Native 企业模型名称和文件拒绝文案复测

使用独占 fixture、真实 email HTTP 身份、同批正式 CLI/stage/Main/Host/Renderer，主库和外部系统不参与。后台模型名称是现有 `/v1/models` 的公开元数据；Gateway 和 Provider 的既有私有同步路径是唯一写入者，Renderer 只读 ModelSelection 投影。名称不改变模型 ID、选择值、权限、结算或后端凭据处理。

先以 Native 原界面确认 composer 与模型选择器显示“联动受控模型”；夹具新增单一 `renameModel` 操作，经真实后台 GET 当前模型 revision 和 PUT 同一模型 ID 改名。再从 Native 企业网关原“刷新模型”按钮触发正式同步，返回 composer，名称应变成新值；发送普通合成消息后，自有供应商实际收到的模型执行路径保持同一后台模型 ID 对应的上游，不增加前端 Key。冷启动同一 profile 后名称仍正确，正常消息能够完成，借此验证共享 strict Provider schema 已与新 CLI 一起迁移。名称缺失、换 owner、401/402/403 清空及旧清空迟到由独立真实 HTTP/source 用例覆盖，不伪造 Native 结果。

在同一隔离 profile 创建自有个人技能作为初始输入，通过真实后台配置发布 filesystem=false，再点旧列表中的开关。应显示完整稳定码对应的中文文件权限提示，配置和技能文件字节不变；恢复权限后可再次列出并正常操作。未知上游文字不改类，单测覆盖。此用例补足前次 Native 仅看到内部错误码的观察。

所有 Native 操作使用 browser-harness 的 DOM/AX 检查和真实 CDP 鼠标键盘；不调用业务 RPC、React/store 或注入事件。只对所拥有的 fixture 配置执行显式 admin HTTP 操作，不增加万能接口。结束后保存产物 SHA、UI/HTTP/账本与运行结果，逐一关闭自有进程/端口，删除数据根和专属 BH daemon。主后台保持运行，真实企微、外部 MCP、网盘及付费供应商继续排除。
