# Mac 原 UI 冷恢复的后端阶段快照

本轮只准备只读 helper，未启动后台/HTTP/GUI/VM，也没有业务数据写入。与[Mac一致性矩阵](client-macos-arm64-backend-consistency-matrix-2026-10-20.md)共用同一个未来 fresh fixture；不新开第二套计数或拼接不同轮次。当前优先①仍登录的已完成 task 冷恢复，②成员 disabled→active 后原 UI 重认证恢复。既有 Mac v6 原7项及A/B Native15不重复计为新增覆盖。

入口为 `scripts/fixtures/mac-backend-stage-snapshot.mjs`：

```js
const before = captureMacBackendStage(app.services.db, {
  authority: "owned-fixture-existing-db",
  phase: "before-cold",
  sampledAt: Date.now(),
  actors: [
    { label: "current", tenantId, userId: memberId },
    { label: "other", tenantId, userId: otherMemberId },
  ],
});
// post-cold 用相同 actors、同一 app.services.db；不 new Db。
assertMacActorAccountingDelta(before, after, "current", {
  ledgerRows: 0,
  traceRows: 0,
  gatewayCalls: 0,
  credits: 0,
  inputTokens: 0,
  outputTokens: 0,
});
assertMacOtherActorAccountingUnchanged(before, after, "other");
```

## 权威字段与边界

| 输出                             | 来源与用途                                                          | 不代表什么                                                                                                           |
| -------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| identity                         | 原members的tenant/user/role/department/status/seat                  | 这是membership，不是已确认的Mac当前Host owner或已登录UI；还需原auth/me与UI匹配                                       |
| nonexpiredSessionCounts          | 原sessions按该actor/kind计数与创建/过期时间，不读hash               | 不是本地Task/Agent session，不证明具体旧token恢复；禁用后真实401仍须原请求取证                                       |
| configurations                   | 原kind/version/revision/published摘要                               | draft revision不等于publish version；快照返回不等于Host/UI已消费新版本                                               |
| policies、tenantModelDefinitions | policy顺序/范围与内容摘要；model revision、名称摘要、真实能力/rates | 不是effective catalog/permission决定；以原GET /v1/models、configuration/authorize HTTP为准，catalog没有原version字段 |
| ledger                           | 全部原业务列显式白名单，request_key仅同源摘要                       | Credit来自原账，不能用当前模型费率回算跨版本历史；rolling usage/entitlement须按其原period/from/until合同对账         |
| gatewayCalls                     | 原tenant/user/request_key摘要、created_at、has_result               | 不输出fingerprint或密封result；既有行不必假定都成功或与全部ledger一一对应                                            |
| traces                           | 原TraceID、actor/model/application/status/tokens/error/time         | 原schema无request_key或请求FK，不能把TraceID、Fastify requestId和ledger key当一个ID                                  |

query adapter仅借用原fixture同步 `Db.all`，SQL全是常量SELECT、actor值参数绑定；不实例化原Db（其构造会写lease/migration）、不加transaction/write lock、不发业务HTTP。一次capture无await，按原fixture单写进程同一个event-loop turn读取；不声称多进程任意写入时的数据库事务快照。快照显式只保安全列/摘要，不保token、session hash、credential/baseURL、headers、raw request/response或配置正文。

ledger与gateway_calls允许按**同tenant/user的真实request_key摘要**核对；positive delta只有调用者明确指定该阶段2笔settled/2条succeeded/预期model/application/tokens/Credit时才执行对应约束，不对所有历史账做强行一对一。Trace只做真实ID集合和actor/model/application/tokens聚合，不制造逐请求关联。冷恢复零delta会连released零费用新行、failed Trace或gateway新key一并拒绝，而非只看Credit不变。

## ①冷恢复阶段的完整oracle

- before：原Composer主回答和标题两次调用均已settled、Trace已落、供应商响应终态，完成task语义稳定后取baseline，不在reserved/pending阶段开始比较。
- 原UI/SDK由Native owner读取task/session/message role/content/status/model/reasoning/cwd/workspace；本helper不读客户端库、不创建task、不resume或prompt。PID、lastViewedAt、连接lease等自然变化不混进持久消息合同，也不无依据要求冷启动自动选中某个历史task。
- 同profile、同controller、仅初始一次bootstrap，原stopNative/launch后通过原UI读该历史task，再取post-cold。后台仍为同一实例。
- supplier request集合、原backend `POST /v1/chat/completions`真实入站计数、accepted call key集合、ledger各行/金额/token、actor-scoped TraceID集合均零增；另一member ledger逐字段保持。**cached idempotent重发也可能不增supplier/账本/Trace/gateway行，故不能用本helper代替真实HTTP入站零重放证据。**
- configuration GET、client events、lastSeen和连接恢复允许正常发生，不要求全DB字节不变。UI/SDK语义、HTTP和DB这三层证据分开保存，控制API返回不等于UI更新或请求执行。

②候选的后端依据：`src/directory.ts` 在原PATCH disabled时按tenant/user删除sessions，active不会重建旧session；`src/access.ts` 对已删除或inactive成员的旧token返回401/SESSION_EXPIRED。Mac7只测seat=false的403及注销态cold，不能替代此恢复链；当前helper只准备读取，与①不混计数，等Root另选fresh场景。

纯合同已7/7：SELECT-only/敏感字段不输出、scope串号拒绝、精确actor/model/application/key与聚合、零费用释放行/failed Trace拒绝、旧行变化/另一member变化拒绝、同actor冒作双成员拒绝、异步adapter/错误authority/路径phase拒绝。测试使用受控内存行形状，不是实际backend或Native验收；针对性Lint与格式/语法检查通过，证据在 `evidence/client-macos-backend-stage-snapshot-20261021/`。
