# Native 待读结果与同挂载 Gateway：最小真实复测入口

本文件是源码审查与下一步执行方案，不是 Native 通过报告。没有改动 Main、共享 fixture 或原 Linux probe；新增的 `lease-capability.py` 只验证操作系统能力。真实企微浏览器拒绝不被这些方案绕过，外部 MCP/网盘不参与。

## Read：用普通文件的内核 lease 等待，不替换文件端口

已有 `NodeFileSystemAdapter.readTextFileRange` 会先 `stat`，只接受 `isFile()`，然后 `readTextFileRangeFromNode` 最终调用真实 `fs.promises.readFile`。所以 FIFO 会明确 `not_file`；supplier 的 sleep 又发生在 Read 调度之前，两者都不能证明“真实 Read 已在 OS await 后撤权”。

Linux 文件 lease 可由文件本人 UID 建立，冲突的 `open` 被内核阻塞并通知 lease holder；解除 lease 后原系统调用继续。这是 Linux 自有机制，和 advisory `flock` 不同。依据是 [Linux man-pages 6.16 的 F_GETLEASE/F_SETLEASE](https://www.kernel.org/pub/linux/docs/man-pages/book/man-pages-6.16.pdf) 与 [内核文件锁 API](https://www.kernel.org/doc/html/latest/filesystems/api-summary.html)。

已在现有专用 VM 的一次性自有容器验证，**没有启动/重启 VM，没有 GUI，没有接触后端或用户数据**：

- UID/GID 1000，cap-drop ALL、`CapEff=0`，只读容器、无网络，独立 4 MiB tmpfs。
- 自有普通文件 write lease 建立成功；Node **v24.14.0** 的真实 `fs.promises.readFile` 触发 SIGIO 并一直未退出；其 worker `/proc/<reader>/task/*/wchan` 包含 `__break_lease`。
- `F_UNLCK` 后原 Node 读取 exact marker、exit0；本人 reader 已退出，一次性容器消失、tmpfs 随容器销毁。
- 证据：`evidence/client-linux-lease-capability-v4-20261020.json`；脚本 `scripts/tests/linux-desktop/lease-capability.py`。v3 是 Python reader 的先行成功，不代替 v4 的 Node 读；首轮重复 unlock 在 finally 抛 EAGAIN、JSON 未写，v2 捕获该清理问题、v3/v4 不再重复解除，旧产出保留。仍不能由能力探测宣称 Agent/Native 已通过。

下一步三个新隔离入口即可组成完整链，**不修改原 `backend.mjs`/`probe.py`**：

1. `read-await-backend.mjs`：沿原隔离 backend/HTTPS/普通 member/加密 store/原应用启动装配；受控 supplier 对此测试的首次 streaming 请求只发一次正式 `Read` tool call，路径为当前自有常规文件。后继请求只收集 marker 是否出现及原拒绝错误，再给有限终态；保留完整生产工具面，不在系统 prompt 放正文 marker。
2. `read-lease-holder.py`：UID1000，在独立 tmpfs 的已存在普通文件上持 `F_WRLCK`，记录 acquisition/SIGIO/显式 release/exit。只用有限自有控制管道；读取 `/proc/sys/fs/lease-break-time`，不得调大内核超时。应在 45 秒当前默认断租之前完成撤权/放行，建议 SIGIO 后 10 秒以内。
3. `read-await-probe.py`：复用原 `HarnessBridge`、FirstRun 与原 UI composer/Send 观察入口。新 profile/DB/HOME、原已核 SHA 的 Linux 包，原 Main/Host/包内 Agent 不加补丁。独立受控端点仅改变原后台策略、读证据与解除 OS lease。

实际动作与断言：

| 阶段   | 动作                                                                                                        | 必须成立的证据                                                                                                                                                                                                  |
| ------ | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 准备   | 原后台 security 发布 `allowFilesystem=true`；建立 lease；打开原 Native 工作区                               | 常规文件 mode/inode/owner/marker SHA，lease acquired；未知 reader 未先触发 lease-break；后台发布 revision 已提交                                                                                                |
| 原发送 | 原 composer 输入提示并一次 Send；supplier 发原 `Read(file_path)`                                            | 原 tool call id、生产 CLI PID 与 cwd；Read 已通过 before_dispatch；不把 supplier tool-call 响应当 Read 完成                                                                                                     |
| 等待   | lease holder 收到 SIGIO                                                                                     | **同时核原 CLI 的某个 worker `wchan=__break_lease`**，而非仅 Host 索引器；CLI/Host 还活，后继 supplier 没收到文件 marker。读线程/lease/file 三者必须可归属；若先由索引器触发，停止该轮，不偷认 Agent 已等待读取 |
| 撤权   | 用当前隔离 admin 会话，经原 `configurations/security` GET→PUT revision→publish 设置 `allowFilesystem=false` | 原发布 HTTP 成功及新 revision/hash；不调用假的 Host authorization，不修改 Renderer 状态，不直接伪造工具结果                                                                                                     |
| 放行   | holder 显式 `F_UNLCK`，原 Node OS 读取恢复                                                                  | 原 CLI 活线程离开 lease wait；正式 `before_result` 通过原 Host 私有 relay/后台当前权限复验；原错误提示/工具失败终态出现，所有后继 supplier 请求无文件 marker                                                    |
| 对照   | 新文件/新 call id，同一实现允许态 lease 等待后放行                                                          | 真实正文 marker 进入后继模型且 UI 原 run 终态；避免 Read cache 的 file_unchanged 分支；拒绝组与允许组各自账本/调用数核对                                                                                        |
| 收尾   | 停原应用及本轮服务/holder                                                                                   | holder/原已知进程/端口/BH/容器/卷/网络闭合，策略只在隔离 DB 里改变；保留 RED/失败，不碰主库                                                                                                                     |

为避免宿主共享文件系统未必支持 lease，目标文件应落在本轮 Docker **独立 tmpfs**，可作为工作区内受控挂载子目录。不能从“tmpfs 探测通过”推断 macOS bind/virtiofs 也支持。原文件树索引可能早读文件，需把测试目录加入本轮工作区 ignore 并以 CLI worker 的真实等待证明归属。若容器没有 Python，可复用已存在带 Python 的诊断镜像，仅作 holder；没有必要增加 SYS_ADMIN/FUSE/ptrace 能力。

原权限来源与闭环固定：后台已发布 security → `uworkToolAuthorization` → Host 私有 enterprise authorization relay → CLI executor `before_hooks/before_dispatch` → 真实 Read → executor `before_result` 再查原 owner/当前权限。公开 UI 目录可见与原受控 supplier 的 token 均不是权限来源。

## Gateway：先准确区分“投影退休后旧200”与“真实 Identity owner 换代”

`gatewayIdentityScope.ts` 把原 Identity controller 的 signal 传给 `createUWorkGatewayClient` 的真实 fetch。真实 Identity 退出/换代会同步 abort；`gatewayCatalogLifecycle` 同时退休投影。因此现有 HTTP hold gate 在真实 owner 变化后应记录 abort/drop，而不是成功晚到。不能强行忽略 signal、重放已关闭流或替换服务 DTO 来造成功晚到。

当前 Gateway 用量页的 refresh 按钮 busy 时禁用，但原 `ucas-gateway-period-7d/month/30d` 与 metric pills **没有 busy 禁用**。`readGatewayAccountStats` 先读 entitlement，再读 usage；当前会话拒绝使 Gateway 原 admission generation 前进并清除 user/usage/models，**不会冒充 EnterpriseIdentityService 本地退出**。这形成一个可真实执行的同挂载晚到200场景：

1. 以已有原登录基线打开原 Settings→Usage→企业 Gateway，读当前本人账号/账本。使用 CDP `DOM.describeNode` 记录 `ucas-gateway-panel` 的 **backendNodeId**，并固定 Main PID/CDP target/页面不导航；不要用注入 React/global 状态证明挂载。
2. 独立 `gateway-mounted-backend.mjs` 的 HTTPS 透明代理复用原 `createNativeGatewayUsageHold`，只 arm 一次 exact GET `/api/client/usage?period=month&metric=requests`。原 RefreshUsage 一次后确认真实后台200已暂停，body/headers没有被改写；记录请求 owner 的安全摘要，不打印凭据。
3. 同一隔离后端中，用原 Native 已用测试 session 调用原 `POST /api/auth/logout`（`revokeDevices:false`）只吊销**后台当前测试会话**。这是原后端真实拒绝来源，不是调用 UI logout 或写本地 identity tombstone。
4. 不 Back、不重开设置，原 UI 点击 `ucas-gateway-period-7d`。新操作读 entitlement 实收401；Gateway 原 admission 清除受保护资料并使当前投影 user=null。核 panel backendNodeId 没变、旧账号/套餐/额度/用量消失，busy不被挂住。此处明确不声称本地 EnterpriseIdentity owner 已退出或已切到 B。
5. 再 release 原 month200：原 identity signal 尚未换代，预期 held stream 可以实际 `deliveryStarted=true`、`downstreamFinished=true`。原 Host 的旧 admission/usageSerial 不能把它重新发布为当前投影；原组件的旧 finally 也不能清理新操作。核同 panel 仍无旧资料，模型/账本/Trace零新增、console/script错误零。

新薄驱动应命名 `gateway-mounted-probe.py`，仅复用原 BH/DOM/Input，并在本轮自有容器里装配新的透明代理与控制端点。共享 `native-gateway-usage-hold.mjs` 不改；它已能 record 200/held/released/downstream finish/abort，且原 owner 已关闭时不会重放。每一阶段都有后端原响应与 DOM 同步快照，不能只有最终 screenshot。

该场景的准确结论应是“**同挂载 Native Gateway 在当前服务端授权被拒绝后成功收到旧 HTTP200，旧受保护投影没有回灌**”。它不是“旧 UcasGatewayView DTO 成功越过 Host 后被 React 丢弃”，也不是“A→B 真 identity 热切”。若实际 release 只得到 abort/drop，须按实收记录，不能把 `response200=true` 当成功交付。

如果还要求 **真实 Identity owner 变化且同一 panel 保持挂载**，当前不应伪造热切 UI：可另做原 `issueSession(..., ttl=60000)` 的短期隔离会话，生产 store 与 `/api/auth/me` 保持同一 issuer/expiresAt，让原 Host `scheduleExpiry/expireSession` 自然过期；在真实 expiresAt 前约5秒由原 RefreshUsage arm hold，等待原 owner 退休与 panel signed-out，然后释放应观察到原 abort/drop。此项仍不是晚到成功；其价值是补同挂载真实身份退休，而不回退为组件测试。需要新鲜启动总预算和明确原 TTL，不能修改时钟或伪造 client expiresAt。

同 profile A→B 只能经过现产品的退出/登录入口，原设置页会卸载；未发现保持本 Gateway panel 挂载的公开企业热切入口。完整项目应把这条事实记为入口边界，而非无限重演 G09b 或自建一个热切 RPC/Service owner。

## 后续实际结果

Gateway方案已经分别取得两个真实原包结果：[服务器拒绝后同挂载旧200 v2](client-native-gateway-mounted-late200-test-2026-10-20.md)5项通过；[原60秒TTL自然到期v1](client-native-gateway-expiry-test-2026-10-20.md)6项通过。前者确实downstream finish，后者确实abort/drop，均没有把组件测试冒充Native；原store/模型目录/零计量与收尾各自留证。本文前面的步骤保留为当时计划；Read lease随后已由原已安装Native v1取得6项真实检查，原CLI完成读取后的扣留结果与before_result错误模板63bytes/SHA精确一致，allow对照和资源收尾通过，见[独立peer verdict](../evidence/client-linux-pending-read-peer-verdict-20261020.json)。不是用OS能力探测或Skills UI barrier代替Read最终结果。
