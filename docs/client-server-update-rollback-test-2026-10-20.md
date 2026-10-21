# 原 Server 更新事务：候选 Core 启动失败回滚

新增隔离真实验证已通过：正常原发行归档经原 `update` 安装并切换 current 后，候选 Core 在受控 Node 运行时故障下退出；原 Supervisor 自己恢复旧 current 并重启旧 Core。去除故障后，原 update 再次成功进入新包。没有产品逻辑改动。

## 故障与验收边界

旧/新发行归档仍为 `bfd55ad31626c9fd140cead8be5944f30c3b3eab964887e3b77d6510f9b2e299` / `35273aad7c51a6d259ceaeb609364a5880c2581bdc9da4f12edafa3a3cb64b5b`，原包文件、SHA、manifest版本均不改。两包原版本都是3.16.0；旧Core HTTP报告0.0.0-dev，新Core报告3.16.0，仍不冒称跨发行版本升级。

自有测试 Node preload 通过 `NODE_OPTIONS=--require <本轮自有脚本>` 附加到原进程环境，仅当 `realpath(process.argv[1])` 精确等于新SHA目录中的 `runtime/server-core.js` 且本轮marker存在时，记录PID、PPID及原current/事务previous摘要，然后exit73。bootstrap、CLI、旧Core和其他进程均不命中。脚本没有修改环境或凭据，也没有替换下载、Installer、控制RPC、Supervisor或update业务。

这是“原归档/原产品事务 + Node运行时受控候选启动故障”，用于验证真实启动失败与回滚行为；不是发现一个自然损坏的正式发行包。候选在Node预加载阶段失败，不能据此声称覆盖所有Core内部异常、卡死、数据迁移失败或Supervisor被强杀的恢复情形。

## 实际结果

| 阶段                 | 真实证据                                                                                                               |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 初始旧安装           | 原update返回applied，current为旧SHA，Core PID75/HTTP0.0.0-dev                                                          |
| 原update切候选       | 候选Core PID121、PPID31真实启动；preload journal读取当时current为新SHA、update-transaction.previous为旧SHA，随后exit73 |
| 原事务失败           | CLI自然exit1，错误为 `Server Core failed while applying update`                                                        |
| 原回滚恢复           | current逐字回旧JSON，原Supervisor重新启动旧Core PID128；HTTP0.0.0-dev，pending与事务文件已删除                         |
| crash timer稳定性    | 回滚ready后等待1.5秒（覆盖原首次1秒自动重启backoff），旧Core PID保持，候选journal仍仅一次，不被迟到定时器重启坏候选    |
| 删除故障marker后重试 | 原update返回applied，Core PID187实际新包ready/HTTP3.16.0，current新SHA；未手写pending/current或添加force               |
| 幂等与重启           | 再update返回up-to-date、零额外归档下载；原restart产生PID261、HTTP仍3.16.0                                              |
| 收尾                 | 原stop，七个已知PID、六监听端口、control socket全闭；本轮具名容器/卷移除；自有marker与preload脚本删除                  |

v1 八项具名业务检查全部通过，最终状态passed、容器exit0；同入口的Linux无CAP_CHOWN永久提取合同1/1。三个产品状态快照涉及的十个不同安装文件（manifest/CLI/Core/Node/Agent）逐字SHA均与对应未修改的原归档一致，独核共十五次文件比较通过。

## 复现与证据

从后端根目录使用新名字复跑，不会启停VM或注册全局服务：

```sh
python3 scripts/tests/run-server-update.py --rollback --name client-server-update-rollback-new-20261020
```

测试运行在一个1GiB、无外部网络、cap-drop ALL、只读镜像和归档的具名Node容器中。独立挂载的工作目录为本轮所有，不接触主服务、主数据库、用户安装、GUI或外部集成。已关闭资源的私有工作目录/归档与故障journal保留为证据；不是声称整个证据根已删除。

- `evidence/client-server-update-rollback-v1-20261020/result.json`：八项检查、原CLI退出与响应、三个状态快照、候选journal及逐PID/端口收尾。
- 同目录 `controller-result.json`：容器exit0、业务passed、永久提取合同exit0、具名容器/卷不存在。
- 同目录 `independent-files.json`：原归档→安装文件SHA独核，三个具名容器/卷及故障marker/脚本独立核实已不存在。
- 同目录 `ownership-contract.log`：Linux提取永久合同1/1。
- `scripts/tests/server-update-probe.mjs`、`scripts/tests/run-server-update.py`：只增加显式 `--rollback` 测试模式；目标Lint/格式/Python编译检查通过，无产品逻辑变更。

跨发行版本升级、增量组件、运行任务force更新、注册OS服务更新、其他操作系统、正式远端发布以及其他故障类型仍分列未验。外部MCP/网盘仍排除，未访问已受安全策略拒绝的真实企微浏览器页面。
