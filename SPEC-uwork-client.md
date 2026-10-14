# uwork-client

目标：公开客户端合同和 UWork 既有服务边界适配；终端凭据调用自有网关，不下发上游密钥。
实现：src/client.ts 和适配仓库受控模块；使用既有 enterprise-identity/Host/服务/hooks，不新增 Renderer 身份所有者。
验收：模型/资产/配置同步、真实网关对话、吊销阻断；适配仓库 typecheck/lint/architecture；真实三平台安装独立验收。
命令：npm test；npm run build；适配仓库 pnpm typecheck、pnpm lint、pnpm architecture:check --changed。
