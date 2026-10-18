# Native 测试驱动的 Enter 与等待上限

2026-10-18。共享 `scripts/client-native-scenes-fixed-ui.py` 的普通 Enter 现在只在 keyDown 补回车文本，keyUp、组合键及其他键保留原协议。独立同版本 Electron 的原协议只产生 keydown/keyup，没有 keypress 或默认表单提交；补文本及真实 Submit 点击两个对照均提交一次。这是测试驱动修复，原 Native 地址栏未导航的唯一根因仍未确认。

永久入口 `scripts/tests/native-key-enter/run.mjs` 通过 AST 抽取实际共享 key 函数，运行三个本地真实表单：实际 helper、独立回车文本对照及真实 Submit 点击。没有加载 UWork Main/Host/CLI、后台、模型或身份凭据。纯协议四项先失败再全部通过；修复后两轮各一次 Electron 41.10.7 / Chrome 146.0.7680.216 的三个场景均提交一次，两个 Enter 场景均出现 trusted keypress，没有溢出。

独立审查还发现永久 runner 对 BH 结束没有等待上限。已增加单次九十秒 deadline，正常结束和超时均清理计时器，超时进入原有资源清理；没有重试或放宽断言。实际正常完成、二十毫秒超时两项定向回归通过，最终有界 runner 的一次三表单复测通过。

每轮使用全新私有目录和显式 Electron/CDP/BH，资源均已收口；最终轮 BH 与 Electron 正常退出，含 runner 七个已知 PID 均不存在，端口 63417 拒绝连接、Unix socket 已闭、临时目录写 FD 为零后删除。主后台和保留的 Native 根未参与。

原始探针、修复、复测及等待上限证据分别位于：

- `evidence/client-native-address-enter-probe-20261018/`：原协议及两个真实对照。
- `evidence/client-native-address-enter-fix-20261018/`：纯协议 RED/GREEN 和共享 helper 修复。
- `evidence/client-native-address-enter-followup-20261018/`：修后首次三表单通过。
- `evidence/client-native-address-enter-bounded-preparation-20261018/`：等待上限的实际 RED/GREEN。
- `evidence/client-native-address-enter-bounded-20261018/`：最终有界入口三表单通过。

历史证据保持原样。README 后续仅将机器专用示例改为显式工具变量和未使用的证据目录。真实 UWork 授权后阅读、退出及地址栏导航仍需各自运行验收。
