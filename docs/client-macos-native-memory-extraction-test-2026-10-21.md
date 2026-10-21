# macOS ARM64 原 Native 自动 Memory 提取验收

本次自动提取正例通过 **8/8**，耗时 **26.312658 秒**，fixture 退出码 0，cleanup errors=[]。使用正常重建的 ARM v15、产品提交 `500914dfe27f96d9db74381c6828244390413281`，以及冻结 Auto v2 plan `9b2513895ecd95ef625bd83e678f9edced03d832d08c749166fe21c59d1059d7`（450 源）。未更换产品代码或包来制造本次结果；此记录仅覆盖 macOS ARM64 的受控本机链路，不代表发布或其它平台验收。

[原实际结果](../evidence/client-native-packaged-macos-clock-arm64-memory-extract-v2-20261021/result.json)、[Root 独立收据](../evidence/client-native-packaged-macos-clock-arm64-memory-extract-v2-20261021/root-auto-green-verdict.json)、[独立实际复核收据](../evidence/client-native-packaged-macos-clock-arm64-memory-extract-v2-20261021/peer-actual-verdict.json)及[只读复核脚本](../evidence/client-native-packaged-macos-clock-arm64-memory-extract-v2-20261021/peer-actual-readonly-check.py)保留。本次复核没有启动 App、发送模型请求、修改冻结源、plan 或 manifest。

受控租户沿原 Admin GET→完整 PUT→publish→GET 开启 filesystem，原 Settings Memory 开关经 UI 与持久设置确认开启。HTTP 状态轨迹、阶段 readback 和最终只读数据库一致：security version=1/revision=2、published allowFilesystem=true、无 enabled policy override。没有另外保留独立的完整 security GET 响应正文，因此不把 helper 布尔值写成该响应全文的独立复核。

独立读取 [final-experience-proof.json](../evidence/client-native-packaged-macos-clock-arm64-memory-extract-v2-20261021/final-experience-proof.json) 与 [desktop-traffic.json](../evidence/client-native-packaged-macos-clock-arm64-memory-extract-v2-20261021/desktop-traffic.json) 中完整的 `modelRequests`，两份 10 条逐项相等，分类如下。索引为保留数组的零起始下标，不依赖标题推断主请求。

| 实际 raw 索引 | 请求事实 |
| --- | --- |
| 0、1 | 另一成员的原 seed 请求，各自正常结算 |
| 2、3 | 原 warm 主请求与原 997 字节标题请求 |
| 4、5 | A 原主请求及独立标题；A durable prompt 为 5 词，明确包含自有测试偏好 |
| 6、7 | 两次非流式 extraction sidecar，末 user 内容等于原提取 prompt，携相同完整 32 工具目录 |
| 8、9 | 新 session B 原主请求及标题；B durable prompt 仅一个词 |

raw 7 保留了原模型实际收到的前一轮 assistant 三次标准 `Write` 调用及同 ID 的三条 tool results：`native-auto-memory-index-20261021`、`native-auto-memory-topic-20261021`、`native-auto-memory-denied-20261021`。前两项分别创建新 `MEMORY.md` 和 `owned-preference.md`，第三项指向本用例自有 caseRoot 中、Memory root 外的 `owned-outside-memory.md`，收到原 Memory-root policy 的拒绝。参数全文、路径、内容、成功消息与拒绝文字均已核对；并非测试设施直接执行这些 Write。

原始文件字节及目录逐级无 symlink 已复核，禁止目标仍不存在。实际文件位于本用例私有 `data/.uwork/cli/memories/projects/packaged-workspace-aed45b1f029d87a1/memory/`，未写真实用户或 Codex memory。

| 文件 | 字节数 | 完整 SHA256 |
| --- | ---: | --- |
| MEMORY.md | 85 | `5616978683291df909298cff62750a39648c00d63b734958653dbb933adf62c8` |
| owned-preference.md | 374 | `198d6143bcf6b682274661c9de016630f9983104845029ab49f5d9f75bf610de` |

topic 的有效 YAML frontmatter 由原 stamping 增补 `metadata.node_type: memory` 与 `metadata.originSessionId: sess_f91b34eb-cd5d-4649-832c-a313d47b8cdb`，与 UI task A、实际 durable session 一致。B 为另一个 session；raw 8 中单一文本片段包含原 index heading 与完整 index 内容，raw 9 标题不含偏好正文。这里只证明 B 自动消费 index，未宣称 topic 正文自动注入。原 Memory catalog 仅观测到两个精确文件名与正确 scope，不冒称 UI 正文预览。

两次 sidecar 的完整请求、三条结果、正常 HTTP finish/no-abort、全量结算与后续 quiet sample共同支撑实际提取链路。末轮无工具回复的依据是冻结供应处理器及其正常响应收据，没有单独保留该末轮响应全文。原 loop 在无 tool calls 时自然退出，未调用实际 Runtime 的 private drain、强制 stop 或 cursor getter。session 检查中另建的原 scheduler 只作 pure gate oracle；其 drain/getCursor 结果不当作实际后台 scheduler cursor 或完成 telemetry。

只读最终 backend SQLite 的双 actor 完整账务行已核：当前成员 **8 条 settled /176 credits /96 input+80 output**，另一成员 **2 条 /44 /24+20**；Trace 与 gateway 各 10 条，10 个原供应请求均正常返回。warm→A 增 4 次/88，A→B 增 2 次/44；阶段已保存的旧 ledger、Trace、gateway 行逐字段保持，另一 actor 的完整账务投影未变。最终 raw 全行另有摘要哈希；Trace 仅沿原 actor/model/application/token 聚合验证，不杜撰 request-key 外键。

UI task、实际 CLI PID 85160 的 birth/映射/工作目录与前后 DB FD 绑定一致。原 CLI session DB 为 `data/.zcode/cli/db/db.sqlite`，Memory storage/runtime log 为 `data/.uwork/cli/`；这两种目录不能混写。阶段时点 A、B 均为一条 user 加一条 assistant；B 随后发生原 revoked-seat 负例，因此不宣称最终 B 数据库始终只有两条消息。

原 seat 拒绝、logout、同 controller/profile 冷启动尾段保留，最终仍为原 10 请求与同一账务基线。18 个 known PID 和另外两个 BH daemon 当前均已退出，4 个 TCP 端口关闭。两 BH 的 0700 证据目录及无持有者的 `bu.sock` inode 保留；原 socketClosed 收据、daemon absent 与当前 `lsof` 无 holder 支持接口已关闭，不是路径已删除。OS protocol 恢复、系统剪贴板未使用。复核后 450 源仍稳定，新包 strict loader 的资源、签名、原 fuse wire 与最终 ASAR header 再验通过。

本结果不把 Memory root 的工具限制扩大成全局 filesystem sandbox，也不覆盖外部 MCP、真实企业微信或网络盘。
