# W04 server-cli detached fallback 联测（2026-10-19）

原 `serve --daemon` 配合既有 `ZCODE_SERVER_SKIP_SERVICE_REGISTRATION=1` 已真实通过。源码仍为 `a650d96961ef10c2473aeac0790cc229f9d16ba2`，复用 W03 的[正常构建](../evidence/client-server-cli-esm-build-20261019/normal-artifacts.json)；未为本项改产品或重建。此入口不注册 OS 服务，独有验收是启动 CLI 退出后，detached Supervisor 仍正确拥有 Core 与控制端点。

实际 driver 用时2.715s，四个安全事件依次通过：

1. `cli-exited-supervisor-alive`：启动 CLI99339 实际 exit0、随后严格不存在；Supervisor99340 仍存活，PPID1/PGID99340，Core99341 的 PPID/PGID均为99340。两个进程的 birth、owned cwd、原 listener/control socket 已绑定。仅观察到最终父进程1，没有声称观察到中间 reparent。
2. `sentinel`：独立原 status 仍为 ready、代次1、serviceRegistered=false；原 SocketProtocol/ChannelClient/RemoteServiceAccess 完成 FileService 文本哨兵和 SystemService HOME/platform 校验，保持原 loopback `authRequired=false`。
3. `stopped`：唯一原 stop CLI 实际 exit0，原 WS 真实关闭，Core/Supervisor 严格不存在，状态 stopped、Core PID/port 为空。detached 进程不是 driver 的直接子进程，没有声称取得其直接 exit code。
4. `finished`：业务通过、资源闭合、无需 Root handoff；没有 restart、重复 serve 或模型操作。

原 PTY66321 实际 exit0，23个 driver 子句柄全部实际 closed、timeout0。加 Supervisor/Core/driver 共26个已知 PID，由[Root 独核](../evidence/client-post-g04j-boundary-audit-20261019/w04-runtime-independent.json)确认严格 ps rc1/stdout0/stderr0；端口64420拒连、精确 control socket 已闭。fixture 原完整 FD 查询为0，Root保留该记录，没有关闭后重新进入私有根扫描。

私有根保留0700，closed 后未再读/stat。ownerToken只由原CLI持有/读取，测试未人工解析；raw stdout/stderr未落盘。候选Core/port在原ready DTO后即保留，严格身份校验成功才admitted，首错也不会因候选数组为空而误报全闭。八项纯合同仅证明运行器控制流，不冒称额外产品场景。

[公开manifest](../evidence/client-server-cli-detached-fallback-w04-20261019/manifest.json)含12文件/12,209字节，SHA `8e2628aa53386f00823ed6d7788e55d556658775dfb5929072356ed7709ce2cb`；[结果](../evidence/client-server-cli-detached-fallback-w04-20261019/result.json)、[原事件顺序](../evidence/client-server-cli-detached-fallback-w04-20261019/safe-events.json)、[资源终态](../evidence/client-server-cli-detached-fallback-w04-20261019/resources.json)及[原PTY终态](../evidence/client-server-cli-detached-fallback-w04-20261019/original-pty-terminal.json)分别保留，Root已逐SHA核验。

本项补齐 W03 前台范围之外的显式 opt-out detached 所有权，不改写 W03 v1/v2 历史失败。它不覆盖 OS service 注册、安装/更新/卸载、Node22发行运行时、目标平台、enterprise/managed authority、Cookie/UI或模型；真实企微、外部MCP、网盘仍排除。Native G07e独立待验，U02–U05/T13保持原状态。
