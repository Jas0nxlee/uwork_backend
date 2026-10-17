# Native 设置、HTTPS 菜单与分享入口的追加联测

沿现有 production Electron/Main/Host、正式 staged CLI 与实际后台 HTTP，补覆盖矩阵 G04/G06/G08 的原生界面。真实企微、外部 MCP、网盘及付费模型仍排除，原始主后台和外部客户端仓库不参与。

## 边界与所有者

后台的已发布菜单、personal/security/sharing 策略是准入事实；原身份 owner 从本次 HTTP email 会话的生产加密 store 恢复。UI 只经 DOM/AX 输入和点击，不注入 React、store 或业务 RPC。个人 MCP 使用自有本机端点，技能使用自有目录，不连接外部 MCP。

独占 Native 夹具只拷贝当前正式 out 产物到新 appRoot，核对 Main SHA；bundled-agents/node_modules 只读复用。启动器在导入 Main 之前安装文件读取守卫，拒绝源仓库根和客户端根的 `.env*`，记录守卫生效与阻止次数，不记录内容。协议注册抑制仅防止测试 app 改变系统默认打开方式，业务服务不替换。

## 验收

1. 后台发布自定义 HTTPS 菜单后，实际 sidebar 点击交给原浏览器 owner，打开公开 HTTPS 页面；验证实际页面 URL/正文和当前菜单准入。禁用/改名和草稿发布沿原 owner，不由“按钮出现”推断成功。
2. 沿既有运行时权限合同：手动预存配置不授予连接权限，personal.connectors=false 时不得发现、连接或调用自有端点；true 且 native security 允许时，实际设置页刷新须能通过既有 MCP status lane 完成握手并展示当前状态。再次关闭后，不产生新连接/调用，已有配置保留。此项不把单独针对个人模型管理的合同套到 MCP 配置写入，也不以配置已保存推断连接成功。
3. personal.skills/dangerousSkills 的设置页面加载、导入/管理实际入口及撤权行为，使用自有文件与实际原生选择器；后台拒绝不能被 UI 可见性当作允许。不得删除已有用户技能来制造拒绝。
4. 经过真实对话的分享入口，记录选择、预检、权限拒绝和退出。如果生产认证/分享服务没有可用实现，真实验证错误和零出口，并将成功链保留为缺口；禁止强改 OAuth Repo、注入 shareClient 或用合成 UI 状态伪造成功。后续若完成缺失接线，需先规格和独立审查，再沿同一入口正向复测。

每次探针记录实际 DOM、截图、必要网络状态和私有产物字节/计量的简短证明。旧历史字符串不当作新的工具执行。失败与成功都确认自有 Electron/Host/CLI PID 退出、端口关闭、临时根和专属 browser-harness daemon 删除，保留受控运行证据。

MCP status lane 与 plugin 管理 lane 都是原有 ProcessManager 所有者，反向企业准入必须识别当前真实 client，而非只识别 chat lane。过期/替换/已退出 client 和 workspace 不匹配仍拒绝。前端只对完整匹配的企业拒绝码给权限或刷新提示，保留详情；任意上游正文包含码字样不能被改写成企业诊断。

技能页只有成功取得 `userScopeAvailable=false` 的能力结果时才显示桌面限制提示。加载失败或尚无能力结果时不得推断平台不支持。完整匹配的个人技能权限拒绝显示联系管理员的中文/英文提示，未知错误保留原诊断；此变更不改变准入与能力状态。

技能导入的扫描/最终提交错误复用同一 exact-code 提示，避免权限已正确拒绝后仍直接展示内部码。其他类别与未知错误保持原诊断，原始错误仍供既有日志排查。
