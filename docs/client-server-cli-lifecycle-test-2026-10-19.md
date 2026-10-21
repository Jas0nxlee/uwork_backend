# W03 server-cli 前台生命周期联测（2026-10-19）

W03 v3 已通过原 `serve/status/restart/stop`、同 root 重复启动拒绝及真实 File/System WebSocket 联测。源码为 `a650d96961ef10c2473aeac0790cc229f9d16ba2`；本项补足 W01/W02 直接 Server 入口未覆盖的 Supervisor/Core 所有者生命周期，不关闭 U02–U05 或 T13。

## 实际缺陷与最小修复

独立新 root 的原 `status` 诊断实际 exit1，有限分类为 `DYNAMIC_REQUIRE_UNSUPPORTED/FS`；14 个静态外部依赖均可解析，没有缺失依赖证据。该诊断不是恢复 v2 已丢弃的 stderr，见[导入诊断](../evidence/client-server-cli-import-diagnosis-20261019/status-diagnostic-result.json)。

正常 server-cli 生成 ESM，但既有 banner 仅提供 `__filename/__dirname`，相对 CJS 的 builtin require 无可用本地 `require`。修复只在 banner 中用 `createRequire(import.meta.url)` 提供本模块 require，保留原路径变量及依赖打包规则。三个正式文件：

- [tsup.config.ts](../clients/uwork/packages/zcode-server-cli/tsup.config.ts)
- [ESM 加载规格](../clients/uwork/specs/server-cli-esm-loading.md)
- [真实 bundle 回归](../clients/uwork/packages/zcode-server-cli/test/esm-bundle-load.test.mjs)

回归使用实际 tsup 配置构建相对 CJS fixture，再以真实 Node 子进程执行生成的 ESM，验证 `require("node:fs")`、文件读取及目录变量。有效 RED 为 1 项真实失败，修复后 GREEN 1/1、skip0、子进程 exit0/stderr0。首次输出扩展名假设导致的测试 setup 失败另行保留，不当产品 RED。定向格式、Lint、架构均0，见[修复证据](../evidence/client-server-cli-esm-fix-20261019/manifest.json)。

## 正常构建与真实 v3

五项标准门禁（根/CLI 类型、根/CLI Lint、架构）及五条正常构建命令（CLI 含原 stage、Server、Web、Desktop、server-cli）均实际 exit0，原构建 PTY exit0。7,339 项来源前后匹配；新 server-cli 四文件经 metadata、完整 FD0 和逐 SHA 独核。CLI/stage 同为 `c0f9c281f5c2aa9f7dd3b09c40f45c2bd34fd6efe48ce3261e9fe6bc04d09f4a`。见[正常产物](../evidence/client-server-cli-esm-build-20261019/normal-artifacts.json)与[Root server-cli 独核](../evidence/client-post-g04j-boundary-audit-20261019/server-cli-normal-independent.json)。构建器完整 seal0；Root 六树独核先因 Web/Desktop FD 查询不完整停止，保留原失败。随后于 2026-10-19 01:33:23 UTC 重新取得六树完整零 FD，再完成全文件 SHA 与来源核对，见[六树独立核验](../evidence/client-post-g04j-boundary-audit-20261019/normal-all-namespace-independent.json)。

v3 七个原事件依次为：

1. 前台 serve：Supervisor 与第一代 Core 就绪，身份与端口分别绑定。
2. status/首条 WS：原 FileService 读取 owned sentinel，SystemService 校验隔离 HOME/平台；保持原 loopback `authRequired=false`。
3. 同 root 重复 serve：实际 exit1/`ROOT_ALREADY_RUNNING`，原 Supervisor/Core/代次不变。
4. 原 restart：同一 Supervisor 等待旧 Core 终态后启动第二代，旧 Core 已不存在、原 WS 实际关闭；没有伪造 Core 的直接 exit code。
5. 显式建立新 WS：再次读取同一 sentinel、HOME/平台匹配，重放请求0，不声称自动重连。
6. 原 stop：Supervisor 实际 exit0，状态 stopped、Core PID/port 为空、第二条 WS 实际关闭。
7. finished：业务通过、资源关闭，无需 Root handoff。

原 PTY37755 实际 exit0；30 个已知子句柄均实际 closed、无 timeout。Root 独核含 driver/helper 的33个已知 PID 全部不存在，两端口拒连、精确 control socket 已闭，fixture 完整 FD 查询实际为0。私有 root 保留0700，没有递归删除；关闭后未再读/stat。模型操作0，未人工读取 ownerToken，raw stdout/stderr 未落盘。

[最终 manifest](../evidence/client-server-cli-lifecycle-w03-v3-20261019/manifest.json) 为17公开文件，SHA `a393cb5fc51ef76a55bdfa00e16b04d045efa3df03be584b22cadd96818b62e8`；[结果](../evidence/client-server-cli-lifecycle-w03-v3-20261019/result.json)、[七事件](../evidence/client-server-cli-lifecycle-w03-v3-20261019/safe-events.json)、[原工具终态](../evidence/client-server-cli-lifecycle-w03-v3-20261019/original-pty-terminal.json)及[Root 独核](../evidence/client-post-g04j-boundary-audit-20261019/w03-v3-runtime-independent.json)分列保存。

## 历史失败与边界

- v1 仅 preflight：原 env-file guard 将三个已跟踪 `.env*` 的 Node 读取替换为空，触发错误的 Source hash 拒绝；未启动 serve/Core 或创建运行根。后续以 pinned Python 完整校验所有来源，原 guard 保持启用。[原封存](../evidence/client-server-cli-lifecycle-w03-20261019/manifest.json)不改写。
- v2 前台实际启动 exit1，未取得 ready/Core；原 stderr 未保存，不能倒推其具体异常。子句柄已闭，但原 FD 查询不完整，保根与 handoff 如实保留。新空目录反例确认检查器 cwd 放被测根会引入自身 FD；v3 仅将系统 query cwd 固定仓库，未过滤 holder。[v2 封存](../evidence/client-server-cli-lifecycle-w03-v2-20261019/manifest.json)不改成通过。
- 本项不含 daemon、安装/卸载/更新、OS 服务注册、Node22 发行运行时、跨平台安装、模型或 managed enterprise authority；不替代 Web Cookie/UI、Host ticket 或 Native G07e。真实企微、外部 MCP、网盘仍按用户要求排除。
