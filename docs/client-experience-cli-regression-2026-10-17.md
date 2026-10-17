# 新版客户端配置合同的正式 CLI 回归

2026-10-17。正式 CLI 构建和 Desktop stage 的 SHA-256 均为 `39175fd59577db9c2e80519170ab33e96e622f22c8cb86f18bf3241e2507d43c`，大小 16,570,919 bytes。本轮只执行既有实际 CLI 测试，没有修改产品源码、构建产物、运行中的 Main、主 `.env`、数据库或 Vault。

## 实际结果

| 分组                         | 唯一检查 | 后端实际 HTTP |    受控 supplier | 账本                     |
| ---------------------------- | -------: | ------------: | ---------------: | ------------------------ |
| Subagent / expert / personal |      9/9 |          1011 |               57 | 57 settled               |
| Workflow                     |    10/10 |          1737 |               53 | 53 settled               |
| 私有 stdio relay             |      5/5 |           199 |                7 | 5 settled、2 uncertain   |
| Skills stdio 合同            |      1/1 |            57 | 无模型 HTTP 请求 | 原测试未导出，不虚构计数 |

共 25 个唯一命名检查通过。前三组 24 个模型 fixture 的 117 次受控供应商调用对应 117 条账本，115 settled、2 uncertain；两条 uncertain 来自原有取消场景，按真实结果保留。Skills 合同的 57 条 HTTP 由只记录路径、状态和生命周期的观测器单列，模型请求为零。同一后端 HTTP 层合计 3004，未与 HTTPS 代理或供应商层相加。

Workflow 的十项分别验证保存与当前拒绝合同，以及既有 V4 直接运行、actor Skill 当前版本/撤权、身份 fence、文件准入和同一 run 的冷恢复。该结果不表示 packaged dynamicWorkflow 已新增产品启用来源，也不代替 Native 工作流或定时 scheduler 验收。

## 隔离与证据

每组使用独立 evidence CWD，通过只读用途的 `clients/uwork` symlink 读取本仓正式客户端；测试脚本以原始绝对路径运行。Node 固定为 24.14.0，父进程环境采用显式白名单，HOME/TMP 均为自有目录，无继承凭据、代理、`NODE_OPTIONS` 或 TLS 校验绕过。每轮前后核对 source/staged CLI SHA 和 46 文件 source freeze。历史 755 证据没有覆盖，历史汇总 SHA 保持不变。

实际验收轮的 36 个 CLI 进程均已退出，76 个服务绑定均已关闭并主动核对 TCP 拒绝；25 个 fixture 根由原测试清理，runner profile/TMP 另行清理。最终清理同时覆盖两个准备轮：共 49 个已观测 CLI 进程和 107 个服务绑定全部退出/关闭。只检查本轮观察到的 PID 和端口，没有发送进程信号或操作其他 Main/Host。

两个准备问题保留原始证据并排除在最终计数之外：第一次九项均通过，但总控把独占 TMP 内的 tsx loader 缓存误判为 fixture 残留；修正分类后重跑该组。Skills 首次使用过长 TMP 路径，触发 Darwin Unix socket `listen EINVAL`；保留失败轮，仅将该项改用独占短 TMP 后重跑通过。未修改测试断言或产品来取得通过。

完整证据位于 `evidence/client-experience-cli-regression-20261017/current-39175fd-2026-10-17T14-29-19-154Z/`：`summary.json`、逐轮 `summary.json`、`test.tap.log`、`env-guard.json`、原 fixture HTTP/model/ledger/通知证明以及 `outer-cleanup.json`。观测器不改写网络请求或回复，不读取正文、请求头或环境值。

## 复现与验收边界

以独立 CWD、同版 source/staged CLI 和固定 Node，执行以下原脚本；证据目录相对 CWD 生成，不能直接在历史 evidence 所在 CWD 重跑覆盖文件：

```sh
node --import tsx --test scripts/client-subagent-relay-smoke.ts scripts/client-expert-resume-live-smoke.ts scripts/client-personal-ports-live-smoke.ts
node --import tsx --test scripts/client-workflow-assets-live-smoke.ts scripts/client-workflow-dynamic-live-smoke.ts
node --import tsx --test scripts/client-native-session-relay-smoke.ts
node --import tsx --test scripts/client-skills-stdio-contract-smoke.ts
```

实际使用的绝对命令、CWD 和环境隔离记录在逐轮 summary。旧 fixture 对新增 runtime-preferences scope 保留既有 `-32601` 兼容响应，因此本轮是既有 CLI/企业权限回归，不证明新的发布配置、窗口 Help/trace 或逐 turn context 已在 Native 生效。Native、新配置全链路和同版 Desktop 构建由独立验收负责。没有使用付费模型、真实企微、外部 MCP、网盘或被拒远端探针。

本轮可提交文件仅此报告；所执行的七个测试入口和共享 fixture 均未修改。临时总控、观测器及原始 evidence 保持 ignored，不作为产品源码提交。
