# Native SSH 远程目录选择器：浏览、取消与重连

当前状态：**部分真实证据，未完成，停止下一轮 GUI**。此前安全审查已拒绝 remote provider runtime 探针，而当前原 Native 入口在发布目录界面前必经同类自动同步 RPC，不能经原 UI 重试该边界。没有裁掉同步屏障、mock target、修改 required，也没有借别的工具绕过。本次未达到真实目录浏览、取消和重连验收；不能称 metadata 全绿。

已实际运行的动作只有原 Native onboarding/SSH 表单、本轮自有 SSH key 认证及七项正常资源部署；没有创建远程任务，没有调用远程模型或 Agent 命令。外部 MCP、网盘及被拒企微 URL 均未操作。

## 必经发布屏障与停止原因

`desktopRemoteSessions.ts` 的 `handleConnected` 在收到原 stdio 连接结果后，先注册 `providerProvisioningCoordinator`，**await `registration.initialSync` 成功后**才 `attachRendererPort` 并返回 sessionId。`host/remoteProviderProvisioningService.ts` 的 `syncLocalToRemote` 会读取本地 provisioning envelope，再调用远端 `providerProvisioningTargetService.apply(envelope)`。因此不能声称真正原 Native 目录入口的整个连接只有 File/System RPC。

本轮 v6 止于 stdio 原执行因目标 tmpfs noexec 失败、v7/v8 尚未到 SSH；尚未跨过上述自动同步 RPC。Root 明确要求停止后续执行，以保留历史拒绝边界。后续仅可保留准备与源码审计；不能将这份 driver 的 GUI 命令当成继续运行的授权。

## 原合同与验收断言

原界面是 `packages/ui/src/SSHDialog.tsx` 的 `RemoteConnectionDialog`，从 composer 的 `composer-workspace-trigger` → `composer-remote-connection` → `remote-kind-ssh` 进入。主机、端口、用户名和本轮专用私钥路径均由原表单输入；`local-download-upload` 是原默认资源安装策略。

目录界面 `DirectoryBrowser.tsx` 首先调用 `systemService.info()`，使用返回的 `homedir`，随后调用 `fileService.readdir({path})`。切换隐藏目录时原参数为 `{path,includeHidden:true}`。目录行只导航；本次不点击“选择项目”，不调用 `onSelectProject`，不触发远程 workspace 绑定或模型消费。自有目录 `/home/node/selector-owned/child` 和 `.hidden-child` 用于核实实际目录结果及隐藏切换。

取消语义以当前源码为准：`SSHDialog.closeDialog` → `handleCancelSession` → `useRemoteWorkspaceHistory.handleCancelRemoteProject` → 原 `platform.disposeRemoteSession` → Main 退休 route/renderer attachment → 原 Host `windowRemoteConnectionRegistry.disposeSession`。在线 SSH 是 **window-scoped connection cache**，删除最后一个 logical session 后仍保留 ready 连接；只有窗口 Host shutdown 才释放底层连接。验收因此要求取消后的原 Host topology 是 `connections=1,logicalSessions=0`，同一窗口再次连接复用原 stdio PID，最终原 Host 关闭后 stdio PID 消失。不能把“取消后没有立即杀 stdio”误报成产品 bug。

原 `normalizeRemoteResourcePackageSelection` 固定选择 server-bundle、node-runtime、node-pty、glm、bfs、ripgrep、ugrep，本次未裁剪。v6 原日志走完七项部署并到 stdio launch，但没有完成 handshake。目录浏览、目标七文件逐 SHA 回读、取消后文件保留、重连字节不变均是**尚未执行的验收断言**。

SSH 的 `buildSSHConnectConfig` 当前没有 `hostVerifier`、`hostHash` 或 known_hosts 读取实现。本次仅记录自有服务器生成的主机公钥指纹和本轮用户认证公钥指纹，不能声称测过原产品不存在的 known-host 校验；没有临时添加产品校验。

## 冻结输入与资产来源

桌面输入为原正常 Clock AppImage：

- AppImage SHA256：`629fc093e5018cc50c120f0f046c3426d29c673388014ed8c32dab1d4358e7a1`。
- 原 asar：`3658e4731d2f23977b0bf0ecdf0a7378fa05d0bab531b12100904353b850fd4e`。
- 原 Agent：`cdf781ecf004b9639157fae25e6e96e558b95faefaee7aab09488d5dc650ecac`。
- 镜像 `uwork-linux-desktop-appimage:20261020-v9-clock`，运行前按不可变 image ID 核验原 AppImage，启动后另回读实际提取目录 asar/Agent。

远程 SSH stdio 服务是另一正常 producer：`pnpm --filter @zcode/server build:remote`（exit 0），产物 `packages/server/dist/remote/zcode-server.cjs`，5,636,001 bytes，SHA256 `0b2fce407e3ca560aaab2e0bc5f86881b6b9e00cc4a1bd069b31e7205de27e1d`。没有将 HTTP Server Core 改名冒充 stdio bundle。

Node、Agent、完整官方插件目录从原正常 Server 归档 `7774c7dbebd534032f83020fb45c7a392ab03ff2b132535b10c001a592ba3958` 取用，Node SHA `fd959ead1bf6d636f3c441b0943c4c0929db48cbf7608aa3516e66d12a727ec5`，Agent 与上述 cdf 完全相同。pty 来自原 ARM64 依赖，SHA `d8314caa682827c0bcab6a7a2ef121a17065605e830d5eac55de3245333b3ad8`。三个搜索工具来自此前自有依赖镜像 `sha256:649b14f1a44859835730c0f2da748279571222ef0cc392c13231e10676762bae`；只 create/cp/remove，未运行其业务。各二进制、来源容器回收及原第三方声明见 `data/sandbox-verification/client-linux-remote-selector-prepared-v2-20261020/remote-asset-stage.json`。

七项归档使用原 `prepare-prebuilds.mjs` 导出的确定性 tar、版本与 artifact 路径函数生成，manifest 遵循原 `manifest-linux-arm64.json` 合同。本轮只用原 `ZCODE_REMOTE_ASSET_CDN_BASE_URL` 指向隔离内网的自有静态文件源；该源只读真实 manifest/archive，不伪造 RPC、认证、部署或目录响应。Main 正常下载、SHA 校验、本地缓存、原 SSH/SFTP 上传、原 deploy/stdio handshake 均保留。

自有目标是真正 OpenSSH，只有本轮专用 key 可认证为 UID 1000 的 node。GUI 无 Docker CLI/daemon socket，不为选择 Docker kind 挂载宿主完整 socket。目标与 GUI 在本轮 internal 网络，无对外端口。目标 rootfs 只读、home/run/tmp 为本轮 tmpfs；正常 deploy 可写隔离 node home。原 fixture 启动参数仍有 `--no-sandbox`，本轮不是 sandbox 正例。

## 独立脚本与历史执行记录（GUI 已停止）

- `scripts/tests/linux-desktop/remote-selector-prepare.mjs`：新 profile、同轮专属 key、原 fixture bundle 和真实 sshd 构建素材。
- `remote-selector-assets.mjs --stage`：正常来源拷贝、逐 SHA 核验；`--pack`：独立原 helper 压缩窗口。
- `remote-selector-probe.py`：启动自有目标/原 AppImage；仅通过 browser-harness 接明确 owned CDP、新 profile；DOM 只读，原 Input 事件完成表单/目录/取消，不注入 React 状态或产品 RPC。成功必须包含逻辑会话退休、同窗口缓存复用、原 Host shutdown 的 stdio 释放及资源闭环。

以下是历史 v4 命令形态，**当前不得再次运行 GUI**。仅 `--prepare-only` 的离线资产核验不跨同步屏障。

```sh
NODE=/Users/ljp/.cache/uwork-client-toolchain/node-v24.14.0-darwin-arm64/bin/node
$NODE scripts/tests/linux-desktop/remote-selector-prepare.mjs client-linux-remote-selector-native-v4-20261020
python3 scripts/tests/linux-desktop/remote-selector-probe.py \
  --preparation data/sandbox-verification/client-linux-remote-selector-native-v4-20261020/preparation.json \
  --cdn-dir data/sandbox-verification/client-linux-remote-selector-prepared-v2-20261020/cdn \
  --image uwork-linux-desktop-appimage:20261020-v9-clock \
  --target-image uwork-remote-selector-sshd:20261020-v2
```

profile 必须全新，既有 profile 会主动拒绝覆盖。已冻结的 CDN 可由后续新 profile 逐 SHA 重新使用；其 key、GUI userData 与 evidence 不复用。

## 历史设施失败

1. sshd 镜像 v1 build 在 apt 前因继承依赖镜像 USER node 而权限失败。Dockerfile 明确切回 root 安装 OpenSSH 后，v2 原 build 成功。未启动产品。
2. `evidence/client-linux-remote-selector-prepared-v2-20261020/result.json`：driver 用 docker cp 后在 cap-drop ALL 的 GUI 中以 root chown，缺少 CAP_CHOWN，任何 CDP/产品操作前失败。没有放宽 GUI capability；改由同 UID 1000 通过 stdin、umask 077 写入本轮 key。
3. `evidence/client-linux-remote-selector-native-v3-20261020/result.json`：prepare 错把所有 packages external，原 fixture 尚未进入 Electron 就因 `@zcode/shared` 未打入 bundle 而退出。已对齐既有 prepare 的 root dependencies external + createRequire banner；用全新 v4 重测。
4. v4 已进入原 Native SSH 配置表单，但 driver 用了 shared 常量中存在、实际原按钮没有挂载的 `ssh-connect-button` test ID；未进行 SSH 连接。已改为只读观察唯一“开始连接”按钮后发送原 Input 点击。
5. v5 到达原 Main 的 connect-remote payload 校验，端口超过 65535 被正确拒绝。原因是 driver 的快捷键缺少虚拟键码/编辑命令，使默认 22 未被全选替换。已使用标准 Input `selectAll` 编辑命令及键码，并对每个输入字段只读回验 exact value；没有放宽原端口校验。
6. v6 原 SSH 认证及七项正常部署已到 stdio launch；目标 `/home/node` tmpfs 未设置 exec，原 Node 执行返回 126、Permission denied，不能完成 handshake。只修独立目标 mount 为 exec，并在 GUI 前同 UID 拷贝/执行本轮 `/bin/true` 做 OS preflight；没有改产品。v6 仍是 failed，目标七文件 SHA 回读没有发生。
7. v7 的目标 exec preflight 通过，但原 AppImage wrapper 在启动阶段记录 code127；原 `/proc` 发现 Main49 并打印 deep-link 初始化，此后 60 秒没有 renderer/Host ready。不能把 wrapper127 等同 Main 已退出，不能归因时钟、fixture 或产品修复。`startup-diagnostic.json` 明列缺少当时 Main PPID/argv/birth 快照；仅保存原 ready、exit、最前 stdout/stderr、Xvfb/CDP logs 和 mount receipts。无产品 fallback。
8. v8 原 WM/display-ready 对照成功启动 wrapper55/Main67/Host191，`startup-live-processes.json` 保存真实 PPID/UID/argv/出生 ticks。FirstRun 四个动作后 finish 阶段失败，初错 cause 被原 helper 隐去；失败 UI 诊断也未取到。最终 BH 日志的 30 秒 unreachable 文本写入时间晚于 result/cleanup，而工具每次 daemon start 会截断该 log，故不能把它当第一因果。`transport-review.json` 保存只读源码核验与未证实项。原 result 的 `harnessClosed=false` 不改写为绿；容器、网络、端口和本轮 key 已清，owned runtime 目录后续为空，无证据授权杀任何其他 daemon。

v1–v6 的已定位问题属于独立测试设施或正确原校验；v7/v8 的第一根因仍未解决，不归类成已修 fixture 或产品。所有历史失败保留，均不能作为产品已修复或功能完成的证明。真实企微拒绝、managed remote authority、远程模型/命令、外部 MCP 与网盘不在此结论范围。
