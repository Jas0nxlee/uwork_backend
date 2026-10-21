# 组织席位、额度页面与设置读取乱序修复

2026-10-21。本轮补两类未有原页面联动证据的消费者，并真实复现和修复Settings晚读覆盖新状态的产品缺陷。所有身份/资源均为私有fixture中的合成本地数据，原UI、Fastify/SQLite/Gateway实际参与；没有改主库或注入浏览器store/fetch/业务响应。

## 部门与成员席位原页面

[v16完整结果](../evidence/admin-run-ui-v16-20261021/result.json)10阶段通过：原创建部门/无席位成员→原分配/撤销席位→原停用/恢复成员→原部门更名→原删除占用拒绝→原清空成员部门→原删除/reload。

新成员使用真实密码登录后，未分配席位请求403 NO_SEAT，供应商/账本0；原页面分配席位后原token即可调用并结算14Credit，账本归属实际member/department。原撤销席位即时403且不增账。原停用成员后旧session401 SESSION_EXPIRED；恢复active/seat后旧session仍401，新登录才恢复调用，再结算14。

原部门更名后该member的me投影立即显示新名称、相同ID。原删除被占用部门409 DEPARTMENT_IN_USE且页面显示错误；移除成员部门关联后me.department为null，原删除/reload成功，旧两笔账务部门ID原行保持。原owner成员行未变。这里是本地合成成员密码会话，不计作企微或Native重认证。

## 原订阅与限量表单

[v17新用例结果](../evidence/admin-run-ui-v17-20261021/result.json)：原表单member限量0→真实completion402 QUOTA_EXCEEDED/零模型账务；同原表单1000后调用成功14Credit；原表单限量降到已消费14后再请求402，旧账本逐行保持；原移除规则后再成功14。原页面reload已使用28、限量表空，原subscription/model资源全行保持，浏览器3次PUT/1次DELETE及审计匹配。

## 产品缺陷与真实RED→GREEN

原Settings.load逐次读取并无版本准入。测试以真实HTTP准备两条限量，原页面移除member后暂挂该次原GET的一行快照；再原移除application，让新读真实返回空且页面0行；然后交付旧成功响应。

[v19真实RED](../evidence/admin-run-ui-v19-20261021/result.json)：浏览器PerformanceResourceTiming完成数2→3，原服务端reply finish=true，说明旧成功响应实际完成交付。之后20次DOM观察均有application:uwork一行，而后台最终limits为空；max rows=1，预期0。未把“服务端已释放gate”当成浏览器已消费，也未用abort/drop代替晚成功。

修复原Settings读取交付所有者：每轮load捕获generation，挂载/view/base退休使旧代失效；data/retention或data/limits两次原顺序读取完整后，只有当前代才能成组提交，catch同样受当前代保护，已卸载操作不再通知/重载。后台限量、权限和计量规则以及共享FormDialog未变。

[v20真实GREEN](../evidence/admin-run-ui-v20-20261021/result.json)：相同原晚成功仍完成浏览器交付，Performance2→3，但20次观察均0行，后台仍空。仅对被此修改影响的正常限量流程做[v21针对性回归](../evidence/admin-run-ui-v21-20261021/result.json)，0/1000/14/移除和28Credit原页面显示全部通过，没有重跑其他已验功能集。

v18第一轮未取得“新读先完成”里程碑，不计产品RED。随后在独占Chrome target通过标准CDP关闭HTTP cache，以独立并行读取取得所需真实交付次序；未修改应用fetch或响应正文。v19/v20都采用同一浏览器配置和断言，v18原失败与清理保留。不能由v18未完成次序直接宣称一个唯一的浏览器根因。

规格：[部门/成员](prepublish-admin-directory-spec-2026-10-21.md)、[限量](prepublish-admin-limits-spec-2026-10-21.md)、[读取乱序](prepublish-settings-read-order-spec-2026-10-21.md)。

## 验证、评审和清理

root严格typecheck、Lint、正常build以及新增Python AST/格式检查通过。以真实失败回归和受影响正常路径验证本次UI修改；未追加镜像实现细节的测试或重复旧309项。

按正确性/可读性/架构/安全/性能复核：只在现有Settings保留当前挂载/读取generation准入，未引入新状态存储、业务API、依赖、宽松权限或额外超时；原请求先后顺序保持。旧成功读取丢弃UI提交，原请求仍实际完成，成组状态避免跨代混合。

所有独占Chrome/BH原PID及birth退出、CDP/服务端口关闭、私有根删除；失败轮次亦核对。正常3000首页及当前构建资源字节SHA相同、health正常，新打开或刷新管理页会使用修复后的构建。[独立收尾与资产核验](../evidence/prepublish-continuation-20261021/directory-limits-read-order-independent.json)。没有修改主.env/人员资料，不测试企微、远端、MCP/网盘或多系统发行物；受控供应商只证明本机真实传输与计量，不是外部模型或最终账单。

复跑新profile：Node24下，`UWORK_ADMIN_UI_CASE=directory`、`limits`或`settings-race`加 `node --import tsx scripts/tests/admin-run-ui.ts admin-run-ui-v数字-20261021`。
