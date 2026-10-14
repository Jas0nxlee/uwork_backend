# entitlements

目标：订阅/席位、本地 Credit 账本、成员/部门/应用限量，原子准入与幂等结算。
实现：src/entitlements.ts；SQLite BEGIN IMMEDIATE 事务；订阅有效期、自然月/订阅月 UTC 周期；预留/结算/失败释放，事件唯一键。
验收：并发不能突破额度，重复请求不重复扣量；周期隔离、席位不足阻断执行、历史账目不被重置删除。
命令：npm test；npm run build。必须测试边界时间、并发与幂等。
边界：付款与供应商账单另行接入；整数 Credit 非货币。
