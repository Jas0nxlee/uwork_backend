# SQLite 启动时钟回拨缺陷：修复与原发行包复测

已修复一项真实启动缺陷：进程内墙钟回拨会把启动耗时变为负数，被原严格控制帧schema拒绝，表现为`SQLite startup failed: sql_failed`。原子提交`1db59c77`只含runner、两份永久回归、可版本化测试配置与规格。正常重建的新Agent及Server原包已通过真实回拨启动和状态保持复测；v10产品RED和v9历史GREEN分别保留。

## 实际失败与修复边界

`client-server-update-stateful-v10-20261020`在旧Agent种状态阶段失败，尚未执行业务更新。自有CLI日志的原始错误是ZodError，字段`elapsedMs`违反非负约束；同一attempt中checking日志时间10:52:56.213Z后出现failed时间10:52:56.112Z。没有保留下发前的具体负elapsed值，不能伪造它；这组日志与确定性永久RED共同证明时间计量问题，不是SQL引擎语句失败。

原`migration-runner`用Date.now同时计算elapsed和BUSY等待deadline。修复在同一原owner内使用node:perf_hooks的performance.now，elapsed按原毫秒显示取整并保持非负，BUSY共享deadline使用同一单调基准。**没有修改elapsed有限/非负schema，没有捕获并忽略Zod，也没有掩盖SQL错误**。

SQLite仍唯一协调事务，SQL、checksum、回滚、同步5秒/异步1小时锁预算、25ms native busy_timeout、退避及finally恢复5秒全部保持。这个预算仅约束BUSY重试，不是任意长SQL或卡住回调的总执行硬超时。迁移账本`time_applied=Date.now()`保留epoch语义，其他跨进程租约/启动快照时间不改。

## 永久RED与GREEN

规格见[SQLite本地单调计时](../clients/uwork/specs/sqlite-startup-monotonic-clock.md)。永久矩阵的旧源码为3 RED/1 PASS，新源码4/4，两个peer用独立Node进程/新临时库另行取得同样RED/GREEN，无skip：

| 场景                                                                                        | 原源码                                      | 修复后                                                                                |
| ------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------- |
| 真实openProtocolStartupStorage→原strict schema→Writable JSONL→实际SQL提交，Date.now连续回拨 | elapsedMs too_small，实际Zod调用栈与v10一致 | ready、非负控制帧、真实journal提交数一致，time_applied仍epoch                         |
| 真实SQLite writer持续持锁，80ms预算下有限500ms墙钟回拨                                      | 实际约630–634ms才timeout                    | 最终矩阵约126ms，原lock_timeout及SQLite cause保留                                     |
| 真实writer120ms后释放、800ms预算，墙钟前跳60秒                                              | 约47–52ms提前lock_timeout                   | 实际约202ms等待释放后ready                                                            |
| 真实迁移SQL缺字段失败                                                                       | 原本PASS                                    | 继续保留sql_failed、migration ID、SQLite errcode1、实际rollback及busy_timeout5000恢复 |

测试使用有限墙钟变化，不会在旧实现冻结Date.now造成无界等待。BUSY测试走实际async SQLite与可调度timer，不拿同线程Atomics.wait阻塞释放来伪造结果。

可版本化测试项目为`apps/zcode-cli/tsconfig.storage-startup-clock-test.json`，public adapters storage映射源码，避免误测旧dist。初名包含`.sqlite`而被根`*.sqlite*`规则误忽略，已只重命名，不改.gitignore。最终新配置路径矩阵/strict tsc/格式/架构/diff全部通过。

root typecheck/Lint通过（113既有warning、0error），CLI typecheck27任务/Lint14任务通过。CLI最初因干净PATH未含已有root `.bin/turbo`失败；补入已存在工具路径后原命令成功，无新增依赖或降低门禁。

## 正常产物

HEAD `1db59c7750a60d2836a143d3726daaae434df937`后执行原正常Agent构建、原Server build与Linux ARM64 stage，三命令均exit0。没有用skip模式重用旧Agent，也没有手改归档。

- 新Agent `clients/uwork/apps/zcode-cli/packages/cli/dist/zcode.cjs`：16,579,914 bytes，SHA256 `cdf781ecf004b9639157fae25e6e96e558b95faefaee7aab09488d5dc650ecac`。
- 新原Server Linux ARM64归档：78,181,268 bytes，SHA256 `7774c7dbebd534032f83020fb45c7a392ab03ff2b132535b10c001a592ba3958`，版本仍3.16.0。原归档内Agent与正常源bundle逐SHA一致，CLI/Core/Node/manifest另有清单。
- 旧Agent `6cd2e95…`与原Server `04bc1eae…`已逐SHA冻结保存；所有既往AppImage/deb/rpm/pacman结果仍引用其真实旧载荷，不迁移成新Agent全量已测。

普通Agent脚本仅刷新宿主bundled-agents目录；Root另由原Linux stage helper与正常Desktop流程验证新Agent，未与本分支并行修改Desktop out。

## 真实原Server回拨启动与状态保持

`client-server-update-stateful-clock-v11-20261020`最终**7项passed / container exit0**。真实旧Core75/Agent102 → 新Core149/Agent176 → 原restart后Core219/Agent247。

自有Node preload只在实际新release的Agent入口且SHA等cdf781ec时临时替换该进程Date.now为连续回拨函数。CLI/Core/旧Agent/宿主与VM时钟不变；原stdout仅观察控制帧，不修改字节。原ready帧出现后立即恢复Date.now。产品若过滤NODE_OPTIONS会因没有journal而判失败，未绕过产品过滤或Electron fuse。

两个实际新Agent PID176/247均记录了回拨安装、原checking/committing/ready控制帧、非负elapsed以及ready时恢复。新runner不再取墙钟计算elapsed/deadline，因此该阶段Date.now调用只有fixture的两次回拨探针；这正是移除错误时钟依赖，不冒称新进程又执行了全部待迁移SQL。完整新库迁移与epoch ledger另由上述真实永久集成测试覆盖。

同组原SDK测试还验证：三阶段同一导入sessionID、Task/Session标题、edit/model/reasoning none、两条测试历史全部字段和正文、工作区`.zcodeignore`及设置保持。原Task.resumeTask只恢复原ID，不创建替代会话，不补写mode/model；旧WS在原update中自然1001/Server shutting down/wasClean，更新/restart/stop三个WS均自然关闭；旧代理即时disposed，不是观察超时。

原HTTP结构化收据为旧Core200/0.0.0-dev，新Core及restart后200/3.16.0；runningTaskCount=0、没有force、实际chat请求0。8个已知PID、5个容器内监听端口/control socket关闭，业务/提取容器与bootstrap卷均经明确No such对象独核不存在。输入、归档和0700自有工作证据保留，没有声称整个根已删除。

## 证据入口与剩余边界

- `evidence/client-server-update-stateful-v10-20261020/storage-startup-failure.json`：真实控制帧Zod错误及回拨时序。
- `evidence/client-sqlite-clock-{red,green,final-matrix}-20261020.log`、`client-sqlite-clock-final-gates-20261020.json`：永久红绿及最终门禁。
- 两peer的`client-sqlite-startup-clock-peer-*`、`client-migration-busy-independent-*`日志：独立实跑及审阅。
- `evidence/client-sqlite-clock-{new-agent,normal-server-provenance,normal-build-results,build-preservation}-20261020.json`：正常新产物/旧产物冻结。
- `evidence/client-server-update-stateful-clock-v11-20261020/{result,controller-result,independent-verdict}.json`：7项原生进程/原SDK业务、真实进程回拨journal、17项独核。

本次不声称普通Prompt首发、忙任务/force更新、跨发行版本、OS注册服务、UI自动重连或三平台全部通过。Native/Desktop新载荷由Root独立结果证明；未据旧包格式检查冒称新Agent四格式全部重测。真实企微授权浏览器安全拒绝仍保持，外部MCP和网盘继续排除，整体目标仍未完成。

## Root 最新原Native包复测

正常Linux prepare:agent-bundle、Desktop build:no-runtime-assets、原dir和AppImage单target均exit0。Root在正在运行的原提取目录独立读取并核对CLI SHA `cdf781ecf004b9639157fae25e6e96e558b95faefaee7aab09488d5dc650ecac` 与asar SHA `3658e4731d2f23977b0bf0ecdf0a7378fa05d0bab531b12100904353b850fd4e`，均与正常producer输入一致；五份源码SHA仍匹配冻结构建manifest。原AppImage SHA `629fc093e5018cc50c120f0f046c3426d29c673388014ed8c32dab1d4358e7a1` 与实际consumer镜像和runner回读一致。

`evidence/client-linux-desktop-appimage-clock-v17-20261020/result.json` 11项/21原动作通过，44.96秒：Renderer/Main/Host/CLI实际启动、文件预览/重载、真实PTY与文件副作用、隐藏重开保活、本人两调用/两笔44Credit及模型cwd=/work/project、撤席位再发零增量。原Main55在确认25.023秒并行URI后仍唯一，取消留project，确认才切中文空格目录。原shutdown与最终proof一致，容器exit0，容器/网络/卷/隧道均闭。独立live payload记录在同目录independent-live-payload.json。

本组使用新cdf Agent，普通运行未修改OS/进程时钟；受控新Agent回拨启动已由Server v11另行证明。旧6cd/4f716下的Read、Gateway、sandbox及旧四格式仍保留原SHA，不改写为新包全量重跑。当前修复包只正常补产/运行AppImage；其他格式的旧验证不等于已重新签发cdf全格式。整体目标仍active，真实企微受阻OAuth/其他平台/剩余能力继续分列。
