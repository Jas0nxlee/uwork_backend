# 实施任务

- [x] T01 identity / directory / access-control 持久化与安全测试
- [x] T02 credential-vault / entitlements / model-gateway 调用与扣量
- [x] T03 ai-assets 版本、分类、范围、审核与分发
- [x] T04 client-policy 草稿发布与服务端执行入口
- [x] T05 agent-runtime 模型执行、取消、自动化及评测
- [x] T06 telemetry 日志、Trace、指标、导出、留存接口
- [x] T07 external-integrations 能力声明与网盘适配合同
- [x] T08 admin-web 管理流程与浏览器验证
- [x] T09 uwork-client 后端 SDK、身份/模型/用量服务适配与合同验证
- [x] T10 最终构建、运行、交付文档与验收台账（外部与项目级缺口如实保留）

项目级待办（本地后端构建不替代这些验收）：

- [x] T11 专用 Docker 实例、实际镜像构建、容器业务流程和重启持久化验证
- [x] T12a 真正隔离的 Docker Runtime 生命周期、执行、取消、限额、崩溃恢复及管理 UI
- [x] T12b 跨命名空间租约、写入 fencing、迁移前独占与只读在线备份
- [x] T12b2 模型工具协议 JSON/SSE 往返、输入上界计量与成功后分派
- [x] T12c Agent 模型工具调用与隔离 Runtime 闭环（SDK、自有计量端口、真实 Docker、取消/撤权/双场景崩溃恢复、管理 UI）
- [x] T12d Agent 受控 MCP 连接器工具接入与远端副作用不确定性处理（白名单、版本冻结、schema 校验、计量循环、取消/断线/超时、SIGKILL 恢复）
- [ ] T13 完整 UWork Host 资产与策略应用
- [x] T13a 本地 Host 非交互执行准入：私有身份/issuer、当前订阅渠道策略、Hook/审批后重查、原生进程/逐跳 HTTP 闸门及跨源码真实 HTTP/进程验证
- [x] T13b 企业资产安全安装/更新/撤销并接入已有 Runtime 所有者（技能、专家与受控 MCP 连接器均已接入）
- [x] T13b1 后端资产版本/校验和准入、订阅/IP 下载入口及可移植技能包路径合同（不代替 Host 安装/加载）
- [x] T13b2 独立受管资产缓存适配器：排他暂存/原子发布、完整校验/安全撤销、并发/真实 SIGKILL 恢复、实际 HTTP 下载至既有 SkillPort 验证（后续 T13b3 已接线，三平台安装仍待验）
- [x] T13b3 装配 Host 自动资产同步、运行时逐次加载授权，以及专家/Playbook/指令/受控 MCP 的现有所有者接入
- [x] T13b3a Host 私有技能清单/安装编排与既有身份事件预热/退出清理；磁盘代次防旧同步清理新版本；真实 HTTP 与身份服务源码闭环（Runtime SkillPort 后续由 T13b3b 接线）
- [x] T13b3b 同一反向 RPC/SkillPort 接入逐次授权，覆盖草稿目录、子 Agent/工作流及旧 Host 技能正文出口（65 秒目录、70 秒正文上限，逐次前后准入与 ownerKey 绑定）
- [x] T13b3b1 技能目录反向 RPC 基础：共享工具准入 pending/取消/32 槽，工作区/Trace/响应校验，真实协议客户端显式回收取消与实际 HTTP/JSON 源码验证（后续 T13b3b 已完成 SkillPort/composer 装配及逐次加载）
- [x] T13b3c 专家/Playbook/指令/受控 MCP 既有所有者的资产与权限应用（Playbook/指令按控制台证据拒绝下发到 uwork）
- [x] T13b3c1 企业专家接入既有子智能体所有者：同缓存根/单次选择、enterprise 只读 profile、保留名与重名拒绝、正文 schema+校验和双查、真实 stdio 会话加载与撤权不回载；同时按控制台证据拒绝 Playbook/指令下发到 uwork
- [x] T13b3c2 受控 MCP 连接器接入既有 MCP 所有者：目录元数据 + 逐次准入 + 反向 RPC 帧通道，凭据/远端地址/远端会话不出 Host；后端补会话显式回收与按连接协商的 MCP 版本
- [ ] T13c 已发布菜单/新会话/风险/分享/个人/助理配置的 Host 与 UI 应用
- [x] T13c1 已发布新会话欢迎/风险展示、默认 version=0、退出与迟到响应、真实 Chrome 响应式验证
- [x] T13c2 公网分享 Host 当前策略/文件/网络/实际 HTTP 出口复核（真实端点/代理设置等待后重查）
- [x] T13c3 复用既有自动化/插件商店页面、菜单命名排序启停与 Host 菜单 ID 准入（保留兼容 ID、自定义命名、真实 Sidebar 与既有页面 owner）
- [x] T13c4 个人模型 Host 管理/发现/解析准入、唯一 Gateway 写者 Symbol 私有端口
- [x] T13c5 个人模型与 MCP 实际运行时出口、真实共享连接池/stdio、迟到结果与身份 fence
- [ ] T13c6 云/移动实际渠道、组织协作和微信/企微等无对应本地出口的真实集成（不以布尔配置或公网私有链接代替）
- [ ] T13d 附加远程工作区执行策略、三平台安装与完整集成验收
- [x] T14 逐页面/表单能力台账与缺口审计：55 个页面观察全部有映射行（43 已实现 / 10 部分 / 2 外部依赖），生成器 + 双向完整性/状态/端点存在性测试保证不漂移

- [ ] 已安装 UWork 的真实企业与三平台整体回归（本机 Host 源码、已打包 CLI stdio 与生产组件浏览器联调已通过）
- [x] 已配置模型供应商真实文本/SSE/工具循环、视觉消息与思考参数及内部计量（不代替其他供应商、复杂能力基准或发票对账）
- [ ] 每个真实企业企微 callback、生产 TLS/外部网盘/支付/生产沙箱部署与供应商账单对账
- [ ] 生产目标主机部署和远端 CI 结果（本机 Docker 验证已通过）

## 2026-10-17 持续覆盖（用户要求自动推进至全范围验收）

- [x] U01 将现有规格、实际客户端入口与真实运行证据逐能力映射，列出未验证的成功/拒绝/更新/退出与重启场景；见 `docs/client-integration-coverage-2026-10-17.md`，不能用测试数量代替能力覆盖。
- [ ] U02 已发布菜单/新会话/资产完整 Native 链路：后台修改经实际 HTTP 到当前原生 UI/Host，旧草稿不生效、发布生效、禁用和身份变更阻止实际副作用；需要的修复先 RED 后 GREEN。
- [ ] U03 分享/个人模型/技能/执行策略真实出口：允许路径实际有副作用、拒绝路径实际无副作用、操作等待后撤权不能沿旧权限继续，目录/投影不能替代授权。
- [ ] U04 远程/移动、云/助理渠道及其余真实客户端入口逐项核验；支持的现有入口实际运行，缺环境/未实现项记明，不以本地 metadata 或布尔配置代替。
- [ ] U05 每个缺口修复后定向复测，相关全量类型/Lint/格式/架构/构建通过，保留原始失败和清理证据，最终逐能力完成审计。

已完成的持续覆盖子项（不据此勾整个 U02/U03）：

- [x] G04g 真实 React 登录 Provider 在 Native open未决时由poll先认证，之后旧null/ERR_ABORTED均不回退、不cancel/重复close或sync；新2+旧23一次25/25，类型/Lint（113既有警告）/架构/改动格式通过。运行器有限等待、已知进程与未知FD保根合同已修，90进程身份/两端口/两临时根独立收口；正常out6631逐SHA恢复。仅组件端口合同，客户端空身份原生登录仍待独立验收，详见 `docs/client-enterprise-login-polling-test-2026-10-18.md`。

- [x] G01 真实交互身份、跨企业/issuer 资产缓存、迟到下载、冷恢复及退出：2 项、279 次 HTTP、4 CLI。
- [x] G02a 正式 CLI Agent 子任务继承私有 relay/目录与子派发前席位撤权：2 项及原 5 项回归。
- [x] G02b Native Skill v1→v2→撤权，模型 IO 实证正文/无正文；不替代专家/resume。
- [x] G04a Native 已发布菜单名字/顺序/路由、草稿不生效、欢迎/risk 发布与退出清除；延迟真实配置响应后旧可见菜单点击也被当前准入拒绝。
- [x] G05a Native 自动化创建/立即运行、local 渠道拒绝、实际重启后持久化再运行；不替代绑定任务 resume。
- [x] G03a 缓存正文篡改/缺文件/symlink：3 项、315 次 HTTP、9 CLI；冷启动不静默修复，显式隔离后恢复；双 Host/安装 SIGKILL 实际组合已由 G03b 补完。
- [x] G06a Native 个人模型创建/配置/发现/实际运行与同会话撤权，拒绝不改配置或派发；两条误导/内部码提示修复并重建复测。个人技能/本机 MCP 的实际 CLI 出口已由 G06b 补完，Native 设置界面另列。
- [x] G07a 正式 builtin Read/Write/Bash 真实副作用与批准/Hook/yolo 后撤权：5 项及原 7 项回归；WebFetch 实证域名和 SSRF 拒绝，不冒领公网成功。
- [x] G08a 实际 Host 分享/生产文件源/自动 manifest/hash/上传确认/网络席位组织撤权：5 项、299 次 HTTP、26 既有回归；正式外部服务/Native 分享 UI另列。
- [x] G08b 按用户决定补齐企业成员只读分享后端、私有 Host 传输与同源浏览页；301 后端/49 客户端/3 跨仓真实 HTTP 通过，浏览器五阶段真实 Cookie、两下载、跨企业/退出/撤销拒绝及四宽度通过。受控企微替身、签名安装包和三平台边界保留；Native 发布已由 G08d 另验，主服务恢复与新部署单独记于 `docs/local-backend-recovery-2026-10-18.md`，不据此关闭 U03。
- [x] G08c 实际 Header/IdentityProvider/ShareMenu 浏览器回归复现旧 OAuth 入口门槛 4 项失败，单组件修复后同 8 场景通过；覆盖当前企业认证、退出、owner 切换、残留旧 user、任务及 Desktop 约束与无 context 兼容。类型/Lint/架构/严格 fixture 类型及新正常 Desktop 构建通过；实际 Native 发布已由 G08d 另行验收。
- [x] G08d 实际 Electron 生产构建正常会话→原 ShareService/CLI 投影/私有 scope→后端 confirmed1/三公开行，prepare201/confirm200；原生一次发送含主/标题两本机请求与44新增内部Credit，分享零增量；同企业无席位reader200、匿名/退出401、只读continuation403。原错误码辅助断言仅对原响应离线修正，未重发/恢复随机凭据；13已知PID/5端口独立收口，retained0700及默认浏览器/剪贴板/安装包边界见 `docs/client-member-sharing-test-2026-10-18.md`。
- [x] G08e 原 Native 成功面板打开同一分享产物，实际应用内 guest/独立 partition/同源 TLS 页与 JS/CSS/匿名 preview401通过；四请求、416px无溢出，分享浏览零模型增量。地址栏后续导航未形成有效证据，登录后阅读/退出仍开放，三原失败及两 followup 如实封存；14已知PID/5端口收口、外部写FD保留0700和软阈值停止见 `docs/client-native-share-browser-test-2026-10-18.md`。
- [x] G08f 原 Native 发布→原打开→同 guest 成员登录/只读阅读→原退出通过，实际 preview401/200/401、logout204；普通 member 无席位、无撤销入口，分享/阅读模型账本与 Trace 零增量。受控 provider、原 TLS callback/Cookie claim各层保持，真实企微排除。五已知PID/五端口收口、私有根0700保留；取证误读隐藏状态文字已补十项回归，详见 `docs/client-native-member-viewer-test-2026-10-18.md`。客户端空身份原登录成功链路仍单列待验，不关闭整体U03。
- [x] G09a 实际企业用量 Panel 的迟到 getView/sync、用户/服务换域、周期退休及 busy 隔离：永久同十场景旧9 RED/冷同步1 PASS→修复10/10 GREEN，首次layout和新B请求不被旧A finally清除均实测；类型/Lint/架构/格式、11既有Gateway回归及正常Desktop构建通过。组件端口交付不替代Native真实注销/网络竞态，详见 `docs/client-gateway-view-delivery-test-2026-10-18.md`。

- [x] G02c 实际企业专家 v1/v2、同 session 冷恢复、撤权后禁止同名个人回退和个人 canonical 选择再撤权：4 项，当前正式 CLI 及相关15项回归通过；修复前实际子模型泄漏个人正文，修复后复测通过。
- [x] G02d Native 指定企业专家真实正文；后台撤权、实际 Electron 重启、侧边栏打开原任务后旧名不可用且0个人子模型；8供应商/8settled含另一成员初始化2。
- [x] G03b 双独立 Host/CLI 共享身份/磁盘的旧选择迟到，以及实际部分 stage SIGKILL→新Host冷恢复当前完整版本：2项131HTTP/4CLI；本机macOS，其他平台保留。
- [x] G06b 正式 CLI 用户/项目 Skill、个人本机MCP、真实identity owner注销：3项352HTTP；正向正文/marker、开关即时撤权、零新增派发且配置字节保留；包含在新产物19项回归中。
- [x] W01 正式 standalone Web/Server 的HTTP/Cookie/静态JS/真实WS与文件重连、Host票据首用/重放/真实30s过期：2项；企业身份实际未配置，不能勾为managed remote。

- [x] G05b 实际CronCreate绑定原task、正式Host runAutomationNow三阶段：允许/关闭local零新增/恢复并重启原task；不替代Main定时scheduler或Native按钮。
- [x] G07b 公共HTTPS WebFetch真实正文与后继模型结果、同runtime精确域名撤权；不改变DNS/TLS/SSRF，不冒领公共站点日志。

- [x] G05c 合法默认createTask无flag首发/实际权限模式元数据/strict历史消息合同三项真实RED窄修；4项单测及默认首发→严格读取→绑定三阶段→重启原消息ID的真实Host复测通过。最终0d958候选相关23项加Host1项共24/24，Native同产物另通过；不据此关闭完整U02/U03/U04/U05。

- [x] G04b 自有 scenes/help/desktop/plugin-store 四类草稿、发布与结构化管理页；Native scenes 暖/冷更新、desktop context/trace、help 关闭及身份撤销已有真实证据。公开商店排序另列，不能据后台配置成功勾为 Native 排序通过。
- [x] G03c 同 Main 原 CDP target 的 owned Host 单次故障→标准 Renderer reload→新 Host 自然恢复；实际配置 false 交付后 trace 零新增。见 `docs/client-native-host-recovery-test-2026-10-18.md`，不冒称自动重启或 UI 恢复按钮。
- [x] G06c 用户范围 Native 技能开关、确认期间撤权、取消及允许删除；见 `docs/client-native-skill-management-test-2026-10-17.md`。copyToCommon/removeFromCommon 当前没有产品 UI caller，归为 Native UI 不适用并保留原 service/FS 证据。
- [x] G06d 项目范围 Native Copy 导入、W1/W2/user 目标隔离、skills/filesystem/dangerousSkills 三门独立撤权、取消及允许删除：10阶段/8真实回读通过，模型/账本零增量。16自有PID/4端口/BH已闭，私有R因系统fileproviderd写FD保留，不冒称根目录已删；见 `docs/client-native-project-skills-test-2026-10-18.md`。
- [x] G04c 指定 Native 登录应用偏好 A/B、真实退出、跳过重开、未配置应用失败与冷恢复；修复旧失败提示残留，新正式产物12阶段/4次实际503通过，11纯测试/23共享UI及完整client gates通过。旧基线与新run各自封存，完整企微/多企业认证仍未验收；见 `docs/client-native-org-preferences-test-2026-10-18.md`。
- [x] G05d 当前 offPeak 关闭时的真实 action 导航、scheduled-only、原空白composer/工作区保留、标准定时模板打开及取消；三次只读任务库与模型/账本零增量，113工件封存。未观察独立eligibility RPC，不替代启用创建或存量ticket/status/settle；清理和保留根目录边界见 `docs/client-native-offpeak-disabled-test-2026-10-18.md`。
- [x] G04d 正式新CLI与真实公开目录46项的Native分类/类内排序：草稿不生效、发布后两mode独立顺序、ghost缺失、搜索对照及null恢复；补修自定义CA移除默认根问题，Source严格TLS与正式单证书目录复测通过。完整12,972文件树、零Native模型/账本增量及13PID/5端口清理边界见 `docs/client-native-public-store-test-2026-10-18.md`；公司/个人空库存、Featured/已安装正向、身份迟到及外部/平台项不冒领。
- [x] G04e 同页真实私有配置 pending 保留P→约10s超时清旧D→正常读取恢复P；退出时关闭新在途读取，恢复传输后63次/31,570ms旧排序无回灌。53条观察记录、11份模型/账本快照零Native增量；含正常scope失效，不冒称独立catch、直接插件版本交付或成功晚到。见 `docs/client-native-configuration-lifecycle-test-2026-10-18.md`。
- [x] G04f 自有插件 Native 12阶段与3代冷启：安装/禁用与label/V2更新/orphan/重添Source/取消不变/确认清全部版本owner/不复活；15完整模型/账本快照零Native增量，设置“浏览插件”导航修复实际通过。34已知PID/5ports独立收口，外部写FD保0700及fixture非优雅边界、运行后out副本漂移另行隔离重建均如实记录；见 `docs/client-native-owned-plugin-test-2026-10-18.md`。不替代官方安装、插件执行、全部Workspace覆盖或三平台安装。
- [x] G07c Native 自有文件正常预览、右键添加到聊天、真实按键移除引用并保留非空草稿；63字节/权限/hash不变，无模型发送。路径由实际绝对文件行、当前工作区和唯一相对mention共同核对，不替代正文进入模型或FS撤权竞态；清理及保留根目录边界见同报告。
