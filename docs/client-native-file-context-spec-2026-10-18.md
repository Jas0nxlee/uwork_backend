# Native G07c 文件引用、Read 与模型正文联测合同

本项连接原 Native 文件树“添加到聊天”→canonical mention→原发送→正式 CLI Read→后继模型工具结果；仅增加测试夹具，不新增产品 RPC、身份 owner 或工具实现。实施/纯合同不等于 Native 验收，实际运行须新的正常 CLI/Desktop 构建、冻结、新 profile 和 Root 独立 Runtime Go。

## 模式与起点

- 仅 `UWORK_NATIVE_FILE_CONTEXT=controlled` 且 experience=enabled、fixture 名为 `client-native-file-context-*` 可启用；与 primary、viewer、dynamic workflow 严格互斥，非法模式/错 profile 在任何 mkdir/FS 前拒绝。未设置 flag 的默认/primary 入口生成字节及私有环境清理保持原合同。
- 使用全新独占 R、HOME、工作区与 BH；仅在本次 R 内建立 `project-file-context/G07_CONTEXT_A.txt`、`G07_CONTEXT_B.txt` 两个普通 0600 UTF-8 文本及本地 Git 目录。A/B 各有本轮唯一正文 marker，文件名和固定 prompt 不含 marker。不使用旧 R 或其他私有文件。
- 身份沿用原正常 email HTTP 登录和生产 credential/shared-store 加密预种，由原 Host 恢复；它不是空身份原登录 UI 验收。原 B 用户两次初始化模型请求与 44 Credit 单列基线，Native A 用户的后续增量分别核验。
- 原后台 API 创建的 supplier Key 仅保留 RAM，复用现有 strict witness 检查精确 models/chat 路径与 Bearer；query、未知路径、错误 Key 拒绝，traces 原通道不附加此要求。只输出匹配/拒绝计数，Key 不到 Renderer 或证据。
- file 模式自己的 `file-context-entry.mjs` 以 TLA 导入正式 guard，并在原 Main 前只安装一次 `installPrimaryMainGuard` 的无 channel 分支；不提供 nonce、SSO/private IPC 或身份控制。严格保留 owned file/about:blank/精确 backend 允许列表及 OS 出口拒绝，随后 TLA 原 Main；后续准备不能再注入第二套 Session listener。env-guard 最先执行，保留原 generic 及 wx0600 per-PID 元数据。失败只写 pid 与固定 session_guard/main_import code、wx0600 first-write，不写原异常。原默认及 primary 入口字节不改。

## 固定 supplier 与实际动作

固定首轮 prompt `NATIVE_G07C_READ_A 请读取引用文件后简短回复`，第二轮为 `NATIVE_G07C_READ_B 请读取引用文件后简短回复`。两个 Read call id 固定为 `native-file-context-read-a`、`native-file-context-read-b`，仅允许各自新 R 里的绝对 file_path。

1. 完成实际 Main/file renderer、owned BH 与公开身份/模型就绪绑定。原 composer 输入 A 固定 prompt，经原文件树 A 行右键及“添加到聊天”插入唯一 `dropped-file:G07_CONTEXT_A.txt`，只用真实 Input 发送一次；首发长度满足原 title 条件。
2. 第一主 streaming 请求须含该 prompt 与 canonical 相对 mention、尚无本次 Read 结果。supplier 只发一次 Read A；下一主请求只认该 call id 的真实工具结果和带行号 A marker，才返回固定完成文字。不得仅凭最终 UI 答案认定读到了文件。非 streaming 标题独立只回固定短标题，不能发 Read，允许与主请求并发完成。
3. 同一实际 task 输入 B 固定 prompt并通过原文件树 B 行添加唯一 mention。使用原 configure/security PUT→publish，GET 回读 allowFilesystem=false 后再原发送一次。supplier 只发一次 Read B；后继主请求必须包含该 call id 的原拒绝结果且两次新主请求均没有 B marker，才回固定拒绝完成文字。第一轮合法历史 A marker 允许存在，不计为新泄漏。

UI 模块只定义 observe/prepare/mention/send A/B 固定动作，复用已审文件助手的 TID 和原右键流程，不重复文件预览，也不为预览自定义 protocol 放宽 guard。只读固定公开布尔、匹配结果、实际 task ID 与控件几何；没有任意 JS/Input 参数、DOM.click、React/editor 状态注入、Storage、Token、原始日志、AX 或截图。业务动作一次，任一失败停止依赖动作，不能重发以补足计数。

文件树打开时，原侧栏会设置 `aria-hidden=true`，因此可见账号标识暂时消失。每次 mention 插入后，在同一动作内物理点击原“返回任务”按钮一次，等待账号标识重新可见且文件树关闭，再允许后续发送。保持原身份选择器、当前任务和发送前鉴权门槛；关闭文件树后身份仍缺失时必须停止，不能沿用旧身份布尔值。

工作区 chip 属于原 ChatEmptyState，首轮只在其真实工作区匹配时输入；原发送后须取得非 draft 的实际 SessionPane task ID。第二轮沿此 ID 固定同一任务，不假定首发后工作区 chip 仍存在，也不把 draft 占位 ID 当作真实任务。原 UI 回复只在当前 pane 的正式 assistant selectable 行中匹配，stop 使用正式 v4-stop。

## 账本与有限事实

正向 Native 增量为 3 请求（主工具请求、主后继请求、原标题）、3 笔当前 A 用户/本模型 settled ledger 与 3 条模型 Trace；沿用原每次 12 input/10 output 时为 66 Credit。撤 FS 后同 task 第二轮为 2 个合法主模型请求、2 笔账本与 2 条模型 Trace；不能把工具拒绝误写成模型或账本零增量。原标题不能再尝试。三种请求只按本轮完整增量集合关联账本，不以相同 token/金额或时间排序伪造独立 request-id 的一一对应。

复用原 experienceSnapshot 命令，file 模式保存专用固定计数/布尔投影：bootstrap/主请求/标题/指定 Read 结果及拒绝计数、marker 匹配/缺失、后台 Key 匹配、已发布 FS 布尔、A 用户与本模型账本/Trace 数量、tokens/Credit、输出字节计数和 witness metadata。不能写整个 model body、raw URL、Key 或凭据。原 default/primary snapshot 实现字节保持不变。

仅复用原 configure（固定 security.allowFilesystem）、experienceSnapshot、owned openWorkspace、launch/stopNative；不新增通用 reply、PTY/RPC 或原脚本运行入口。file flag 也不传给 Native/Host/CLI。原始 Electron 输出在 file 模式仅作有界安全计数，不落 raw log。

## 边界与后续实际 Go

FS=false 取当前 `security.allowFilesystem`，不把 sharing.files 当作普通 Read 的权限。第二轮证明已撤 FS 时新 B 正文不进模型；“实际 OS Read 已进入、等待字节返回期间撤权”由独立 Read 产品修复及定向合同证明，不能由 supplier 等待或这两次模型请求冒领。

后续完整运行需实际新产物包含 Read 修复，并记录复制/stage CLI 与 Desktop 的准确来源；不得沿用旧 b385/dde4 构建来代表新源码。正常 email 身份与 2B 初始化基线不关闭 G04h/U02–U05。真实企微、外部 MCP、网盘、真实外部模型及跨平台安装继续排除。未知写者时保留 R0700，不 close/INT/TERM Common；Root 独核后精准停止、原工具终态与端口/BH 收口仍是必要条件。
