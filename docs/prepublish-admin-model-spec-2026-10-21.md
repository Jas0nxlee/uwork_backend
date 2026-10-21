# 模型管理原编辑/测试连接/停用恢复联动

独立admin fixture选择model模式，不运行原普通任务、评测或自动化用例。原模型行“测试连接”必须由后台Vault凭据访问自有supplier /v1/models，页面详情reachable/modelsEndpoint为true且无密钥。原编辑表单应正确回填r.data里的上游ID、baseUrl、credentialId、最大输出128和费率1000/1000；改名称、最大输出256与费率2000/3000保存，原revision1→2。

用已发布agent的同modelId经真实HTTP发起一个工作，由原worker执行并按当前模型费率12input/2output结算30Credit，GET /v1/models显示更新的名称/最大输出。原模型停用弹框取消不得修改revision/账本；确认后enabled0/revision3，客户端catalog不列模型，真实completion403 MODEL_DENIED且supplier/账本零新增。再通过原编辑表单勾选启用保存revision4，catalog恢复，原更新参数保持，真实completion成功并再结算30Credit。原凭据密文全程不变。

只使用原页面Input和只读DOM，API用于静态准备/消费者验证，不改业务表或browser fetch/store。原定时worker负责派发，无tick/drain。只访问本机受控HTTP供应商，密钥不进入浏览器响应或证据，不连接企微/远程/MCP/网盘。所有自有PID/端口/私有根清理后通过。
