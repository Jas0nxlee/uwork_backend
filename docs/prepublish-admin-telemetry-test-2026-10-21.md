# 观测页面与原留存按钮实际清理

v28新增场景通过：原用量明细、调用追踪、终端事件显示真实HTTP生成记录；成员/部门/应用3维聚合均2请求、28Credit、输入24/输出4Token；不存在模型查询为空，按真实模型id查询恢复。原页面reload后继续核对同一账本。

原企业页立即清理返回audit/traces/client_events/gateway_calls各1，runs/sandbox_executions0。控制器只将真实生产者生成记录的created_at推进到8天前，网关缓存2天前；未伪造HTTP或worker结果。原保留7天配置由HTTP前置。近期行逐字保持、另一合成企业5表老记录逐字保持，当前企业2笔真实settled14和另一企业合成对照ledger逐行不变。清理后原trace/event为1、usage仍2且28Credit；再次清理全部0，有2条真实purge审计。

v26失败停在预期2条追踪的等待，发生于配置留存后直接老化、后台首轮巡检也可能执行的时序；缺少当时DOM/数据快照，不能单凭此失败认定产品漏记录。v27改为先在未配置状态跨过首个worker tick，再老化，并在原UI前通过原API明确核对usage/trace/event均2；这些通过后，失败在选择部门维度，DOM诊断明确select仍member，未产生新的聚合HTTP。v28仅修正原生select输入为已验证的字符typeahead加rawTab，无DOM赋值、业务fetch或断言放宽，完整新场景通过。v26/v27失败原始证据保留，不记为产品修复。

Node24严格typecheck、目标eslint、Python AST通过；产品未因本case改变，未重复此前已完成场景。自有浏览器、后端/供应商端口、私有数据根均关闭清除。未测试自然等待8天、CSV下载或其他外部集成；CSV另列后续新用例。

- [v28原始结果](../evidence/admin-run-ui-v28-20261021/result.json)
- [v26设施/时序失败](../evidence/admin-run-ui-v26-20261021/result.json) / [v27选择控件失败](../evidence/admin-run-ui-v27-20261021/browser-inspect-before-purge.log)
- [类型](../evidence/prepublish-continuation-20261021/admin-telemetry-final-typecheck.log) / [Lint](../evidence/prepublish-continuation-20261021/admin-telemetry-lint.log)

全新profile以`UWORK_ADMIN_UI_CASE=telemetry node --import tsx scripts/tests/admin-run-ui.ts admin-run-ui-v数字-20261021`运行。该用例覆盖原按钮的真实保留边界，不宣称全项目覆盖。
