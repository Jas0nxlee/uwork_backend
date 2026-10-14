# uwork-client

目标：公开客户端合同和 UWork 既有服务边界适配；终端凭据调用自有网关，不下发上游密钥。
实现：src/client.ts 和适配仓库受控模块；使用既有 enterprise-identity/Host/服务/hooks，不新增 Renderer 身份所有者。
验收：模型/资产/配置同步、真实网关对话、吊销阻断；适配仓库 typecheck/lint/architecture；真实三平台安装独立验收。
命令：npm test；npm run build；适配仓库 pnpm typecheck、pnpm lint、pnpm architecture:check --changed。

Host 资产验证：真实本机 HTTP 后端连接已有私有身份会话端口与受管缓存。既有身份事件触发技能预热；新读取得到当前版本，撤权拒绝逐次加载，退出事件清理已接触的所有自有缓存。控制身份适配器仅模拟企微回调，不代表真实企业 callback 验收。Runtime SkillPort 逐次加载接线、其它资产所有者及三平台仍单独跟踪。
并发规则：缓存磁盘选择代次由缓存唯一维护，每次清理在共享文件锁内比较并推进；旧同步不能删除较新成功同步返回的目录。网络 IO 不持有文件锁，代次不代表权限。
