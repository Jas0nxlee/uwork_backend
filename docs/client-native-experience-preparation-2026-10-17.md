# Native 配置联动夹具准备结果

2026-10-17。实现及验证的是独占夹具准备，尚未启动新 Native，不计为客户端功能验收。

- 真实 HTTPS 代理成功返回四份已构建管理页静态文件，逐份 SHA 与 [构建清单](../evidence/client-experience-20261017/owned-admin-artifacts.json) 一致；index 保留同源 CSP，HEAD 无正文、POST 静态页为 405。业务接口由真实 createApp 响应。
- 使用本次证书的 CA 严格校验连接，SPKI SHA 与 metadata 相同。实际 HTTPS 登录、读取已发布配置、注销成功；聚合响应包含 scenes/help/desktop/plugin-store。临时登录文件模式为 0600，登录资料不写入 evidence 或 stdout。
- 主 `admin/dist` 各文件 SHA 未变。独占准备进程 87814 已退出、四端口均关闭，临时根已删除。夹具原初始化产生的两次受控模型请求均 settled；不是 Native 对话。
- 第一次验证脚本误用 `configs` 读取实际 `configuration` envelope，已保留为驱动错误并修正验证脚本；没有据此改产品。

证据：[HTTP 与静态快照验证](../evidence/client-native-experience-prep-20261017/snapshot-http-proof.json)、[out 字节快照](../evidence/client-native-experience-prep-20261017/native-out-snapshot.json)、[静态快照](../evidence/client-native-experience-prep-20261017/admin-static-snapshot.json)、[实际配置/账务/流量](../evidence/client-native-experience-prep-20261017/final-experience-proof.json)、[清理核验](../evidence/client-native-experience-prep-20261017/outer-cleanup.json)。后续按 [Native 验收规格](client-native-experience-spec-2026-10-17.md) 使用统一正式构建继续。
