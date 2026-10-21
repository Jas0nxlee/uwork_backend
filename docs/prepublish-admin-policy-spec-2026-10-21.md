# 访问与分发原页面到真实Gateway准入

独立policy模式，不重复旧运行/评测/自动化/模型管理场景。原页面新建model deny策略，范围all=true、资源ID为静态准备的当前模型；原client catalog应不列模型、真实completion403 MODEL_DENIED且无供应商/账本。原停用按钮后catalog恢复，completion成功结算14Credit；原启用按钮后再次拒绝且无新账务。

原删除取消应保持策略/模型/账务并继续不列模型；确认删除并reload后策略消失、catalog恢复，completion再成功结算14Credit。原model资源全行不改，审计create1/toggle2/delete1及浏览器POST/PATCH/DELETE数量匹配。前端仅物理Input和DOM只读，真实HTTP消费者验证，不发产品RPC或改store/业务表，不接触主库、Docker/企微/远程/MCP/网盘。
