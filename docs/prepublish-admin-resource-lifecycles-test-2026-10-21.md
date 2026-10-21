# 后台自动化、模型管理与确认框竞态联动

2026-10-21。本轮新增两个后台原页面消费者生命周期，并在第三条确认框竞态中取得真实产品RED，修复后同链路GREEN。使用独占临时SQLite/随机密钥/合成身份、原管理页面/后台/定时worker和本机受控供应商；不接触主库，不配置Webhook，不运行企微/远程、MCP或网盘。

## 后台自动化原页面

[v6完整结果](../evidence/admin-run-ui-v6-20261021/result.json)：原新建once计划后点停用，越过原due1697ms仍0派发/0运行/0账务；过期后原启用按钮收到400 SCHEDULE_EXPIRED，页面显示“计划已到期”，DB原行保持。第二条once计划由原1000ms worker自然派发，trigger_key精确绑定计划id/原due，恰一条succeeded运行，14Credit settled，原详情显示真实输入输出。执行后原计划自动停用且next_at为空。

原删除取消保留第一条计划及业务记录；原确认删除/reload只删除目标，第二条计划、已完成运行与账本保持，供应商全程只有一次。审计为2创建/1有效停用/1删除；过期启用拒绝不写成功审计。没有调用tick/drain或改时钟；读接口不暴露计划input。该后台消费者独立于此前客户端本地自动化。

## 模型原测试连接、编辑与停用恢复

[v8完整结果](../evidence/admin-run-ui-v8-20261021/result.json)：原“测试连接”通过后台Vault向自有/v1/models发起一次真实GET，页面reachable/modelsEndpoint为true。原编辑表单正确回填上游ID/baseUrl/凭据ID/最大输出和费率，修改最大输出128→256、费率1000/1000→2000/3000后revision1→2；已发布agent实际使用当前模型费率，usage12/2结算30Credit，catalog反映新名称和最大输出。

停用弹框取消保持revision/账本；原确认后资源API enabled=false/revision3、catalog不再列出模型，真实completion403 MODEL_DENIED且供应商/账务不增加。原编辑勾选启用后revision4，参数保持，catalog恢复、实际completion再结算30Credit。总2次生成/60Credit，凭据密文全行不变，后台响应未出现supplierSecret。

v7原探测和编辑/新费率消费已通过，但驱动错按DB数字状态等候页面“0/1”，整体失败。实际Resource API通过decodeResource交付boolean，页面为“否/是”；已按原公开合同修正新驱动，不改产品数据类型。v8完成该新链路，v7原失败及清理保留。

## 产品缺陷：确认尚在途时重复DELETE及Esc提前关闭

[真实v9 RED](../evidence/admin-run-ui-v9-20261021/result.json)：原DELETE已执行但204交付暂挂时，两次物理确认发出两个DELETE（204、404），确认/取消均未锁定，Esc使弹框提前关闭。后台真实处理器和响应正文未替换，仅第一条成功响应延迟交付。

修复原Collection确认入口：同步ref作为同一在途操作的准入锁，busy只投影控件状态；确认/取消在途禁用。保持原DELETE写路径、错误提示与刷新逻辑，finally解锁；成功关闭，失败保留弹框和错误。原Modal先preventDefault原生cancel，再交回原onClose，确保Esc服从React状态所有者的在途保护，普通可关闭场景仍由原callback关闭。

[v10 GREEN](../evidence/admin-run-ui-v10-20261021/result.json)：第一个逻辑操作连续确认只产生一个204；在途确认/取消disabled，Esc后dialog仍open；真实响应交付后关闭，reload无复活。随后另一个真实HTTP请求删除第二条自有记录，原页面确认收到404后错误可见、控件恢复、Esc正常关闭。最终浏览器DELETE计数2来自两个不同的逻辑操作：一次成功204、另一次真实并发删除后的404；不是重复提交。测试期间运行、账本和模型均0。

规格：[确认在途保护](prepublish-admin-delete-pending-spec-2026-10-21.md)、[自动化](prepublish-admin-automation-spec-2026-10-21.md)、[模型管理](prepublish-admin-model-spec-2026-10-21.md)。

## 验证与交付

- 本轮共同确认框改动后，18项相关admin字段/配置会话/范围测试通过，root严格typecheck、Lint和正常build通过，新增Python AST及格式检查通过。未重复运行其他已通过的功能集。
- 五轴复核：准入锁归Collection单一操作入口，Modal只尊重既有onClose所有者，无新业务状态/接口/依赖；保留错误路径并有实际404解除busy验证；没有改后台权限、删除合同或费用规则。新响应延迟gate只属于测试，在finally释放。
- v6/v8是本轮新生命周期的具名结果；共同确认框修复后用v10复测实际新竞态与错误恢复，没有冒称所有旧流程均重放了一遍。
- Chrome/BH原PID/birth均退出、CDP关闭，独立backend/provider关闭、私有根删除。正常127.0.0.1:3000的HTML和两个静态资源为200，所供字节SHA与当前修复构建相同，health正常。无需修改主库或重启后台源码进程。

[独立收尾与当前本机资产核验](../evidence/prepublish-continuation-20261021/admin-resource-lifecycles-independent.json)。这里证明真实前后端传输/状态/计量，受控供应商不代表外部模型质量或供应商最终账单。

复跑新消费者：Node24下，从仓库根运行 `UWORK_ADMIN_UI_CASE=automation`、`model` 或 `delete-pending` 加 `node --import tsx scripts/tests/admin-run-ui.ts admin-run-ui-v数字-20261021`。每次必须新profile，模式互不执行其他已验场景。
