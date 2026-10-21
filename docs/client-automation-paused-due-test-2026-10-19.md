# 自动化暂停后跨真实到期及恢复（2026-10-19）

G05e 指定的 Host／完整 Main 联动切片通过。原生产 Host 通过 `setAutomationEnabled` 暂停自动化，同一完整 Main 和 scheduler 跨过原 due 后 45.318 秒，实际派发、模型调用和账本均零增量；恢复后，原 scheduler 自动消费同一个 due，在原 task 中完成一次成功运行。未调用 run-now、手动 tick、改时钟或改写 nextRunAt。

这不是原 Native 暂停／恢复按钮验收。使用真实客户端 Host、MessagePort、CLI、完整 Main、后台 HTTP 和内部账本，但身份与 supplier 均为受控本地夹具；不代表真实企微或供应商账单。未测试外部 MCP、网盘、休眠唤醒、超过五分钟 misfire 或发行安装包。

## 实际结果

| 检查             | 观察                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 原调用创建并绑定 | 1 automation、1 task，原模型返回 CronCreate，暂停前 0 run                                                                 |
| 完整 Main 就绪   | Main 73697、scheduler 73933，早于原 due 48.214 秒                                                                         |
| 暂停窗口         | 原 due 后 45.318 秒，256 次有限存活采样；原 PID、birth、PPID、cwd 均保持                                                  |
| 暂停后的状态     | disabled／paused、due 不变、0 run、0 实际派发；supplier／settled ledger 保持 2／2，账本集合 SHA 不变                      |
| 原 Host 恢复     | 仅恢复 enabled，保持同一 Main／scheduler，不重设 due                                                                      |
| 自然到期恢复     | 1 schedule run、succeeded、scheduledAt 等于原 due、仍绑定原 task；实际派发 1 次，supplier／settled ledger 变为 3／3       |
| 上下文           | 原 conversation 与 scheduled marker 均在实际模型请求中观察到                                                              |
| 收口             | prepare-host、resume-host、完整 Main 原句柄均 exit0／signal null；Root 仅精确 SIGKILL 保持等待的 Common，原工具实际 exit1 |

暂停窗口没有独立记录每一个空 tick；同 scheduler 的完整存活校验、零派发及恢复后的正向消费共同构成该切片证据，不把“进程存在”单独当作调度通过。

11 个公开文件的 SHA 已由 Root 独核，20 个已知 PID 严格不存在、三个已知端口拒连。私有根保留，handoff 后未再读取或 stat；不声称零 FD 或穷尽未知后代。

## 原失败与修正

- v3 在 admission 以实际 exit70 停止，未创建运行根或调用模型。环境文件 guard 误拦了冻结源码清单内的 `.env.development` 哈希读取。随后将有限 Source／正常产物 proof 放到独立、固定路径和 SHA 的 Python `-I -S` helper；运行时 guard 不放宽。它只在 RAM 对清单内四份环境模板作 opaque hash，不读取清单外真实 `.env`、解析配置或输出文件正文。
- v4 admission 通过，但 Host ready 超时、原停止未确认，accepted=false。Root 精确收口 Host 和 Common，并独核三个已知 PID／端口关闭。测试 Host 被错误改成 ESM 静态入口，而既有通过脚本使用 CJS 非 await 动态入口；v5 恢复原入口后完整链路通过。该修正与 [Electron 的 ESM／ready 时序说明](https://www.electronjs.org/docs/latest/tutorial/esm)一致，不将其他环境因素未经验证排除。
- v5 保留生产 Host、Main、调度、权限、API、原 due 和业务判定；仅恢复测试入口及更新运行命名。此前准备中的 ready 必须早于 due、原 scheduler PID 固定、异常退出不得接受和首错无泄漏合同均保留。

准备层的旧 11 项、后续 proof／guard 3 项、首错 1 项和入口生成 1 项按各自来源记录，未冒称全部重跑。Python 有限 proof 实际核验 7,339 份冻结客户端来源及六个正常树的 12,789 个文件；未修改客户端产品或正常产物。480 秒只约束业务／观测接受，初始化和收口不被冒称硬取消；Root 持有原工具并维护外层时限。

## 收据

- [真实 v5 封存](../evidence/client-automation-paused-due-v5-20261019/manifest.json)，SHA `e7d73964798961784d55510b6e709ab5ef6eff785c148402eb7c74e4a7b2ce98`。
- [暂停后原状态](../evidence/client-automation-paused-due-v5-20261019/paused-after-natural-due.json)、[原 due 成功执行](../evidence/client-automation-paused-due-v5-20261019/resumed-original-due-success.json)。
- [Root 独立验收与收口](../evidence/client-post-g04j-boundary-audit-20261019/g05-v5-root-independent-acceptance.json)。
- [v3 admission 失败](../evidence/client-post-g04j-boundary-audit-20261019/g05-v3-admission-outcome.json)、[guard 复现](../evidence/client-post-g04j-boundary-audit-20261019/g05-v3-admission-guard-reproduction.json)、[v4 实际失败与收口](../evidence/client-post-g04j-boundary-audit-20261019/g05-v4-root-closure.json)。

正常主后台保持独立运行，见[本次恢复记录](local-backend-recovery-2026-10-19.md)。G04k 的 B 重新认证、G07e 系统选择器及其他 Native 输入切片仍开放，不能因本项通过关闭整体 U02–U05／T13。
