# Mac 拒锁副实例候选 Native 联测（2026-10-21）

同一修复提交 `0aeff9adda8b3dd23103cb8dfa6c0cf735d6dbc2` 的正常新包：**ARM64 原七项全部通过；x64 在原 30 秒 renderer 就绪前置失败，零项业务完成。** 两次均按各自冻结计划只运行一次，原 finally 自然完成，所有自有资源释放。ARM 结果不能覆盖 x64 失败。

产物来源、完整摘要、原 builder 签名、Swift helper 元数据差异及首验失败保留见 [正常打包报告](client-macos-secondary-exit-packaging-test-2026-10-21.md)。未修改新包字节、CDF Agent、签名、fuse、原 fixture 或超时。原 `openWorkspace` 函数 SHA 仍为 `1c013ad74812e1556e287aecefd56dff9a7326ac008aa4cb4aa84248a4c7aae6`，原参数、环境、cwd、stdio ignore 和十秒期限保持。新 AX 诊断仅属 x64：有界、精确 Main PID/birth/executable，只允许原架构提示“暂不处理 / Not now”，不能下载或绕过外部工作区确认。本次 x64 未到该调用。

## ARM64：实际七项通过

- 冻结计划 [preparation.json](../data/sandbox-verification/client-native-packaged-macos-clock-arm64-secondary-exit-v1-20261021/preparation.json)，SHA `539f0f8a9467397f92d6046eaee05b1fdbe454eff8b6fa66463ce9d6e4842371`，28 个 fixture/driver 源输入。
- 原 exec `94776` 自然 exit 0；原 fixture exit 0。最终 [result.json](../evidence/client-native-packaged-macos-clock-arm64-secondary-exit-v1-20261021/result.json) 为 passed、7 checks、cleanup errors 空。

七项为原正常包 renderer；原 onboarding 身份/模型/明确工作区；文件树、原内容预览及 renderer reload；真实 xterm shell 文件、cwd、TTY 与面板保持；原包 CLI→后台→受控 supplier→本人账本；撤销席位后原发送零调用/账务增量；原退出身份与同 controller/profile 冷启动不复活企业身份。

原 Main `22333` 的副实例 `22454` **自然 code 0、signal null、timedOut false**，原 Main 仍存活。该真实子进程退出收据与原 UI `workspace=packaged-workspace`、文件预览及后续实际执行 cwd 共同证明转发，未用退出 0 代替工作区验收。

原私有文件固定阶段：Main 03:07:23.440 lock start，.441 acquired true、原请求表达式耗时 1.159625 ms；secondary 03:07:25.035 start，.042 acquired false、6.937958 ms，同刻记录 quit-start。改用原 `app.exit(0)` 后没有 quit-return 行；不从缺行推测未执行，实际 exit 0 由原 child handle 证明。日志阶段名称保留为兼容的 `secondary-quit-start`，不将其说成调用了 `app.quit`。原日志实际 0644，不宣称为 0600。

真实 shell `22664` 的 cwd 为本 case `packaged-workspace`，TTY `/dev/ttys001`，live kernel descriptors 一致。原包 CLI `22476`/`22514` 的 spawn 与 executable 映射匹配，后者的实际 cwd 为该项目；实际 supplier 主请求工作目录也为该项目，并验证真实加载 ARM64 node-pty addon。未因此声称本轮又覆盖了额外 resize 矩阵。

真实 supplier 总计 4（含他人 seed 2）；当前 actor 新增 2 笔 settled、44 credits、24 input/20 output tokens，另一 actor 原 2 笔/44 credits 保持。当前身份实际为 operator，不把旧检查名称中的 member 当作角色事实。原模型前置为受控 500000 contextWindow，不外推 128000 模型适配。席位拒绝与 logout/cold 的零增量和身份清除按原断言通过；此冷启动是退出身份之后，不能代替另一份仍登录 same-task 冷恢复报告。

证据：[原副实例事件](../evidence/client-native-packaged-macos-clock-arm64-secondary-exit-v1-20261021/workspace-secondary-events.json)、[原固定阶段](../evidence/client-native-packaged-macos-clock-arm64-secondary-exit-v1-20261021/single-instance-startup-phases.json)、[实际 Native/CLI/addon 映射](../evidence/client-native-packaged-macos-clock-arm64-secondary-exit-v1-20261021/x64-runtime-facts.json)（文件名沿旧基础，实际 target 为 ARM64）。

## x64：原三十秒门失败，仍待解决

- 冻结计划 [preparation.json](../data/sandbox-verification/client-native-packaged-macos-clock-x64-secondary-exit-v1-20261021/preparation.json)，SHA `a722c727784ec6300cfc700615fb6107695a790d2974026004d9ec36df34ae4a`，32 源输入。
- 原 exec `46147` 自然 exit 1，fixture exit 0。[result.json](../evidence/client-native-packaged-macos-clock-x64-secondary-exit-v1-20261021/result.json) 为 failed、0 checks，`Original owned file renderer not ready within 30s budget`。

原 Main `21196` 实际映射新 v11 x64 executable；ready 守卫记录 95 次尝试。未进行 BH attach、架构提示 AXPress、副实例或任何业务 UI；不能推断拒锁退出修复在 x64 已通过，也不能用旧 CPU 诊断或 ARM 结果给本次失败归因。没有将六十秒诊断门或 inspector/sample 纳入本次原七项验收；没有延时或重试。Rosetta-on-ARM 不等于物理 Intel。

## 收口

两次独立只读复核均在原 finally 后完成：

- ARM：[owned-independent-closure.json](../evidence/client-native-packaged-macos-clock-arm64-secondary-exit-v1-20261021/owned-independent-closure.json)：19 known PIDs 与 2 个额外 BH daemon PIDs 均不存在，4 个 TCP 与两个 private UNIX socket 均拒连，28 源摘要保持，原协议关联已恢复、clipboard 未使用且保持。
- x64：[owned-independent-closure.json](../evidence/client-native-packaged-macos-clock-x64-secondary-exit-v1-20261021/owned-independent-closure.json)：6 known PIDs 不存在，4 个 TCP 拒连，32 源摘要保持，原协议关联和 clipboard 恢复。未启动 BH。

没有操作正常后台 PID 92288，没有启动专用 VM、外部 MCP、网盘或被拒的真实 WeCom/SSO 页面。没有自动追加下一 case。

ARM 独立验收补充：[backend-linkage-independent-verdict.json](../evidence/client-native-packaged-macos-clock-arm64-secondary-exit-v1-20261021/backend-linkage-independent-verdict.json) 的 29 项均通过；该审计以实际 request key 关联四笔 accepted gateway calls 与 ledger，Trace 只按真实字段集合核验，另一 actor 只使用本轮已存在的聚合基线，未冒称逐行字节等值。x64 原三十秒失败仍单独保留。
