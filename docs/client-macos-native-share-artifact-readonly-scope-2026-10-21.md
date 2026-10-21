# Native Share 单件真实附件：只读可执行范围（2026-10-21）

建议最薄切片选 **工作区内一件合法 PDF**，使用现有正常 ARM64 v12。这里只做源核与方案，没有新 App/GUI、fixture、producer、后台监听或产品修改；所有既有用例与输入保持冻结。

## 为什么不为 PNG 扩范围

当前 shared `conversation-preview-artifacts.ts` 的 assistant preview 类型没有 PNG；在 assistant Markdown 写 `![x](file.png)` 不能因此得到可分享的 PNG artifact。PNG 的原支持路径是 userInput 图片附件，需要 Composer 选择/拖入及模型 Vision 前置；Native 默认 picker 与隐藏 HTML fallback 还需分别界定。工作区文件树拖放的专用 MIME 只插 mention，不走图片附件上传。这些都不属于本薄切片。

Markdown 和 HTML 虽可发现，但 `requiresFileChanges` 为 true，单靠原 xterm 写 `.md` 而没有原 Agent 当前 turn 文件变更记录不足。**PDF 在现有定义内，`requiresFileChanges=false`，原 assistant preview reference 可直接对工作区真实 PDF 做 stat/read。** 不需要新 Vision、原生文件选择器、工具脚本/Skill、MCP 或人工 artifact descriptor。

## 原 UI 与真实 producer 链

1. 用原 v12 strict loader、fresh `client-native-packaged-macos-clock-…` profile、原 onboarding/企业身份/工作区与受控模型，保留正常身份 owner、backend、supplier 和另一 actor seed。必要的受控大窗口元数据继续按已有合法 Admin 输入，不改变 guard。
2. 通过原 Native xterm 与真实 shell，在唯一自有工作区产生 `native-share-proof.pdf`：预先准备 ASCII 单页 PDF 的合法对象、xref、trailer、startxref/EOF，原终端只负责解码固定字节到该路径。写入后必须实际读取源文件、核 SHA/长度、magic、xref offset/对象 offset、Root/trailer/EOF，证明是真实可读 PDF；不能只写 `.pdf` 后缀的任意文本。原 PTY PID、TTY、cwd 与 live FD 同时绑定本 case。
3. 原 Composer 单次发送受控 prompt，supplier 的原主回复通过真实模型链返回 `[本轮结果](native-share-proof.pdf)`；标题请求仍独立。验证该回复实际入本 task/turn，原 preview card 在唯一 interactive task pane 中可见，标题为本轮文件。不能只拿正文出现文件名当卡片证明。`AssistantPreviewCardRow` 没有专门固定 testid，正式准备须依据原卡片结构/可访问名称锁定唯一元素，不发明选择器或改产品。
4. 原分享入口为 `conversation-share-trigger` → `conversation-share-next`（预检完成才 enabled）→ `conversation-share-disclosure-checkbox` → `conversation-share-confirm` → `conversation-share-success-dock`。必须确认该已完成 turn 被选中且 **一个 PDF** 被选入，没有 omitted-file warning；下一步按钮或成功卡本身不证明附件上传。

原用户 UI 上传/确认必须触发真实 Native Host 的 `ConversationShareService`；不调用测试 RPC 发布、不手置 row/manifest/descriptor、不直接用后台准备/上传 API代替客户端。原服务从 assistant preview references 发现该 PDF，按工作区 realpath 边界读实际字节，再生成公开投影、descriptor 与上传。

## 前置与后端 oracle

- 原 Admin GET→PUT 当前 revision→publish→GET 回读：`sharing.publish='organization'`、`sharing.files=true`、`security.allowFilesystem=true`；保留其它字段。默认 sharing.files 是 false，不能把默认零附件成功当本场景。由原 authorize/share scope 重读当前策略，权限检查不能替换。
- 原真实链依次为 GET capabilities、POST preparations（artifact_count=1）、POST preparations/:id/artifacts、POST :id/confirm。仅在现有后台增加透明被动收据/借用既有 Db 的只读查询；观察异常不能改变原 handler 或假零。
- 上传 oracle：tenant/current creator、preparation、productTurnId 与唯一 artifact ID 归属一致，`artifact_type=pdf`、`extension=pdf`、`mime_type=application/pdf`、长度和 SHA 都等于实际本地 PDF；后台存储 BLOB 实际重算同摘要。确认 projection 与 artifact set 使用原计算，不由测试写入。
- 原授权 GET `/:code/preview` 必须列一个对应 descriptor。使用本 case 原身份在 **原** `/:code/artifacts/:id/content` 下载，真 HTTP 200、application/octet-stream、nosniff/no-store、受控文件名；下载字节的长度、SHA 与源文件、上传、存储四方一致。下载 API 证明不能称为外部浏览器查看器或系统另存为对话框验收。
- 原用户发送主+标题预计当前两笔 44 credits，保留他人原两笔 44。分享前先等两笔 settled、Trace succeeded、gateway result 完成再取基线；分享/读取/下载阶段 raw inference POST、supplier 请求全集、ledger/Trace/gateway 与另一 actor 全集合零增量。不能只比 supplier/账本而漏掉同 idempotency key 的 HTTP 重放。
- 最后用该真实分享的原 DELETE 撤销并核存储/下载不可用，作为自有分享数据收口，不冒称 UI 撤销入口已测。原 Native stop、BH、PID、TCP/UNIX、协议/clipboard 与 profile 输入摘要严格关闭/恢复；不打开默认浏览器、不点击复制链接、不触全局 clipboard。

## 复用和验收边界

复用原 `macos-clock`/Common fixture 的身份、受控 supplier、原 xterm、原 Composer、原 Share UI、OSguard 和 BH；使用新隔离派生入口绑定 v12，而不修改旧 frozen 文件。share 本轮可只保最小身份/工作区/单次发送与本附件链，不需要为了它重复文件 reload、冷恢复或所有七项。后台 oracle 可复用既有 readonly stage snapshot 与 raw ingress helper。

正式实现前还需 Root 下发本切片范围/文件 ownership，并对新 fixture、真实派生编译、完整 profile/loader 守卫、被动 oracle、PDF 格式与复合 SHA 断言做独立审查，冻结 fresh plan 后才有单次 GUI Go。此只读计划不算 Native Share 附件已通过；旧 zero-artifact 分享、源码单元测试也不能替代该验收。

可复核的 17 个 source SHA 与原 UI/API 清单见 [readonly facts](../evidence/client-macos-native-share-artifact-readonly-20261021/facts.json)。
