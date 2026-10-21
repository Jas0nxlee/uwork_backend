# Server CLI 原更新生命周期与归档属主修复

原 `update`、`ZCODE_SERVER_RELEASE_MANIFEST_URL`、ReleaseInstaller、current/pending 和 Supervisor 是现有入口。桌面自动更新当前禁用，未为测试开启。测试只使用独立安装前缀、未注册 OS 服务、无外部网络；同容器 loopback HTTP 提供真实原发行归档，未替换 update 或网络 fetch。

## 发现并修复

原 tar 提取会要求恢复 macOS 发布机 uid501/gid50。在 root 且已移除 CAP_CHOWN 的正常容器里，原 Server CLI 下载/校验后更新失败，实际报 `Cannot change ownership`。v1 原日志保留，原 Core、端口和 Supervisor 沿原 stop 收口。

窄修 `ComponentCache.extractArchiveSafely`：通过原路径/链接校验后，实际 tar 提取加 `--no-same-owner`，文件归安装者。没有增加 capability、修改 SHA/版本/架构校验或重写归档。ZIP 分支不变。对应 [规格](../clients/uwork/specs/server-release-extraction-ownership.md)与 Linux 专用 [永久合同](../clients/uwork/packages/zcode-server-cli/test/extractionOwnership.linux.mjs)。

永久合同在真实 Linux root 且 CapEff 不含 CAP_CHOWN 下运行：旧源码 1 RED，新源码 1 GREEN；异机 uid/gid 的普通文件能完整提取，执行位/正文保留，目标属主是当前安装者；软链接和 `../` 归档仍拒绝。首个 host bind 尝试因 VM 不挂载客户端目录而退出125，仅是测试设施错误；随后通过独立只读卷取得真实 RED，不拿该挂载错误当产品失败。

## 原生命周期结果

保留旧包 `bfd55ad31626c9fd140cead8be5944f30c3b3eab964887e3b77d6510f9b2e299` 和正常重建新包 `35273aad7c51a6d259ceaeb609364a5880c2581bdc9da4f12edafa3a3cb64b5b`。二者原 manifest.appVersion 都是 **3.16.0**；旧 Core 实际 HTTP 版本为0.0.0-dev（旧版本注入缺陷），新 Core 为3.16.0。这是不同 SHA 的同版构建替换，**不是跨发行版本升级**。

使用正常修复包的原 CLI `update --server-root <隔离根> --json`，通过原在线安装路径先安装旧包，current/pending 均由产品自己写入。之后修复包 CLI 指向该旧安装前缀完成更新；没有依赖旧 CLI 自己绕过提取缺陷。更新到新包后，幂等/status/restart/stop 走该安装前缀的原稳定 launcher。

| 检查               | 实际结果                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| 原 daemon          | 原 CLI自然exit0，Core ready，未注册 OS 服务                                                             |
| 原旧包安装         | update返回applied，current版本3.16.0/原旧SHA，Core HTTP0.0.0-dev                                        |
| 坏 SHA             | 下载真实原新包但catalog声明全0摘要，exit1校验拒绝；current原字节、Core PID/HTTP原状，无pending/事务残留 |
| catalog/包版本错配 | catalog声明3.17.0，原包仍3.16.0；exit1明确版本拒绝，原Core/指针可用，incoming清理，无pending            |
| 正常更新           | 返回applied:true，current切为原新SHA及新release目录，Core真实换代，HTTP3.16.0，pending/事务清理         |
| 同SHA重试          | up-to-date，零额外归档请求，current/PID不变                                                             |
| 原重启             | 新Core再次ready，HTTP仍3.16.0，current保持新release                                                     |

v2 七项通过；v3 将永久属主合同纳入同一个专用入口后，合同1/1与七项生命周期均通过。原 daemon/更新/重试/重启/停止全过程均由实际子进程 CLI 与 HTTP 完成。每轮五个已知 PID、五监听端口和 control socket 已关闭；具名容器与卷移除，私有挂载工作目录保留用于独核。旧/新安装目录中的manifest、CLI、Core、Node和Agent共十个文件与对应原归档逐字SHA一致。

## 命令、证据与边界

专用入口（从后端根运行；复跑须用新名字，依赖已运行的专用 VM，不会启动/停止 VM）：

```sh
python3 scripts/tests/run-server-update.py --name client-server-update-new-20261020
```

该入口构建并运行永久 Linux 属主合同，再执行真实更新生命周期；原归档复制到本轮只读 input 并核对 SHA。容器网络为none、cap-drop ALL、只读镜像和归档，独立工作目录，1GiB内存上限。无GUI、模型、真实身份或员工消息。

主要证据：

- `evidence/client-server-update-v1-20261020/`：原产品更新提取RED及收尾。
- `evidence/client-server-extraction-red-v2-20261020.log`、`evidence/client-server-extraction-green-20261020.log`：原提取函数真实无cap永久合同RED→GREEN。
- `evidence/client-server-update-v3-20261020/{result,controller-result,independent-files}.json`：七项更新结果、资源收尾与十文件独核；同目录 `ownership-contract.log` 为最终永久合同。
- `evidence/client-server-update-normal-{build,stage}-20261020.log`：正常Server构建/原stage成功；没有手改产物版本。
- `evidence/client-server-update-client-gates-20261020.log`：typecheck/Lint/架构通过，113既有warning、0error，架构0违例。
- `evidence/client-server-update-existing-regressions-20261020.log`：版本、ESM、stdin共5/5通过。

候选Core启动失败的真实事务回滚已在[独立后续切片](client-server-update-rollback-test-2026-10-20.md)通过：原发行包与事务不变，通过精确绑定新候选入口的自有Node运行时故障触发，原update失败后自动恢复旧Core，去故障后原update成功；本段准备失败证据本身不替代该后续结果。

原增量变化组件下载、坏组件摘要拒绝、四未变组件复用及缺URL整包fallback已在[后续独立切片](client-server-component-update-test-2026-10-20.md)真实通过，并修复manifest重新序列化导致同包immutable冲突；不由本段整包证据代替。

保留边界：没有原跨版本发行归档，未验跨发行版本升级；本次 catalog 是本地受控真实HTTP服务，不冒称正式远端发布、CDN、签名发行或远端CI。带运行任务的force更新、OS注册服务更新、Windows/macOS发行更新也不由本切片关闭。真实企微浏览器安全拒绝保持，未重试相关页面；外部MCP和网盘仍排除。
