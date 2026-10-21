# macOS ARM64 原 Native Memory off/on/off 验收

2026-10-21。正常签名 ARM64 v13 原包在 fresh Memory v2 case 中 **8 项通过、33.263 秒**：原七项及新增 Memory 三阶段切片均完成，fixture 退出 0、清理错误为空。原 30 秒 renderer 与 10 秒 secondary 门槛保留；本次未修改产品、安装包或签名，也未触及用户／Codex 既有 Memory。

冻结 plan SHA 为 `21e1fbbf43586174b412bd506917437fc1aacabf22176ee169e9a78f21032e94`。实际执行后 89 项来源、33 项生产来源仍逐 SHA 匹配；原包 9 项 runtime 资源、12 项 ARM64 native 文件、严格签名、原 fuse wire 以及最终 ASAR header／Info 声明均复核通过。

| 原 UI 阶段       | 原始主／标题请求索引（从 0 起） | 主请求连续 Memory 片段 | 本人累计 settled／Credit | supplier／原始推理 POST 累计 |
| ---------------- | ------------------------------- | ---------------------- | ------------------------ | ---------------------------- |
| 暖基线           | 2／3                            | 文件尚未创建           | 2／44                    | 4                            |
| 明确关闭 off-one | 4／5                            | 0                      | 4／88                    | 6                            |
| 开启 on          | 6／7                            | 1                      | 6／132                   | 8                            |
| 再次关闭 off-two | 8／9                            | 0                      | 8／176                   | 10                           |

文件由原 xterm shell 在当前私有 case 的真实 project-memory 目录中独占创建。`MEMORY.md` 为 **34 字节**，SHA256 `3b7960cf2cdb97a9d8d097fcb4c3ca71f19a45eea0a86be98b3343b5ab063637`，三阶段均未变化。开启态原 Settings→Memory 刷新后显示当前 `packaged-workspace` scope、唯一 `MEMORY.md` 和“1 条记忆”；这是目录／文件名列表，**未声称原 UI 提供正文预览，也未点击外部编辑器**。

原始 supplier 接收的完整解析请求保存在 [final-experience-proof.json](../evidence/client-native-packaged-macos-clock-arm64-memory-v2-20261021/final-experience-proof.json) 与 [desktop-traffic.json](../evidence/client-native-packaged-macos-clock-arm64-memory-v2-20261021/desktop-traffic.json) 的 `modelRequests` 中，两数组的 10 条请求完全相同。独立审查直接扫描原始正文并重算请求摘要：index 6 主请求的 user context 中恰有一次原 `Contents of .../MEMORY.md` heading、空行及完整文件字节的连续片段；index 4／8 主请求均无该 heading 或正文。index 5／7／9 则各为原 997 字节 system prompt 的独立标题请求，均无 Memory 正文，不能拿标题作注入见证。三组主请求均保留原 32 tools、相同受控 model 和精确 cwd。

三个新 UI task/session 各不相同。只读 tasks-index 与实际 CLI SQLite 的 workspace path／空 identity 相符；原 `runtime_config.completed` JSONL 事件将 session、model、cwd、同一私有 memory root 与 `memoryEnabled=false→true→false` 绑定，`memoryUse`、`memoryExtractionEnabled` 始终为 true。原 CLI PID 65597 的执行时映射／DB FD 绑定收据在各阶段取证前后保持同代；进程清理后的复核没有冒称重新观察到该 PID 的实时映射。

阶段取证时每个新 session 都有原 user／assistant 两条持久化消息，user label 为单词提示。最后 off-two session 的最终库另有两条晚于 Memory 取证时间的消息，来自保留的撤席输入及错误 assistant；不能把阶段两行写成最终库仍只有两行。原撤席拒绝、注销及同 profile 冷启动无身份／模型候选复活均通过，未产生额外 supplier 请求或费用。

本人最终 **8 settled／176 Credit／96 input／80 output Token**，他人 seed 保持 **2 settled／44 Credit／24 input／20 output Token**。各阶段既有本人行与他人完整行保持不变，每阶段仅新增两笔／44 Credit；只读最终后台 SQLite 的完整 ledger、Trace、gateway-call 业务行与最后阶段快照逐值一致，10 条 supplier 请求均为 200。ledger 与 gateway call 使用真实请求键摘要核对；Trace 只按原 actor／model／application／token 字段核对，未捏造其不存在的请求键外键。

本次接受 Memory 开关对新任务上下文的实际影响、原目录读取及无额外提取请求。收据中的 `originalSchedulerWouldExecute=0` 来自**使用真实持久化消息运行新建的原 scheduler 纯 oracle**；它不等于读取运行中 scheduler 的内部 cursor。本次未执行提取子代理，未验自动学习写回，也不代表全部 Memory 功能验收。

Root 与另一独立 peer 确认 19 个已知进程及另记的两个 BH daemon 均已结束、四个 TCP 监听关闭、两个私有 UNIX socket 拒绝连接；原 OS 协议恢复，未使用系统剪贴板。私有测试证据根保留。

历史 v1 **FAILED、仅暖基线 5 项、15.558 秒**原样保留：原 xterm 创建合成文件后，实际派生 namespace 缺 `hashlib` 而失败，尚未进入 Settings→Memory 或三个新任务。这是测试设施错误，不能写成产品 Memory 失败。fixture 退出 0、清理错误为空，13 个已知 PID 加 1 个 BH daemon（共 14）及四端口已关闭、OS 已恢复。v2 仅在实际派生 Python 补标准库导入，并以 actual AST 片段／共享 namespace 的 RED→GREEN 和递归全局依赖合同补足原审查遗漏；没有降低原业务断言。

证据：[v2 原结果](../evidence/client-native-packaged-macos-clock-arm64-memory-v2-20261021/result.json)、[Root 独核](../evidence/client-native-packaged-macos-clock-arm64-memory-v2-20261021/root-verdict.json)、[原文／CLI／账务 peer 独核](../evidence/client-native-packaged-macos-clock-arm64-memory-v2-20261021/peer-raw-memory-independent-verdict.json)、[另一 peer 独核](../evidence/client-native-packaged-macos-clock-arm64-memory-v2-20261021/linux-sandbox-independent-verdict.json)、[v1 原失败](../evidence/client-native-packaged-macos-clock-arm64-memory-v1-20261021/result.json)、[v1 独立失败复核](../evidence/client-macos-native-memory-preparation-20261021/peer-v1-namespace-failure-verdict.json)。
