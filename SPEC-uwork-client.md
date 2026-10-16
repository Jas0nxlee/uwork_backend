# uwork-client

目标：公开客户端合同和 UWork 既有服务边界适配；终端凭据调用自有网关，不下发上游密钥。
实现：src/client.ts 和适配仓库受控模块；使用既有 enterprise-identity/Host/服务/hooks，不新增 Renderer 身份所有者。
验收：模型/资产/配置同步、真实网关对话、吊销阻断；适配仓库 typecheck/lint/architecture；真实三平台安装独立验收。
Host 后端地址仅接受无用户信息、查询、片段及路径的 HTTPS origin；开发环境仅额外允许 loopback HTTP。loopback 主机也不得使用 FTP、WebSocket 或自定义协议，初始化时即拒绝。
Host 适配器的一次 synchronize 绑定开始时的终端凭据；目录请求及各应用回调前后重查该身份与取消状态，发生变化后不继续应用或上报成功。交给资产端口的下载回调只接受该次清单中的 ID，绑定清单版本和原身份/取消上下文，换版冲突要求重新同步；下载及最终上报响应返回后再次检查，拒绝迟到内容与成功结果。已完成的 Host 回调或已派发事件不声明可回滚；各实际写入口仍由 Host 自己执行当前权限及身份代次检查，不替代原生客户端验收。
命令：npm test；npm run build；适配仓库 pnpm typecheck、pnpm lint、pnpm architecture:check --changed。

Host 资产验证：真实本机 HTTP 后端连接已有私有身份会话端口与受管缓存。既有身份事件触发技能预热；新读取得到当前版本，撤权拒绝逐次加载，退出事件清理已接触的所有自有缓存。控制身份适配器仅模拟企微回调，不代表真实企业 callback 验收。Runtime SkillPort 逐次加载、专家和受控 MCP 已接线，并由真实 stdio/HTTP 合同测试覆盖；三平台安装仍单独跟踪。
并发规则：缓存磁盘选择代次由缓存唯一维护，每次清理在共享文件锁内比较并推进；旧同步不能删除较新成功同步返回的目录。网络 IO 不持有文件锁，代次不代表权限。
目录反向 RPC：已有 Host 工具准入桥共享 32 槽 pending、连接/工作区/会话取消和失效裁决；独立严格目录 schema 限制响应 1 MiB。真实协议客户端的显式回收 signal 在等待 transport 退出前取消同步，不合成 close 事件或重复触发进程清理。该接口随后已装配到 CLI bootstrap/SkillPort/composer，正文前后授权由既有私有 Host 所有者执行；三平台安装不由该接口基础或受控测试替代。

新增验证目标：实际 desktop-agent CLI 包通过真实 stdio 向私有 Host 请求目录及逐次资产准入；本机 HTTP 后端仍是权限所有者。受控技能能在禁止危险技能时发现，撤权后消失；草稿的伪造工作区请求必须在扫描前拒绝。测试使用独立 HOME/存储根与合成身份，不读取实际客户端凭据；这不替代 Electron 或三平台安装验收。

新会话展示复用既有 identity RPC 的 `readClientPresentation`：私有会话验证当前配置/组织，支持未发布配置的 version=0；UI 使用 30 秒与焦点刷新，拒绝迟到结果。固定 AI 前缀在加载/失败/退出后仍展示，企业自定义欢迎和风险后段在退出后立即清除。生产 provider/空态/风险组件的真实 Chrome 回归覆盖 320/768/1440。

本地 enterprise-console 独立服务接入当前菜单 ID 准入、UWork 现有自动化/插件商店入口；菜单只管入口，助理渠道和资源策略继续裁决实际执行。真实 Sidebar 复用旧新任务所有者，后端智能体 API 与本地导航独立保留，仍只返回授权资源与本人任务。公网分享复用现有分享服务和实际 Host 网络出口；个人模型管理、模型生成/流事件及 MCP HTTP/stdio 连接池逐次裁决，公开配置不能伪造托管或 builtin 来源。各切片的严格测试入口与剩余远程/安装边界见适配仓库对应 specs。
