# Mac x64 新候选副实例独立诊断（2026-10-21）

**本次独立诊断通过：新 v11 x64 包的原十秒副实例自然退出 0，主实例保持同一 PID、birth 和 x64 executable 映射。** 没有进行业务 UI、ACK 或七项联动验收。此前同包原三十秒 renderer 前置失败、0/7 的结果保持失败，不能被本报告覆盖。

候选来源是修复提交 `0aeff9adda8b3dd23103cb8dfa6c0cf735d6dbc2` 的正常 builder 产物，新 manifest SHA `85abca6169f16b9933f7ab02c8f1c965e53a97e7ae0283f775abaee76b91d2c0`；CDF、签名、fuse 和旧产物不变。原代码组合变更为拒锁分支 `app.exit(0)`、环境预热仅在持锁后创建；此诊断验证组合候选的实际结果，不分别归因两个变更的贡献。Rosetta-on-ARM 不等于物理 Intel。

冻结 [preparation.json](../data/sandbox-verification/client-native-packaged-macos-clock-x64-startup-v7-20261021/preparation.json) SHA `3fb184b1198618dc5bc0ffcb53494834e70e29aa2ca6a0cc5939d6bde49736a2`，42 个源输入。原 exec `56406` 自然 exit 0，fixture exit 0；[result.json](../evidence/client-native-packaged-macos-clock-x64-startup-v7-20261021/result.json) 为 `passed-secondary-diagnostic-only`，原 `original7Accepted` 与 `original30sRendererAccepted` 都是 false。

最薄派生沿用旧 v6 诊断正文：整个 case 120 秒、工作阶段保留 20 秒收尾、主实例纯诊断目标等待上限 60 秒、原 `openWorkspace` 1c 完整函数和十秒副实例限制不变。仅换新 v11 loader、fresh v7 profile 和两个 fixture 入口路径。未使用 inspector、sample、AX、BH、业务 UI 或模型 prompt，没有追加重试。

实际观测：

- Main `24744`，birth `Wed Oct 21 03:13:46 2026`，前后相同并实际映射新 x64 executable；副实例 `25190`，birth `Wed Oct 21 03:14:01 2026`，存活期间实际读取 kernel x64 映射。
- 诊断目标第 31 次观测于 14.197 秒选中唯一 owned app.asar file target。这是另一次诊断的观测，不能回填上一轮原三十秒验收。
- 原副实例 child 收据：code 0、signal null、timedOut false、primaryStillExists true，原 command 返回 done，观察线程关闭且无 observer error。
- 主实例固定阶段 03:13:52.072 lock start，.110 acquired true，原表达式耗时 19.515042 ms。副实例 03:14:07.728 start，08.098 acquired false，343.549792 ms；08.122 为保留名称的 `secondary-quit-start`。当前产品调用是 `app.exit(0)`，没有返回阶段；退出由原 child handle 证明，缺阶段本身不证明原因或 ACK。
- 整个 case 25.916098 秒。HTTP 入站推理 POST 和 supplier 均 2→2（原他人 seed 2），所有 supplier 请求摘要、当前与另一 actor 的 ledger/Trace/gateway accounting 集合前后相等；当前无计费，他人原两笔 44 credits 保持。配置读取等合法流量不算模型请求。

[原结果中的 secondaryEvents、phases 和前后快照](../evidence/client-native-packaged-macos-clock-x64-startup-v7-20261021/result.json) 是本次范围的依据。原 `done`/exit 0 不是原 UI 工作区消费或 ACK 证明；ARM64 的真实工作区、PTY、发送与原七项通过另见 [双平台 Native 报告](client-macos-secondary-exit-native-test-2026-10-21.md)，不能移作 x64 的 UI 证据。

原 finally cleanup errors 空；[独立只读收口](../evidence/client-native-packaged-macos-clock-x64-startup-v7-20261021/owned-independent-closure.json) 再核 7 个 known PID 不存在、4 个 TCP 端口拒连、42 源摘要保持、原协议关联恢复、clipboard 未使用且保持。未操作正常后台、专用 VM、个人浏览器或外部企微/MCP/网盘。所有 Native/构建资源已释放，没有自行启动下一 case。
