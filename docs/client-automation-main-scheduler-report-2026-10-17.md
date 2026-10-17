# G05 Production Main 真实定时到期验收结果

本报告按正式产物版本保留独立证据。当前 `a684e407` 复测与历史 `0d958862` 的运行时间、launcher 和哈希不能混用。

## 当前正式版本 a684e407：18:10–18:12 复测

Root 统一构建后，驱动未再构建或修改 out/CLI。使用无前置 await 的 `scripts/fixtures/client-automation-main-launcher.mjs`：静态 builtin/electron imports 后立即动态导入完整 production Main。两个完整 Main 均实际通过 privileged-scheme 注册、Host 数据库准备和 scheduler 自启动，不能以静态类型检查代替该 ready 时序结果。

最终 1 通过、0 失败/跳过，用时 192.461 秒。所有 run 均为真实自然到期的 `schedule`，同一个持久 task、一个 automation，无 manual run、改时钟或写 nextRunAt。

| 北京时间计划到期 | 实际认领     | 实际结果                                                                                          |
| ---------------- | ------------ | ------------------------------------------------------------------------------------------------- |
| 18:10:00         | 18:10:12.071 | 原 task `succeeded`                                                                               |
| 18:11:00         | 18:11:16.131 | 完整 Main 正常退出/重启后恢复原 task，`succeeded`；模型消费原始 conversation 与自动化 marker      |
| 18:12:00         | 18:12:16.133 | 当前 `local=false` 下 `failed`，真实 `/api/client/authorize` HTTP 403，supplier/ledger delta 均 0 |

累计 4 次受控模型调用、4 条 settled。撤权 run 仍为 `dispatch_status=dispatched`，automation 仍 active/enabled、`run_count=3`：真实边界仍是 Host 接受定时输入后，当前准入在模型执行前拒绝，不声明 scheduler 未派发或 automation 被禁用。

| 当前产物            | SHA256                                                             |
| ------------------- | ------------------------------------------------------------------ |
| CLI 源构建与 staged | `a684e40751e1f9bf7e8e7e3710f8518001451ec33d74964e5502a297a1d23d0c` |
| Main                | `9ab3816f44acea49a06105fd6cc77989ca94031c35701b42aabac96b0541cca7` |
| Host                | `dd066c697dd69e519eb835b432d6918c310986bab38b212cf609415c400b78a7` |
| scheduler           | `203fc965e1835618b5fc4b7104ec62c1e1991a37bb0fe10151ba8fb242b77de5` |

准备 Host PID 17042、两个完整 Main PID 17099/19475、绑定任务 CLI PID 19406/21576 均实际退出，其他已观测 Host/scheduler/helper 也无残留。生产 spawn preflight/started 日志与自有进程树交叉核对，实际 argv 为已验证的 staged `zcode.cjs app-server --stdio --surface desktop`。后台三端口关闭、临时目录删除，密钥/令牌输出审计通过。收尾主后端 37266 仍在；当前工作区 HEAD 观测为 `2b41b6d3c5c5daa6ff27527f0531cb89ce6a832c`，本驱动没有提交或改动主后端。

本轮独占输出目录为 `evidence/client-automation-main-scheduler-a684e407-20261017/`，包含 summary、model-and-schedule-proof、runtime-process-proof、实际 HTTP 和三个进程日志。旧版完整证据已另存 `evidence/client-automation-main-scheduler-0d958862-20261017/`，原历史目录也保持原内容。

精确 Node 24.14.0 的后端 tsc、目标脚本/新 mjs launcher ESLint、mjs syntax 与定向格式检查通过。仅输出目录通过 `UWORK_MAIN_SCHEDULER_EVIDENCE_DIRECTORY` 选择仓库 evidence 下的独占路径，生产 tick/TTL 仍使用原值。

## 历史正式版本 0d958862：17:22–17:24

2026-10-17，在独立 HOME、独立 Electron/后台/供应商完成完整 production Main 启动装配、真实到期、原任务恢复、完整 Main 重启后再次到期，以及当前 `assistants.local=false` 拒绝模型执行。最终测试 1 通过、0 失败/跳过，实际用时 153.188 秒。

### 真实链路与结果

初始任务仅通过准备 Host 的公开 `createTask/sendPrompt` 创建。真实 CLI 返回 `CronCreate`，自动绑定其原 conversation，生成每分钟 cron；准备 Host 和 CLI 完全退出后才启动完整 Main。Main 导入字节一致的正式 `out/main/index.js`，由其真实数据库就绪回调启动 scheduler、通过正式窗口 Local Host 路由 CronRun。没有调用 `runAutomationNow`、手动 tick 或写数据库调度字段。

| 北京时间计划到期 | 实际认领     | 实际结果                                                                                                      |
| ---------------- | ------------ | ------------------------------------------------------------------------------------------------------------- |
| 17:22:00         | 17:22:09.854 | `trigger=schedule`、`outcome=succeeded`，原 task                                                              |
| 17:23:00         | 17:23:14.060 | 完整 Main 退出/重启后，仍恢复原 task 成功；模型请求包含原始 conversation 与自动化 marker                      |
| 17:24:00         | 17:24:14.063 | 发布当前 `local=false` 后 `outcome=failed`；真实 `/api/client/authorize` 返回 403，供应商和模型账本增量均为 0 |

始终只有一个 automation 和一个持久任务，三个 run 均为 `schedule`，没有 manual run。模型总调用 4 次（初始 CronCreate 两次、两次定时成功各一次），4 条模型账本全部 settled。

撤权边界需准确：第三次 scheduler 已路由给 Host，Host 接受定时输入后，当前后台 local 准入在模型请求前拒绝。该 run 的 `dispatch_status=dispatched`、`outcome=failed`，automation 仍 active、`run_count=3`。这证明当前权限能阻止模型执行和计费，不证明 scheduler 未派发或 automation 自动禁用。

### 产物与进程证据

production `out/` 只读复制到隔离 app，使 unpackaged Main 的本地环境加载器不会读取原工作区环境文件；Main、Host、scheduler 入口和实际 CLI 的哈希已核对。CLI 符号链接的 realpath 与原 staged 文件严格一致。

| 产物                | SHA256                                                             |
| ------------------- | ------------------------------------------------------------------ |
| CLI 源构建与 staged | `0d9588624db3368787cbbd86c3d27a92b327e1d169614f1b1162f7e61895454c` |
| Main                | `43a1921f76bc33966e32938da524f6cafd88e745f85ee401c067fc390b2af40e` |
| Host                | `3cc8e23cef43ca8a86f1879aaf3647a1365a796aa0e0284fc747c96f5b24bb75` |
| scheduler           | `0b2b19b216f214a2a79ad43ec4558637b6479b45f9740ad186259524545026d1` |

两个 Main PID 为 93335、94539，绑定任务 CLI PID 为 94435、96790。正式 Host spawn preflight 的 argv 指向同一已核对的 staged `zcode.cjs app-server --stdio`；进程树与生产日志互相核对。准备 Host、两个 Main 及所有已观测 Host/scheduler/CLI/helper PID 均实际退出；三个隔离监听端口关闭，隔离目录删除。收尾保留了既有 `ZCode Protocol client is disposed` 的退订 warning，进程/端口/目录清理仍全部完成。

主后端 PID 37266 仍在，HEAD 保持 `e9c3f667ed5751845f3e7d9e3a1adfcd22512fac`。未改 production 源码、未重建 out/CLI、未提交，未读取主 `.env`/主业务库/Vault，未调用真实企微、外部 MCP、网盘或付费模型。

### 失败证据与驱动修正

第一次运行因新增 launcher 在导入 Main 前 await 配置 IO，Electron 已 ready，`@arms/rum-electron` 注册 privileged scheme 失败；当时无 Host/scheduler，也无 schedule run。修正为 CJS 入口立即导入完整 Main，沿现有 Native 启动时序。最初 after hook 重抛已记录的清理错误，导致后续共享夹具清理未执行；按已确认的自有 PID/端口/目录完成强清理，并改为 after 不重复抛出主体已判为失败的清理错误。

第二次已真实到期成功，但观察器只匹配原 staged 路径，未识别 Main 的隔离 app 符号链接路径，断言失败。修正为先严格核对 realpath，再识别该唯一已验证 argv。两次均为新增验收驱动的装配/观察问题，未据此修改生产调度代码，也没有将失败当通过。

### 文件与检查

- 驱动：`scripts/client-automation-main-scheduler-live-smoke.ts`；入口：`scripts/fixtures/client-automation-main-launcher.cjs`。
- spec：`docs/client-automation-main-scheduler-spec-2026-10-17.md`。
- 成功证据：`evidence/client-automation-main-scheduler-20261017/summary.json`、`model-and-schedule-proof.json`、`runtime-process-proof.json`、`automation-main-scheduler-green.json`、两个 Main 日志及准备 Host 日志。
- 失败证据：`evidence/client-automation-main-scheduler-red-launcher-20261017/`、`evidence/client-automation-main-scheduler-red-observer-20261017/`。
- 精确 Node 24.14.0：`tsc -p tsconfig.verify.json`、新增 TS ESLint、定向 Prettier、CJS `node --check` 通过；客户端架构检查 0 violations。

范围限本机 macOS/Electron 与受控 HTTP 供应商；未由此声明跨平台安装、休眠/唤醒、过期 misfire、外部服务或 automation 禁用后的到期行为验收。
