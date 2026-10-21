# macOS x64 原包与后台联动补测范围

本轮在 Apple Silicon Mac 的现有 Rosetta 环境测试原 darwin-x64 包，不能替代物理 Intel 验收。Windows、Linux x64、真实企微浏览器授权、被拒远程 Provider 运行、外部 MCP 与网盘不参与；已有 arm64 主联动结果不计入 x64 通过。

原正常 producer、原 target/flags/签名流程为产物唯一入口；代码候选沿 `1bd1ec7b` 后工作区、原 Agent cdf。固定官方 Electron41.10.7 x64 ZIP 必须全尺寸/SHA匹配，原 x64 node-pty、spawn-helper 和工具架构独立核验。准备/构建使用干净环境与既有 env guard；不修改生产源、fuses、依赖版本或 Builder 来求通过。既有 arm64 v6/v7 缓存及资源摘要在前后保持。

窗口吸附辅助程序在当前官方 CLT 缺 x64 Swift 兼容库，原 target11 与私有 target12 编译均失败。原产品已存在的可选 helper 省略与 runtime fallback 可用于核心切片，但必须记录 warning、实际缺失及 unavailable，不能称完整 x64 功能通过。原 Desktop 输出位置 FileProvider xattr 导致签名失败的第一候选保留；新缓存目录候选仍须正常完整签名，不手工清 xattr/补签旧包。

## 验收顺序

1. 正常新包自然构建终态、严格 codesign、实际 bundleID/版本、独立 manifest 与必需资源 SHA/权限/目标架构核对。缺失的可选 helper 另列；无 manifest 正例不启动 GUI。
2. 使用新鲜专属 profile 与原隔离后台/受控供应商。若适配原 arm64 专用 loader，只新增独立严格 x64 loader 和精确 import 派生；原共享 fixture/loader 不改。实际目标路径、四项核心资源、严格签名、无效 target/path/hash 拒绝须先有设施合同和 source hash 锁。
3. 原 Main/Host/包内 CLI 实际运行；由原可执行文件的 x86_64 Mach-O 与该 PID 的真实映射/代次证明对应程序，不能仅以 Rosetta 安装收据或 UA 代替。记录是 Rosetta 切片。
4. 原 UI 身份与显式项目、文件预览→renderer reload→同项目再预览；真实 PTY/OS shell/cwd/文件副作用与收起重开保活。原 native addon 实际加载路径与目标架构匹配。
5. 原 UI 两笔受控模型调用和本人结算/Trace一一对齐，他人基线不变；实际模型 cwd 与选中项目一致。上下文500000是合法原管理接口正例，不声称实际token超过128k。
6. 原撤席位后原发送拒绝且供应商/Trace/账本零新增；按实际拒绝端点报告，不能把配置403说成chat403。
7. 原 UI 退出，同 profile 冷启动身份和模型不复活；记录已知进程、端口、BH 与原 protocol-only guard 完整收口，不使用系统剪贴板或全局键鼠。

所有失败候选/设施失败均独立保存。GUI 由 Root 在实际包和 fresh plan 独审后排他分配；不得与另一个 macOS 原生输入 owner 同时执行。核心切片通过仍不关闭缺失 helper、物理 Intel 和所有其他平台缺口。
