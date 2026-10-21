# G04k：原生 B 账号选模与实际发送

2026-10-20，以当前生产 Desktop/Host/staged CLI，在隔离后台完成 **15 项原生检查**。原 A 登录、退出、撤销目录、B 原入口重认证后，通过原模型菜单手选 B 模型，再通过原 Composer 发送一次；主回答和标题均实际到达受控本机供应商。

| 项目       | 结果                                                                                                |
| ---------- | --------------------------------------------------------------------------------------------------- |
| 原 UI      | FirstRun 七动作、A 原登录、原退出、空模型目录、B 原登录、B 自有菜单与用量投影、原模型选择/输入/发送 |
| 主回答     | 回答在原界面可见，提示可见，停止按钮消失                                                            |
| A          | 预置 1 行/7 Credit 保持；调用 0、Trace 0、新增费用 0                                                |
| B          | 预置 1 行/11 Credit → 3 行/55 Credit；新增 2 次调用、2 条 Trace、44 Credit，全部属于 B 普通成员     |
| 业务与清理 | controller exit 0、cleanup errors 空、Electron 已退出、服务器关闭                                   |
| 独立核对   | 4 个已知 PID 不存在、三个已知端口拒连、BH daemon/socket 关闭、host/main SHA 与当前产物一致          |

通过证据：`evidence/client-native-g04k-b-execution-v3-20261020/` 下 `probe-result.json`、`b-execution-proof.json`、`desktop-traffic.json`、`cleanup.json`、`harness-cleanup.json`、`independent-verification.json`、`scoped-fd-verification.json`。私有测试根保留 0700，不声称已删除。

## 本轮修复的夹具缺陷

1. 双组织模式原关闭流程在 `app.close()` 关闭 SQLite 后才读取双组织统计，优雅退出失败。现改为数据库关闭前取只读快照，再关闭所有者并写证据。
2. `paths` 原先已被收进 email-bootstrap 回调局部作用域，关闭阶段仍直接访问它，导致 `ReferenceError`。现只在实际执行 bootstrap 时登记复位回调；空身份模式不访问该局部变量。
3. 原探针业务通过便写 passed，未把 controller exit code 纳入验收。现非零退出或资源关闭失败均让整轮失败；业务检查单列保留。

首轮/v2业务均通过，分别保留非零退出事实，不能算完整 GREEN。最小双组织后台启动→SIGTERM 诊断复现 ReferenceError，修复后 `fixture-closed/errors=0`、exit 0；之后 v3 重新跑完整原生链路，取得业务和清理同时通过。

新增显式执行模式仅在双组织夹具开启时允许，默认仍零模型调用；错误组合被合同测试拒绝。原生控制现在使用独立 browser-harness daemon 与该 Electron 的精确 CDP 端点。每轮必须新 profile，禁止覆盖历史证据。未注入 React 状态或业务响应，未触碰用户 Chrome。

夹具全套 **168/168**，关闭相关 **28/28** 通过。真实企微仍由受控身份兑换替代；供应商为本机 HTTP 测试服务。此结果补齐 Native 实际发送，不是外部企业验收，也不是此前 source-lock/Go/actor 仪式的追认。
