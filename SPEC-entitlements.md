# entitlements

目标：订阅/席位、本地 Credit 账本、成员/部门/应用限量，原子准入与幂等结算。
实现：src/entitlements.ts；SQLite BEGIN IMMEDIATE 事务；订阅有效期、自然月/订阅月 UTC 周期；预留/结算与事件唯一键。明确未执行的失败释放；断流、超时、取消或进程重启无法确认用量时标记 uncertain，占用预留额度，由管理员凭对账证据核实，不允许用户通过断流免费调用。
验收：并发不能突破额度，重复请求不重复扣量；周期隔离、席位不足阻断执行、历史账目不被重置删除。
命令：npm test；npm run build。必须测试边界时间、并发与幂等。
边界：付款与供应商账单另行接入；整数 Credit 非货币。

客户端额度保留既有 `amountTotal`（本人限额或企业参考额）和 `amountUsed`（本人当期 settled/uncertain），新增 `effectiveAllowance: {application:"uwork",period,amountRemaining,blocked,reason}`。有效剩余复用预占准入的同一限额计算：订阅 Credit、显式企业限额、本人限额、当前所有祖先部门限额和 `uwork` 应用限额，每项扣除对应 settled/uncertain 金额与 reserved 预占，取非负最小剩余。订阅未生效/过期时剩余 0、`reason="subscription_inactive"`；有效剩余 0 时 `reason="quota_exhausted"`；其余 reason 为 null。blocked 仅表明正 Credit 请求缺少预算，不取代模型/席位/策略及逐请求原子预占裁决，也不改变零计价请求的既有规则。不下发其他成员明细、共享已用聚合或内部约束对象 ID；此对象仅描述当前会话用户在当前组织的 UWork 预算。
