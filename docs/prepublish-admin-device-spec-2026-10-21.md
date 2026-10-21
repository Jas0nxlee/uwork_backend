# 原终端凭据签发及真实调用

独立device模式。原企业页面签发终端凭据，原TTL输入1小时，原结果只读提取token/id/expiresAt到本case0700私有根中的0600独占文件，不打印、不截图、不写证据正文。原列表只能含hash id和时间元数据，reload不再次暴露token。

实际终端Bearer请求配置/模型目录成功，completion只一次、实际供应商一次、settled14Credit；管理模型读取和凭据管理GET/POST/DELETE均403 DEVICE_SCOPE。原会话通过真实DELETE撤销，原UI再读列表应空，旧终端completion401且供应商/账本无新增；原cookie交互会话保持。

当前原页面没有撤销按钮，因此撤销为明确后台消费者验证，不宣称原UI撤销覆盖，也不增加产品按钮。只在自有隔离实例使用随机凭据，明文不进入日志/最终证据，私有文件结束删除；无外部MCP、网盘、企微或远程操作。
