# macOS ARM64 原消息编辑、分叉与子会话继续执行

正常 ARM64 v15 的 fresh `client-native-packaged-macos-clock-arm64-message-edit-fork-v3-20261021` 实测通过 8/8 检查，27.712 秒自然结束。原 UI 完成同 session 编辑重跑、assistant 分叉、child 新问、同 child renderer reload，并保留原席位拒绝、退出和同 profile 冷启动尾段。这里是一个有限联动场景的八项检查，不将其计成八个新产品功能。

使用原正常签名 v15，产品提交 `500914dfe27f96d9db74381c6828244390413281`，manifest SHA256 `3cbde851c06c5975b1620e8443942dcf648fed4fe111b4f71b4efdb3ec90d93c`。测试设施没有替换 Main、preload、Runtime 或任务数据库；仅普通受控供应商回复和只读证据观察。未测试真实企微登录、外部 MCP、网盘或员工通信。

| 实际阶段          | raw/supplier 总请求 | 当前成员累计调用/credits |         新请求 |
| ----------------- | ------------------: | -----------------------: | -------------: |
| warm 完成         |                   4 |                   2 / 44 | 原主请求与标题 |
| 同 session 编辑   |                   5 |                   3 / 66 |     1 个主请求 |
| 原 assistant fork |                   5 |                   3 / 66 |              0 |
| child 新问        |                   6 |                   4 / 88 |     1 个主请求 |
| 同 child reload   |                   6 |                   4 / 88 |              0 |

独立检查实际完整供应商请求：只有初次标题是原精确 997B system 模板；三个真实 streamed main 均携带 32 tools、原 workspace 与受控 model。编辑请求只含编辑后的有效分支，child 请求确实继承已编辑的 user 和 assistant 正文；两者均不包含已经撤回的 warm query/answer。没有通过标题或成功文案代证主请求。

只读原 SQLite、原 codecs 和 canonical active-branch selector 与五份阶段收据对齐：编辑保持 parent session ID；fork 得到不同 child ID、原 parentID 和 taskType=fork。完整复制前缀的 role、正文、modelSelection、完成态和 part types 逐项相等，message 与 part IDs 全部重新映射。parent 在 child 执行后经原 UI 回看，其完整 local SHA 与编辑后相等，最终只读也相等。child 与 reload 两阶段完整 local SHA 相等。原 CLI 的实际私有 DB-FD/cwd/birth 绑定作为基线保留；不虚构本设施未捕获的逐阶段 CLI generation 双重门禁。

原席位拒绝发生在上述成功阶段之后，留下已知拒绝 prompt 的 user 行和 `enterprise_policy_unavailable` assistant error 行，并将 child tasks-index 状态置为 error；这是原拒绝尾段的留史。最终只读核实：此前 child 全部成功历史的完整语义和 IDs 前缀保持，模型及执行偏好未变，额外仅为该拒绝 turn 的两行。不能把 child/reload 阶段的 completed 错称为尾段后最终 tasks-index 仍 completed，也不将这次明确拒绝的历史行当成新增供应商调用。

各阶段和最终原后台 SQLite 完整业务投影确认：旧 current 行保持，另一成员的全部账务业务行保持两笔/44 credits；当前最终四笔/88 credits、48 input 和40 output tokens。fork、reload、席位拒绝、退出和冷启动均无新增 supplier/raw/ledger/trace 业务增量。ledger/gateway_calls 使用真实作用域和 request-key 契约；Trace 不编造逐请求外键。

fixture exit0、原 cleanup errors=[]。独立当前核验 18 个已知进程加两代 BH daemon 共20个 PID 全部消失，四个精确 owned TCP 端口关闭。两代 BH UNIX endpoint 都拒绝连接；遗留 socket inode 明确记为非监听文件，不假称已 unlink。原 OS protocol 恢复，clipboard 未使用。

历史设施失败均保留：v1 暖5后误假设 fork 按钮位于 assistant RowShell 内，实际它是同 turn 的兄弟 footer；v2 已完成真实编辑，但等待 child 的谓词没有排除旧 parent，异步选中前提前接受 parent 后触发断言。v3 仅修观察谓词，并保留同 task pane、精确按钮后缀、同 turn 关系及原20秒预算，没有手动导航、业务 RPC 代替 UI 或延时求绿。历史失败结果及原 source/plan/compiled snapshots 未回写。

证据：[实际八项结果](../evidence/client-native-packaged-macos-clock-arm64-message-edit-fork-v3-20261021/result.json)、[独立实际 verdict](../evidence/client-native-packaged-macos-clock-arm64-message-edit-fork-v3-20261021/backend-linkage-peer-verdict.json)、[五阶段准备审查](../evidence/client-macos-message-edit-fork-preparation-20261021/backend-linkage-v3-final-peer-verdict.json)、[v1 footer 结构取证](../evidence/client-macos-message-edit-fork-preparation-20261021/backend-linkage-footer-topology.json)、[v2 等待 race 因果](../evidence/client-macos-message-edit-fork-preparation-20261021/backend-linkage-v2-fork-race-causality.json)。独立验收只读取已关闭 case，没有重跑 App 或 strict loader，也未修改冻结的76/180/296输入。
