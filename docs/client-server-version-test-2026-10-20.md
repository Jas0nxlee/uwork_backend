# Server 运行版本与 Linux ARM64 发行运行时补测（2026-10-20）

发现原正常 Server 构建没有注入共享 `__ZCODE_VERSION__`，实际 status / Core HTTP 回退到 `0.0.0-dev`；stageCli 却从根 package.json 写入 `3.16.0`。已修复 tsup 配置，让两个 Server bundle 与发行 manifest 共用根版本来源。

永久回归实际调用原 tsup 配置、编译共享 version.ts 并运行结果，取得 [RED：0.0.0-dev ≠ 3.16.0](../evidence/client-server-version-red-20261020.log)。修复后[联合 ESM/输入生命周期/版本共五项通过](../evidence/client-server-version-regression-green-20261020.log)。正常重建后，[macOS 原 launchd 全链六项](../evidence/client-server-service-v4-version-20261020/result.json)再通过，启动和重启后的所有运行版本均为 3.16.0，[精确服务独核已不存在](../evidence/client-server-version-native-verdict-20261020.json)。类型/Lint/架构门禁通过，Lint 保留 113 既有 warning、0 error。

影响范围需精确区分：归档安装器核对 manifest 版本，但 Supervisor 的 ready 等待没有比较 Core 报告版本。因此已证实的是版本报告错误，不声称已复现版本不符造成更新失败；本修复不新增更新拒绝规则。

Linux 原 stageCli 已完成两轮。旧 Server 两个 bundle 在复制依赖前已落入旧发行树，并与当时 dist [逐 SHA 一致](../evidence/client-linux-old-runtime-hashes-20261020.json)。旧树完整移至独立 cache 保留，后续正常重建和重新 stage 生成新树，未修改旧包或旧 manifest。

## Linux 实际 RED→GREEN

- [旧包 RED](../evidence/client-linux-release-red-20261020/result.json)：Node22、三项 native 工具、原 Agent 入口加载均通过；原 daemon 实际 ready 后 version=0.0.0-dev，与原 manifest=3.16.0 不符。探针立即沿原 stop 清理，Core PID/端口/control socket 关闭；[容器与专属卷已移除](../evidence/client-linux-release-red-20261020/controller-result.json)。
- [新包 GREEN](../evidence/client-linux-release-green-20261020/result.json)：八项全部通过。包内 Node22/Linux ARM64、native 工具、原 Agent 入口加载，原 launcher→Core/HTTP 的版本一致，真实 SocketProtocol/ChannelClient/RemoteServiceAccess 读取自有文件并回报隔离 HOME/Linux，restart 更换 Core 并重新建立 WS 读相同文件，原 stop，原 uninstall 双确认自然 exit 0。
- [新包容器终态](../evidence/client-linux-release-green-20261020/controller-result.json)：container exit 0；无外部网络、发行卷只读，容器与专属卷移除。容器内两个已知 Core PID、两个监听端口及 control socket 已闭。未以容器内 PID 数字推断宿主进程。
- [独立核验](../evidence/client-linux-release-independent-verdict-20261020.json)：五组件完整文件名/字节 SHA 与 manifest 相同；旧/新仅 server-runtime 组件变更；包内两个 Server bundle 与新正常 dist 相同，整归档 SHA 与实际送入容器的归档一致。新包 SHA 为 `0aa43d34bd9aba319b0de8679879e0dcf1a827f292e1343ad3af432dafd18582`。

## 环境与证据边界

- 专用 Colima uwork-backend 原为 stopped，本轮启动；当时无其他运行容器，未改默认 context 或虚拟机配置。两轮完成后原 stop 命令 exit 0，[最终状态恢复 Stopped](../evidence/client-linux-colima-final-20261020.json)。另外两个 Colima profile 保持 Stopped。
- 在无外部网络容器里实际执行目标 Node 22.16.0、ripgrep 14.1.1、bfs 4.1.1、ugrep 7.8.4，[命令 exit 0](../evidence/client-linux-native-components-v3-20261020.log)。
- Node 缓存字节与 [Node 官方归档](https://nodejs.org/dist/v22.16.0/node-v22.16.0-linux-arm64.tar.xz)中的 binary 一致，归档 SHA 与同源 SHASUMS256.txt 一致，见[核验结果](../evidence/client-linux-node22-official-verdict-20261020.json)。
- 原 stage 复制依赖较慢；PID/打开的具体文件持续变化，取样显示文件 IO。保留同一进程等待，并对相关依赖做只读文件/hash 校验，未删源文件或跳过依赖。原 stage 最终 exit 0。
- 测试设施历史错误保留：最初 CJS 探针 bundle 不接受顶层 await，改用 ESM；首次 mount 指向 VM 未共享的路径，改用既有 sandbox-verification 挂载区，未修改 VM 配置；native tools 的目录层级按原源码修正；独立校验起初用 pathlib 按路径段排序而非完整 POSIX 字符串排序，修正后完整 SHA/size 与 manifest 一致，见[诊断](../evidence/client-linux-verifier-order-diagnosis-20261020.json)。这些不计为产品缺陷。

此项证明原 Linux Server 发行运行时及与协议客户端的真实联动，Agent 只证明 `--version` 入口在包内 Node22 加载（Agent 自身版本 0.16.9），没有模型调用。Linux 容器显式 opt-out systemd，不能冒称 Linux GUI 安装、systemd、Windows、企业 managed remote authority 或生产发布通过。真实企微、外部 MCP、网盘继续排除。全部原测试根/证据保留。
