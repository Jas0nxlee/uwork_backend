# 实施任务

## 2026-10-20 当前自动补测进度

- [ ] 真实企微已由用户加入测试：可信IP生效后真实只读API、隔离主库副本两次目录同步、配置/Vault及授权URL/state取消/拒绝已通过；浏览器URL被Computer Use策略拒绝后已停止，不绕过。真实OAuth回调成功、成员会话与Native登录仍未闭环，见 `docs/client-real-wecom-test-2026-10-20.md`。原有企微排除仅为历史范围；外部MCP、网盘仍排除。
- [x] 普通member禁用→恢复→旧token仍拒绝→原退出后新认证→同一Host/profile完整同步再执行：v5五项具名业务、两次供应商/两条本人settled/14 Token/18 Credit、旧owner proof拒绝；默认owner联合回归2/2。隔离email桥接不冒充真实企微或Native按钮，见 `docs/client-member-reauth-recovery-test-2026-10-20.md`。
- [x] Linux普通UID1000原AppImage首实例内部sandbox：真实renderer Seccomp2/filter1、NoNewPrivs1、CapEff0及独立user/PID/net namespace；默认外层seccomp原包明确拒绝无sandbox运行。独立11项核对及资源清理通过；限定v6产物首实例，非新版协议/物理Linux全部验收，见 `docs/client-linux-sandbox-test-2026-10-20.md`。
- [x] 2cd3fb4e阶段Linux异步Main四格式：AppImage/deb与已验原包字节不变，原RPM/pacman顺序单target补产0，独立4格式/20coreSHA/20权限全过；此前禁网及OOM失败保留，YML仅pacman一条不称完整feed/签发。不代替rpm/Arch实际安装、FUSE/GPU，见 `docs/client-linux-native-formats-async-test-2026-10-20.md`。
- [x] R02支持userns环境的Linux系统URI：异步确认修复`2cd3fb4e`，正常新AppImage v16完整11项/21原动作、25.231秒确认并行URI唯一Main55通过；同源原deb UID1000在仅临时允许外层userns下，25.109秒并行URI唯一Main68、取消/允许/零计量及实际purge通过。默认Docker拒绝和上游SUID含空格路径不关闭；v13及v14/v15观察器RED保留，见 `docs/client-second-instance-confirmation-test-2026-10-20.md`、`docs/client-linux-deb-protocol-test-2026-10-20.md`。
- [x] Server CLI原包update三个具名切片：整包生命周期v3七项、候选Core启动失败回滚v1八项、增量与坏组件拒绝/整包fallback v2九项通过。原归档属主`1a0e2c93`和组件manifest原文字节`63121013`两修复正常重建复测；原始产品RED保留。两包均3.16.0，不称跨发行版本；运行任务force、OS注册更新和其他平台不由本项关闭。见 `docs/client-server-update-test-2026-10-20.md`、`docs/client-server-update-rollback-test-2026-10-20.md`、`docs/client-server-component-update-test-2026-10-20.md`。
- [x] Native同挂载Gateway晚到200五项与原60秒session自然expiry六项分别通过：前者真交付后不回灌，后者原owner/store清理、请求abort/drop与原model菜单UCAS清退，模型/账本/Trace0；见 `docs/client-native-gateway-mounted-late200-test-2026-10-20.md`、`docs/client-native-gateway-expiry-test-2026-10-20.md`。
- [x] Native Read真实OS await期间撤权v3六项：同原CLI独占regular-file lease内核等待，原policy发布/Skills原UI false屏障后解锁，Read完成后before_result精确63字节扣留模板，允许对照正文入后继模型；5settled/110Credit、进程/容器/网络/BH/端口闭，见 `docs/client-native-pending-read-test-2026-10-20.md`。
- [x] Server更新状态保持v9六项：原SDK文件/设置/模型与两条正式导入历史，跨旧Core→新Core→原restart同ID/全消息字段一致；原WS自然1001关闭、旧proxy拒绝，原resume同会话，零chat及完整收尾。普通空Task懒持久化与plan兼容映射的前置失败不称产品丢数据，见 `docs/client-server-update-stateful-test-2026-10-20.md`。
- [x] 新产品RED已修复`1db59c77`：v10墙钟回拨导致负elapsed被schema误报sql_failed；局部耗时/锁等待deadline改monotonic，schema/SQL/epoch时间不变。4永久红绿、两peer独立GREEN，新cdf Agent/7774 Server正常构建后v11七项与17独核通过，Root原新AppImage v17完整11项/25.023秒并行协议/两笔44Credit及全部收尾通过。旧失败、旧SHA切片保留，不称cdf四格式/所有Native全量重演；见 `docs/client-sqlite-startup-clock-test-2026-10-20.md`。

以下为此前轮次已完成的具名切片；其测试数量、产物版本及“VM恢复Stopped”均指该轮结束时，不代表当前进程状态或后续改动全已验证。

- [x] 四套旧浏览器 e2e 改由独立 profile/显式 CDP 运行，全部通过，不附着用户 Chrome。
- [x] 同 profile A→退出→B 的真实 Host 模型执行、旧 owner proof 拒绝、双方用量/账本隔离；已打开未读 A 响应在 B 恢复后禁止交付。全量 Gateway 12/12。
- [x] 修复 7 项既有测试设施 Lint 错误，ESM 原生 Enter 驱动三表单与纯协议 4 项复测通过；后端 304/304、夹具 167/167、类型/Lint/架构通过。
- [x] Native B 通过原菜单手选自己的模型并真实发送，核对仅 B 新增计量；15 项原生检查、两调用/44 Credit 仅 B 增加，完整清理 exit 0，见 `docs/client-native-b-execution-test-2026-10-20.md`。
- [x] 当前 macOS ARM64 Preview v2 DMG/ZIP 与最终配置 v3 `.app` 生成并验证签名；修复窗口辅助程序构建架构错误，四项 RED→GREEN 与真实 ARM64 运行通过。该轮只证明生成/签名；包内启动已由下一项另行完成。
- [x] 当前 macOS 包原生运行、真实 Host/CLI 发送、分享发布和复制链接；v3 六项业务及完整清理通过。v2 原剪贴板恢复失败、旧内容无法找回，已清理测试残留并修复守卫；见 `docs/client-packaged-runtime-test-2026-10-20.md`，不抹去事故。
- [x] 启动恢复期间 `--open-workspace` 被默认工作区覆盖：5 项 React 4 RED→5 GREEN，旧/新签名包实际模型与 CLI cwd RED→GREEN；沿原 Main 暂存所有者延后 ready，不新增队列。见 `docs/client-startup-workspace-test-2026-10-20.md`。
- [x] 原生默认浏览器外链：签名包 v4 原菜单→系统默认 Chrome 155，自有页真实请求与原生标签 0→1→0；六项通过、10 个已知进程/5 端口关闭，未访问系统剪贴板。见 `docs/client-default-browser-test-2026-10-20.md`。
- [x] 本机 server-cli OS 服务注册/启停/卸载：原 launchd 六项通过；修复卸载/取消后 stdin 持有导致 CLI 不退出，永久回归 2 RED→3 GREEN、联合 ESM 4/4。原命令重建复测自然 exit 0，精确服务/进程/端口独核闭合。见 `docs/client-server-service-test-2026-10-20.md`。
- [x] Linux ARM64 原 Server 发行包/Node22：发现版本未注入的实际 RED，修复后五项永久回归、macOS 服务六项、Linux 原包八项通过；真实 HTTP/WS/文件/重启/卸载，五组件及归档 SHA 独核一致，容器/卷关闭、专用 VM 恢复 Stopped。见 `docs/client-server-version-test-2026-10-20.md`，不替代 Linux Electron GUI、systemd 或 Windows。
- [x] Linux ARM64 原桌面包实际 Renderer/Main/Host/CLI→后台：七项、15 原动作、本人两调用/44 Credit；原文件预览/重载后重开，撤席位后原发送拒绝且零新增。修正不可用提示的授权检查文案，类型/Lint/架构/格式/正常构建与新包实测通过。128k 上下文拒绝单列，允许用例明确 500k；九组资源独核关闭、VM 恢复 Stopped。见 `docs/client-linux-desktop-test-2026-10-20.md`。
- [x] Linux 原 PTY 与 deb 真实安装/运行/卸载：两组各九项/21 原动作；活 bash/TTY/cwd 和收起重开保活通过。修复本机工具链产生坏 deb 的问题，原 producer 重打有效包；apt/dpkg、系统入口、安装后后台联动及 purge 无包文件/链接残留通过。协议仅注册落盘，真实回调等边界及一次未归因首启超时保留，见 `docs/client-linux-pty-installer-test-2026-10-20.md`。
- [ ] 最终逐能力覆盖审计：区分真实本机通过、正式发行/跨平台缺口、无产品入口和明确排除项。

当前目标保持active，逐项证据与继续入口见 `docs/client-integration-continuation-2026-10-20.md`。真实企微已获准但完整OAuth/Native链路未完成，受阻浏览器页面不绕过；外部MCP、网盘仍不测。不得将上述具名切片合并为“Linux全部通过”或“所有本机功能全部完成”。

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

已完成的本机阶段结果见 `docs/client-local-integration-acceptance-2026-10-19.md`。G04i v5插件正文消费与后续W02断线恢复分别通过具名验收；此前“本机当前可运行独有切片已完成”的概括已撤回，持续按实际入口及证据核对缺口。U02–U05及T13保持原勾选范围，未实现/无入口、缺目标平台与用户排除项另列，不扩大为无穷测试组合。

已完成的持续覆盖子项（不据此勾整个 U02/U03）：

- [x] G04h 全新空身份原Native三epoch通过：七原FirstRun/prelogin全0，原登录/唯一callback/Host claim/guest关闭/自动选模；原主+标题2模型/2本人settled/2Trace/44，后台Key匹配2。同profile冷恢复无新attempt；公司/Gateway exact，原Back→原task→logout后拒发零增量、再冷启保持退出。受控provider/外部与平台边界保留，见 `docs/client-native-primary-login-progress-2026-10-18.md`。

- [x] G07d 正式Read返回前绑定原账号/端口复验，撤权或换人扣留正文，原deadline/取消覆盖不合作授权端口且迟到allow不重复终态；Core119/Host292及标准类型/Lint/格式/架构通过。新正常CLI/Desktop构建后的真实后台+OS五阶段复测，实际11笔账本、55 input/22 output Token、99 Credit，凭据隔离与临时资源收口通过；Native G07c v3/G04h v8已另行完成原界面验收，见 `docs/client-read-result-authorization-test-2026-10-18.md`。

- [x] G04g 真实 React 登录 Provider 在 Native open未决时由poll先认证，之后旧null/ERR_ABORTED均不回退、不cancel/重复close或sync；新2+旧23一次25/25，类型/Lint（113既有警告）/架构/改动格式通过。运行器有限等待、已知进程与未知FD保根合同已修，90进程身份/两端口/两临时根独立收口；正常out6631逐SHA恢复。仅组件端口合同，客户端空身份原生登录已由G04h v8独立完成，详见 `docs/client-enterprise-login-polling-test-2026-10-18.md`。

- [x] G01 真实交互身份、跨企业/issuer 资产缓存、迟到下载、冷恢复及退出：2 项、279 次 HTTP、4 CLI。
- [x] G02a 正式 CLI Agent 子任务继承私有 relay/目录与子派发前席位撤权：2 项及原 5 项回归。
- [x] G02b Native Skill v1→v2→撤权，模型 IO 实证正文/无正文；不替代专家/resume。
- [x] G04a Native 已发布菜单名字/顺序/路由、草稿不生效、欢迎/risk 发布与退出清除；延迟真实配置响应后旧可见菜单点击也被当前准入拒绝。
- [x] G04j 原Native自有包安装→已发布卡mention＋prompt→原User禁用/Back→同卡纯prompt/mention0，两phase八click通过；每卡前后测试源HTTP不变，Native模型/账本/Trace/Token/Credit增量0，console0/script0。六动作合同/四包服务合同与BH absence反例1/1通过，六已知PID/五端口/BH socket独立收口、私有根保留，见 `docs/client-native-installed-plugin-suggestion-test-2026-10-19.md`。安装setup与G04f/G04i原验收分列，不声称官方市场/任意插件。

- [ ] G04k 同profile原A登录→退出→选择登录应用B→重新认证成功，实际身份/模型目录/配置/权限/本人用量隔离；双tenant、两个普通member和各自唯一callback/nonce绑定。v9已真实复现退出后原菜单仍有1个可选A旧候选；[本轮已修复并在真实后台/身份/Gateway/Writer/Registry上取得双向有效RED与GREEN](client-g04k-catalog-revocation-test-2026-10-19.md)，六产物按正常命令重建、受影响9个smoke共49项通过。[真实Electron原生渲染层](client-g04k-native-cdp-verification-2026-10-19.md)已补A登录→原退出→原菜单普查→B重认证：修复前复现G04K_CATALOG_STALE、修复后退出态菜单为空且B仅得自有可选模型，两轮0模型调用；该CDP探针不是受审的source-lock/Go/actor流程，正式验收层未勾选。178公开文件/五PID/四端口/BH独核闭合，计量零增量。仅已有产品路径，不增加热切UI；受控IdP及预置用量须分列，不声称真实企微或新增模型计费。
- [x] G05a Native 自动化创建/立即运行、local 渠道拒绝、实际重启后持久化再运行；不替代绑定任务 resume。
- [x] G03a 缓存正文篡改/缺文件/symlink：3 项、315 次 HTTP、9 CLI；冷启动不静默修复，显式隔离后恢复；双 Host/安装 SIGKILL 实际组合已由 G03b 补完。
- [x] G06a Native 个人模型创建/配置/发现/实际运行与同会话撤权，拒绝不改配置或派发；两条误导/内部码提示修复并重建复测。个人技能/本机 MCP 的实际 CLI 出口已由 G06b 补完，Native 设置界面另列。
- [x] G07a 正式 builtin Read/Write/Bash 真实副作用与批准/Hook/yolo 后撤权：5 项及原 7 项回归；WebFetch 实证域名和 SSRF 拒绝，不冒领公网成功。
- [x] G08a 实际 Host 分享/生产文件源/自动 manifest/hash/上传确认/网络席位组织撤权：5 项、299 次 HTTP、26 既有回归；正式外部服务/Native 分享 UI另列。
- [x] G08b 按用户决定补齐企业成员只读分享后端、私有 Host 传输与同源浏览页；301 后端/49 客户端/3 跨仓真实 HTTP 通过，浏览器五阶段真实 Cookie、两下载、跨企业/退出/撤销拒绝及四宽度通过。受控企微替身、签名安装包和三平台边界保留；Native 发布已由 G08d 另验，主服务恢复与新部署单独记于 `docs/local-backend-recovery-2026-10-18.md`，不据此关闭 U03。
- [x] G08c 实际 Header/IdentityProvider/ShareMenu 浏览器回归复现旧 OAuth 入口门槛 4 项失败，单组件修复后同 8 场景通过；覆盖当前企业认证、退出、owner 切换、残留旧 user、任务及 Desktop 约束与无 context 兼容。类型/Lint/架构/严格 fixture 类型及新正常 Desktop 构建通过；实际 Native 发布已由 G08d 另行验收。
- [x] G08d 实际 Electron 生产构建正常会话→原 ShareService/CLI 投影/私有 scope→后端 confirmed1/三公开行，prepare201/confirm200；原生一次发送含主/标题两本机请求与44新增内部Credit，分享零增量；同企业无席位reader200、匿名/退出401、只读continuation403。原错误码辅助断言仅对原响应离线修正，未重发/恢复随机凭据；13已知PID/5端口独立收口，retained0700及默认浏览器/剪贴板/安装包边界见 `docs/client-member-sharing-test-2026-10-18.md`。
- [x] G08e 原 Native 成功面板打开同一分享产物，实际应用内 guest/独立 partition/同源 TLS 页与 JS/CSS/匿名 preview401通过；四请求、416px无溢出，分享浏览零模型增量。本G08e阶段的地址栏后续导航未形成有效证据，未取得登录后阅读/退出；后续G08f已补齐同guest成员链，三原失败及两followup仍按历史范围封存；14已知PID/5端口收口、外部写FD保留0700和软阈值停止见 `docs/client-native-share-browser-test-2026-10-18.md`。
- [x] G08f 原 Native 发布→原打开→同 guest 成员登录/只读阅读→原退出通过，实际 preview401/200/401、logout204；普通 member 无席位、无撤销入口，分享/阅读模型账本与 Trace 零增量。受控 provider、原 TLS callback/Cookie claim各层保持，真实企微排除。五已知PID/五端口收口、私有根0700保留；取证误读隐藏状态文字已补十项回归，详见 `docs/client-native-member-viewer-test-2026-10-18.md`。客户端空身份原登录成功链路由G04h v8单列完成，不关闭整体U03。
- [x] G09a 实际企业用量 Panel 的迟到 getView/sync、用户/服务换域、周期退休及 busy 隔离：永久同十场景旧9 RED/冷同步1 PASS→修复10/10 GREEN，首次layout和新B请求不被旧A finally清除均实测；类型/Lint/架构/格式、11既有Gateway回归及正常Desktop构建通过。组件端口交付不替代Native真实注销/网络竞态，详见 `docs/client-gateway-view-delivery-test-2026-10-18.md`。
- [x] G09b 原Native刷新真实usage200在途→原Back卸载设置→原退出实际abort/drop→匿名原设置重开；旧资料/额度/用量无回灌，Native模型/账本/Trace/Credit增量0，console0/script0。7项stream夹具＋2项modal驱动合同通过；五已知PID/四端口/BH socket独立收口，Common close超时与Root精准终止分列，根保留，详见 `docs/client-native-gateway-usage-logout-test-2026-10-19.md`。不冒称同挂载面板迟到成功。

- [x] G02c 实际企业专家 v1/v2、同 session 冷恢复、撤权后禁止同名个人回退和个人 canonical 选择再撤权：4 项，当前正式 CLI 及相关15项回归通过；修复前实际子模型泄漏个人正文，修复后复测通过。
- [x] G02d Native 指定企业专家真实正文；后台撤权、实际 Electron 重启、侧边栏打开原任务后旧名不可用且0个人子模型；8供应商/8settled含另一成员初始化2。
- [x] G03b 双独立 Host/CLI 共享身份/磁盘的旧选择迟到，以及实际部分 stage SIGKILL→新Host冷恢复当前完整版本：2项131HTTP/4CLI；本机macOS，其他平台保留。
- [x] G06b 正式 CLI 用户/项目 Skill、个人本机MCP、真实identity owner注销：3项352HTTP；正向正文/marker、开关即时撤权、零新增派发且配置字节保留；包含在新产物19项回归中。
- [x] W01 正式 standalone Web/Server 的HTTP/Cookie/静态JS/真实WS与文件重连、Host票据首用/重放/真实30s过期：2项；企业身份实际未配置，不能勾为managed remote。
- [x] W02 成功连接后断线的原RPC/浏览器RED→修复RPC/UI关闭与恢复工作区Hook序列；42项相关回归、完整门禁及正常Server/Web/Desktop构建通过。v4真实断线、四宽、Tab/Enter原Retry、新document/Cookie/项目/文件恢复通过，console0/script0；三UI driver0，controller1仅为FD不完整保根，已知PID/端口独立核对关闭，见 `docs/client-web-disconnect-recovery-test-2026-10-19.md`。不替代Native交互或Web企业认证。

- [x] G05b 实际CronCreate绑定原task、正式Host runAutomationNow三阶段：允许/关闭local零新增/恢复并重启原task；不替代Main定时scheduler或Native按钮。
- [x] G07b 公共HTTPS WebFetch真实正文与后继模型结果、同runtime精确域名撤权；不改变DNS/TLS/SSRF，不冒领公共站点日志。

- [x] G05c 合法默认createTask无flag首发/实际权限模式元数据/strict历史消息合同三项真实RED窄修；4项单测及默认首发→严格读取→绑定三阶段→重启原消息ID的真实Host复测通过。最终0d958候选相关23项加Host1项共24/24，Native同产物另通过；不据此关闭完整U02/U03/U04/U05。

- [x] G04b 自有 scenes/help/desktop/plugin-store 四类草稿、发布与结构化管理页；Native scenes 暖/冷更新、desktop context/trace、help 关闭及身份撤销已有真实证据。公开商店排序另列，不能据后台配置成功勾为 Native 排序通过。
- [x] G03c 同 Main 原 CDP target 的 owned Host 单次故障→标准 Renderer reload→新 Host 自然恢复；实际配置 false 交付后 trace 零新增。见 `docs/client-native-host-recovery-test-2026-10-18.md`，不冒称自动重启或 UI 恢复按钮。
- [x] G06c 用户范围 Native 技能开关、确认期间撤权、取消及允许删除；见 `docs/client-native-skill-management-test-2026-10-17.md`。copyToCommon/removeFromCommon 当前没有产品 UI caller，归为 Native UI 不适用并保留原 service/FS 证据。
- [x] G06d 项目范围 Native Copy 导入、W1/W2/user 目标隔离、skills/filesystem/dangerousSkills 三门独立撤权、取消及允许删除：10阶段/8真实回读通过，模型/账本零增量。16自有PID/4端口/BH已闭，私有R因系统fileproviderd写FD保留，不冒称根目录已删；见 `docs/client-native-project-skills-test-2026-10-18.md`。
- [x] G04c 指定 Native 登录应用偏好 A/B、真实退出、跳过重开、未配置应用失败与冷恢复；修复旧失败提示残留，新正式产物12阶段/4次实际503通过，11纯测试/23共享UI及完整client gates通过。旧基线与新run各自封存，完整企微/多企业认证仍未验收；见 `docs/client-native-org-preferences-test-2026-10-18.md`。
- [x] G05d 当前 offPeak 关闭时的真实 action 导航、scheduled-only、原空白composer/工作区保留、标准定时模板打开及取消；三次只读任务库与模型/账本零增量，113工件封存。未观察独立eligibility RPC，不替代启用创建或存量ticket/status/settle；清理和保留根目录边界见 `docs/client-native-offpeak-disabled-test-2026-10-18.md`。
- [x] G05e 自动化自身暂停后的真实到期：原 Host 暂停→同一完整 Main/scheduler 跨原 due 后 45.318 秒无 run/派发/模型/账本增量→恢复消费同一原 due、绑定原 task 且恰一条成功 run/settled。v5已独核11公开文件、20已知PID/3端口收口；受控身份与supplier、原Native按钮边界见[报告](../docs/client-automation-paused-due-test-2026-10-19.md)。
- [x] G05e1 原 Native 自动化暂停／恢复按钮及删除确认／取消实际点击；不以 G05e 的 Host RPC 代替。[本轮CDP探针](client-native-automation-buttons-test-2026-10-19.md)在真实Electron原页面完成手动创建（自定义每1分钟排期）→暂停→恢复→再暂停→跨过真实到期（到期58.1s、等待70.1s，零派发零模型调用）→删除取消→删除确认，每步同时核对只读持久化（enabled/lifecycle/run_count/dispatch_status）。13项检查、23个原界面动作通过；受审Go/actor流程与Root独立复核未执行。
- [x] G05f 原 Native 全局工作流组→“运行于”选择已打开项目→实际模型 cwd 与历史 run.cwd 匹配→当前 filesystem 撤权拒绝。沿现有开发入口，不代替正式安装包的灰度来源验收。[本轮CDP探针](client-native-global-workflow-cwd-test-2026-10-19.md)在真实Electron完成：原会话创建→受控SaveWorkflow→原权限允许→项目档落盘→原「提升为全局」会话路径→全局组→原启动对话框“运行于”选已打开项目→运行；实际模型cwd（请求里的Primary working directory）与运行历史run.cwd（行title）逐字一致，撤权后同入口报工作流启动失败enterprise_filesystem_denied。16项检查、29个原界面动作通过；受审Go/actor流程与Root独立复核未执行。
- [x] G04d 正式新CLI与真实公开目录46项的Native分类/类内排序：草稿不生效、发布后两mode独立顺序、ghost缺失、搜索对照及null恢复；补修自定义CA移除默认根问题，Source严格TLS与正式单证书目录复测通过。完整12,972文件树、零Native模型/账本增量及13PID/5端口清理边界见 `docs/client-native-public-store-test-2026-10-18.md`；公司/个人空库存、Featured/已安装正向、身份迟到及外部/平台项不冒领。
- [x] G04e 同页真实私有配置 pending 保留P→约10s超时清旧D→正常读取恢复P；退出时关闭新在途读取，恢复传输后63次/31,570ms旧排序无回灌。53条观察记录、11份模型/账本快照零Native增量；含正常scope失效，不冒称独立catch、直接插件版本交付或成功晚到。见 `docs/client-native-configuration-lifecycle-test-2026-10-18.md`。
- [x] G04f 自有插件 Native 12阶段与3代冷启：安装/禁用与label/V2更新/orphan/重添Source/取消不变/确认清全部版本owner/不复活；15完整模型/账本快照零Native增量，设置“浏览插件”导航修复实际通过。34已知PID/5ports独立收口，外部写FD保0700及fixture非优雅边界、运行后out副本漂移另行隔离重建均如实记录；见 `docs/client-native-owned-plugin-test-2026-10-18.md`。不替代官方安装、插件执行、全部Workspace覆盖或三平台安装。
- [x] G07c Native文件预览/添加/移除原范围保留；v3另经原mention→返回任务→发送，A指定Read call带行号正文进入后继模型（3Native/66），同task B在FS=false发布回读后Read拒绝且新B marker缺失（新增2Native/44）。Native5请求/5settled/5Trace/110，另2B/44基线分列；69公开文件及资源终态封存。发送前撤权不冒充OS Read等待中撤权，见 `docs/client-native-file-context-test-2026-10-19.md`。
- [ ] G07e 原Composer本机附件→真实NSOpenPanel→独立附件正文消费的企业filesystem准入。**消费链路已实测（文本/图片/视频/PDF × 允许/撤销，19项检查）**：[报告](client-native-attachment-admission-test-2026-10-19.md)；允许态正文与图片/视频/PDF媒体分支均按filesystem准入交付，撤销态仅占位点名路径、正文与媒体载荷0次；已源码核对走专用prompt-attachment消费者而非builtin Read。**NSOpenPanel打开已实测**（WindowServer观测：原菜单项「附件」后同进程新增880×448 sheet，拆解后0窗口）；**面板交互驱动已就绪并实测拒绝路径**：`--phase panel-interaction` 用 `CGPreflightPostEventAccess()` 前置检查（本轮 false→一次按键未发、状态blocked）、每批按键前比对最前台layer-0窗口属主PID与owned Electron、按键经 `CGEventPostToPid` 定向、允许/拒绝/取消三种序列与断言均已实现；**面板内交互已于 2026-10-20 实测通过（AX 元素动作驱动）**：[报告](client-native-panel-interaction-test-2026-10-20.md)。本机辅助功能授权已生效（`CGPreflightPostEventAccess()=True`、`AXIsProcessTrusted()=1`，责任进程 `UWork`）；真实面板 = 属主夹具 Electron 的 `AXWindow "打开"`（frame 与 WindowServer 逐字一致）。cancel 由 AXPress 真实「取消」完成（chip 0）；deny/allow 由 AX 写入 sheet 路径字段（settable=true、code 0、回读一致）→ 导航到目标目录（导航后 AX 树列出该工作区 8 个测试文件）→ 对真实文件行 AXConfirm（code 0，mode=row-action）交付附件；deny 正文 0 次进入模型请求，allow 第 4 条请求命中正文 marker。14 项检查全过；journal 逐动作记录代码与窗口数，未生效的 AX 动作（AXConfirm/AXPress 关闭 sheet 失败、行 AXOpen -25205）如实保留。探针侧修掉两处缺陷（猜测坐标点击误点到侧栏、提交序列从不复按 Return），**无产品改动、未重建产物**。仍保留：GoTo 打开需一次真实 `Cmd+Shift+G`（PID 定向实测不能到达 AppKit 面板）、该面板 `AXDocument` 不可读/不可设、行 `AXOpen` 不支持；本结果不是受审 source-lock/Go/actor 流程也无 Root 独立复核，**正式验收层仍不勾**。

- [x] Standalone Web v8在Electron41内嵌Chromium完成11项原DOM业务，含Cookie/FirstRun/目录/文件预览/reload恢复；uiDriver0、275已知PID/2ports闭。controller1为FD不完整保根，旧Chrome超时/未知根因保留，不冒称Chrome、自动reconnect或Web企业认证；见 `docs/client-web-standalone-dom-test-2026-10-19.md`。

- [x] G04i v5普通member经原PluginManagementService/正常新CLI完成非默认manifest根三文件、D/S禁启catalog及别名；同S A正文/baseDirectory进入后继模型，personal.skills=false后未消费B拒绝且无B正文，恢复目录零额外模型。baseline0、原发送2次，5模型/5settled/5Trace、25 input/10 output、45 Credit，request↔ledger真实复合键关联，Trace/supplier独立；v1–v4零模型失败保留，不重演G04f Native生命周期，见 `docs/client-plugin-skill-bridge-test-2026-10-19.md`。

- [x] W03 原server-cli前台serve/status/restart/stop与Supervisor/Core真实生命周期：ESM builtin加载真实RED1→GREEN1，五门禁/五正常构建0；v3七事件、同root重复serve拒绝、Core换代及新WS File/System哨兵通过。原PTY exit0、30子句柄实际closed，Root独核33已知PID/两端口/control socket闭且FD0，私有根保留；v1守卫误报与v2启动失败历史不改。不含Cookie/企业authority、daemon/OS服务、Node22或跨平台，见[W03报告](../docs/client-server-cli-lifecycle-test-2026-10-19.md)。

- [x] W04 原serve --daemon显式跳过OS注册的detached fallback：启动CLI真实exit0后Supervisor仍存活，Core PPID/PGID、birth/cwd/listener/control socket绑定；原status、SocketProtocol File/System哨兵和唯一stop通过。2.715s/四事件、原PTY66321 exit0、23子句柄实际closed，Root独核共26已知PID/端口/socket闭，原FD0、0700根保留；未观察中间reparent、不编detached直接exitCode。不扩OS service/install/enterprise/模型，见[W04报告](../docs/client-server-cli-detached-fallback-test-2026-10-19.md)。

- [x] Mac已注册launchd Server同版构建更新：profile隔离真实RED→`a53f8930`修复；原八项/Root十六项通过，File/Setting/原import历史同ID全字段跨update/restart保持、原1001、停止/双确认卸载、8PID5port闭合；自有disabled metadata实报，见[报告](../docs/client-macos-server-service-update-test-2026-10-20.md)。
- [x] Linux原用户systemd：正常新3b50/cdf原包，原七项与独立peer通过，File/Setting、重启恢复、12s停止与双确认卸载，unit/链接/4PID2port/socket闭合；owned scratch另清理。首轮symlink guard驱动FAILED保留，见[报告](../docs/client-linux-systemd-service-test-2026-10-20.md)。
- [x] 最新Mac原包主联动切片：`263146f4`修复reload覆盖项目后，正常v6原包Native七项、Root十六项与独立peer二十六项通过；文件/刷新恢复、真实PTY/cwd/收起重开、本人两次模型调用/44 Credit与他人账本不变、撤席位配置403零新增、原UI退出与同profile冷启清身份均通过。资源闭合，见[报告](../docs/client-macos-clock-integration-test-2026-10-20.md)。受控模型上下文500000为正例，不称实际token超过128k；此项不代替Mac全部功能。
- [x] RPM卸载修复具名切片：原DNF remove0但alternatives悬链/空目录残留已真实复现；`220ba514`窄修原RPM模板，新正常原包经真实同版DNF重装→卸载通过，四系统路径与原包非目录文件消失，Root十三项独核；见[报告](../docs/client-linux-rpm-uninstall-fix-test-2026-10-20.md)。不是新版本升级或全新安装GUI重演。
- [x] Arch原pacman安装消费/独立卸载：扩盘后同冻结context复用CACHED正常export/unpack0，原DB与五core/公开权限通过，same-image独立clone原pacman-R0/包查询1/四系统路径全无，用户MIME注册保留单列。Root与业务证据合并独核二十二项，见[报告](../docs/client-linux-distro-lifecycle-test-2026-10-20.md)。
- [ ] Fedora/RPM与Arch/pacman完整GUI/系统URI：Fedora十项、Arch独立业务十一项及原reload诊断十项具名实际通过，二者原xdg-open均exit3，原generic错误截断合法含空格Exec，整组仍FAILED。Arch business显式省略reload；另唯一诊断本轮38个live样本无OOM、原reload与CDP均成功，不代表已修历史v2/Fedora v3间歇失联。原sandbox与资源闭合分别留证，不相加当单轮全通过。
- [x] Mac原运行中单实例长确认与并发第二入口：`1bd1ec7b`修复后正常v7原包fresh v5四项Native/Root二十二项通过；原NSAlert停留25.414s、第三URI与取消/确认三个二实例自然exit0、27样本唯一原Main；原AX取消保基线、原AX确认才开中文空格目录，模型/本人/他人账本零增量，fixture/BH/PID/四端口/原handler闭合。旧传输RED及v1/v3/v4设施失败保留；不代替cold无父窗口或系统全局scheme分发，见[报告](../docs/client-macos-second-instance-test-2026-10-20.md)。
- [ ] 原Native SSH目录浏览/取消/再连未完成：发布目录前必经远程Provider initialSync，属历史安全审查已拒绝运行边界，停止后续GUI，不裁屏障/mock/换工具；[部分证据报告](../docs/client-native-remote-selector-test-2026-10-20.md)保留真实认证/部署和准确FAILED，非managed authority验收。

- [x] 历史 Mac x64 v8/v7 失败已收口：原1/7、secondary10s/KILL与关闭证据保留；后续0aeff9/v11独立副实例已自然退出，完整30秒/七项在下方另列open。不再启动旧短栈方案或把其当当前待执行。
- [x] matching1a8 Linux原AppImage v8完整11项+strict UI fit及Root20项独核通过：same shell9x136→8x108→9x136、2/2/44内部Credit、撤席位/协议零增量、25.105s原确认和第三URI唯一Main、实际中文目录与精确资源闭合；旧v3 Error原因另开，不外推其他格式/物理平台。

- [x] Linux Desktop PTY ABI源修复：原包三参/五参真实RED，匹配1.1真实同shell两次stty通过；`1a8f24cb`及24项/必要门禁通过，原CDF保持。
- [x] matching1a8 Linux原AppImage v8完整11项+strict UI fit及Root20项独核通过：same shell9x136→8x108→9x136、2/2/44内部Credit、撤席位/协议零增量、25.105s原确认和第三URI唯一Main、实际中文目录与精确资源闭合；旧v3 Error原因另开，不外推其他格式/物理平台。
- [x] Server同根PTY资产修复a1a924fc及正常Darwin4665/Linuxf55d原SDK各6项通过，Root13/17独核：NEW初始与原update后真实两stty、原FileSetting持久、旧Linux精确Usage RED、stop12s/双DELETE/7PID4port及容器卷闭合；不宣活跃PTY迁移或OS服务更新。
- [x] 历史 Mac x64 v5/v6 原失败保留，后续当前v11结果另列；owner失效守卫与原secondary预算未削弱。

- [x] Server JS/native源/锁修复独立审查与原子提交a1a924fc；12文件源SHA稳定，完整门禁/49test/实际frozen install通过，新归档和SDK继续。
- [ ] 历史Linux v3 Error/CDP超时原因未定位：v8原完整业务通过不把旧失败改绿，不直接推断Main退出/OOM或源码根因；原失败及关闭证据保留。
- [x] 历史 Mac x64 v8 FAILED1/7与sample0B已保留收口；后续取得有效CPU/固定phase与修复证据。当前未闭的是v11原30秒/完整七项，不重开无效sample。
- [x] 本轮Root测试设施Lint10项已真实ESM/模板迁移修复，原Node22/24九合同及Root复跑九项通过、完整typecheck/lint0，未加suppression/放宽规则；生产12SHA稳定，历史输入未改。

- [x] Mac x64固定阶段日志d0a已完成、正常v9包并实际取到v6原false/quit-return/超时事实；日志本身不当退出成功。后续0aeff9修复与具名v11诊断另列。

- [ ] 最高优先：Mac ARM64真实客户端↔后端身份/配置权限/工作区任务/执行和用量协同一致性；原包/有限矩阵/后端权威快照三线并行，Windows后排。
- [x] Linux客户端已停止新增测试，当前证据保留；历史Error与R05未执行准备不再驱动当前补测。不把“然后其他”解释为自动恢复Linux范围。
- [x] x64 v9 startup-v1前缀设施失败已保留并在fresh v2修正入口实际守卫；未放宽共享guard。v2另有真实30秒renderer失败，不把前置修正写产品通过。

- [x] Mac优先第一项：最新正常ARM64 v10 consistency-v1原8项/Root21项通过；仍登录同已完成task原UI冷恢复、消息/model/reasoning/workspace语义不变、实际POST4→4及供应商/本人和他人账本TraceGateway逐集合零增量，原TERM自然0/noKILL，25PID4port/三BH/OS恢复；不称重启后新执行或全Mac完成。

- [x] Mac优先第二项：同ID工具能力true→false→true，正常v10 capability-v1原8/Root33/peer48通过；原UI同步三证→两新task，实际主32→两个tool属性缺省→32；当前2/44→4/88→6/132、原账/他人不变，18known+2BH/4port闭。仅新任务能力消费，不宣称旧任务热迁移。
- [x] Mac同挂载Gateway401退休后旧200成功交付已由mounted-v1原5/Root24/peer28通过，原loader/身份边界不变。同成员Native重新认证仍另列open。

- [x] Mac第三项：v10 mounted-v1同挂载401退休→旧200真实成功finish973ms、六即时样本无回灌，原5/Root24/peer28，双actor账务与raw/supplier2零增，10PID4port/socket闭；不是Back卸载/abort/drop或自然TTL。
- [x] Mac自然TTL mounted-v2已实际原6/Root27/peer29通过，原内部issuer60000/GETme/store/timer+signal/abortdrop；不是公开TTL设置或UI重认证。

- [x] Mac第四项自然TTL：v10 mounted-v2原6/Root27/peer29；真实原issuer60000→me/store同expiresAt→原timer revision1→2/null/expiry+4ms abort→release不投递，6匿名样本/UCAS0、账本0delta，10PID4port闭。非公开TTL设置或UI重新认证。
- [x] Mac第五项原生已安装插件正文：plugin-skill-v1原4/Root29/peer37，原User安装/详情root→同call_id完整440B toolresult进后继request、117/140B文件SHA，current3/66、other不变、14PID4port闭。
- [x] Mac x64旧10s失败已由v9诊断v6取得false/quit-return后原超时事实；0aeff9修复在新v11独立v7原10s一次自然exit0通过。旧所有失败与原1c保留，原7/30仍另列未过。
- [ ] Windows真实主机入口未找到，已一次性询问授权测试机/已有连接入口；静态合同/资源及执行计划继续，不将Mac或PE检查冒称WinNative通过。
- [x] Mac x64正确profile v2真实运行及失败收口：原renderer30秒超时、0业务/0UI/未到secondary，主Main原固定phase取得锁；6PID/4TCP关闭、原OS恢复，原失败与20项独立失败收口证据保留。
- [x] Mac x64 CPU v3设施失败已保留；fresh v5完整30.001秒采集通过，case90/20收尾不变，private profile有效；只诊断不当原7验收。
- [x] Mac x64 CPU实际证据v5：v3 TLA/v4 handler绑定两原设施失败保留；真实采集30.001秒、总38.712秒，profile1534194B/0600及peer25，6PID5port/40源稳定、双actor/raw/supplier零增。首窗口创建/加载约9.526秒，尚无可直接修产品的充分因果。
- [x] Mac x64原副实例v6诊断已执行并保原10s FAILED/26独核；case120/20/primary<=60只诊断。后续v11v7自然退出通过，不回填原30/7失败。

- [x] 副实例最小修复0aeff9（5文件）已file-scoped提交，Root75相关tests+4fallback/19actualMain、full typecheck/lint114warnings0errors/architecture/format与fresh五轴审查通过；两新正常包及独立静态验收完成。
- [x] 最新ARM64 v12原7/7+独立29/29真实联测通过；拒锁自然exit0与原UI workspace转发、文件/reload、CLI/PTY/cwd、本人2/44和他人隔离、撤席位零增、注销cold均过，19known+2BH/4TCP/UNIX闭。
- [x] 新x64 v11独立secondary v7原1c/10s一次自然exit0、false阶段/内核身份/Main同代与双actor全行/raw/supplier零增证明，7PID4TCP/42源/OS闭；不等于ACK/UI或原7。
- [x] 历史 x64 v11原7首跑0/7：原30秒file renderer就绪超时，未到AX/BH/副实例/业务；6PID4TCP/32源/OS闭。原失败保留，当前v14单列，不能用后续诊断回填历史验收。
- [ ] 有限环境缺口继续分列：同成员Native重认证无现成合法受控IdP、Mac OS-read真实等待后撤权缺平台阻塞入口；Windows真实测试机入口未提供。原排除/安全边界保持，不声称整体全覆盖。

- [x] Mac 新有限切片1：Main PGID SIGKILL后同任务零重放恢复及原UI新任务，consistency-v5原9/Root30/peer32通过；v2/v3设施原失败保留，详见 `docs/client-macos-crash-task-consistency-test-2026-10-21.md`。
- [x] Mac 新有限切片3：Native Share 一件真实PDF，原7/Root27/peer15通过，详见下方具名证据。
- [ ] Mac 新有限切片2：原应用活动任务 Quit 取消/确认，v4当前前台条件受锁屏限制，未发出Quit/取消/确认；不绕过锁屏。
- [x] 正常包元数据：spec/实际hook RED→GREEN，窄修原子提交f4cac913（5文件），22相关tests及必要门禁通过；正常ARM64 v13/x64 v14真实header、Info、manifest一致，strict签名及原fuse保持。旧包/旧失败未改，不推断旧启动根因。

- [x] Mac ARM64 v12 真Main SIGKILL观察：consistency-v4原暖5+新增观察1通过，Root18独核；旧Host/两个独立CLI/PTY全消失、无补杀，raw/supplier4及双actor全行2/44不变，14PID4TCP/OS闭。只关闭强杀收尾，不冒恢复/新执行；v2/v3取证设施原失败保留。

- [x] Native原分享一件真实PDF：正常ARM64 v12 share-artifact-v1原切片7项/Root27通过，606B四方SHA、原prepare201/upload201/confirm200、full双actor/raw/supplier零增，原DELETE后BLOB0/JSON清空/404，14PID4TCP/OS闭。只关闭单件PDF，不外推全部附件格式/外部viewer/UI撤销。

- [x] Mac ARM64 v12完整强杀恢复与新执行：consistency-v5原7+新2共9/Root30/peer32通过；A同UI/语义零重放、新B实际+2settled44、旧A/other全行保持，新CLI38888 kernel/cwd/DBFD绑定，原撤席/注销第三代cold继续过；27known+3BH/4TCP/OS闭，63源稳。
- [x] 正常ARM64 v13元数据修复新包原7/7及独立31项真实通过：原UI/文件reload/CLI/PTY/cwd/用量/撤席位/注销cold均过，38测试源和33打包源保持，21PID/4TCP/UNIX/OS闭。
- [ ] 正常x64 v14原30秒门限29.894秒进入页面，随后Owned AX attribute failed，0/7且未到BH/secondary/业务；6PID4TCP闭。v9/v10只读AX诊断已完成且不回填原七项：v10窗口项CFEqual应用根，未获可验真实窗口，不盲改helper/忽略提示。v8设施原失败保留，v9/v10各6PID4TCP/OS及双方全行零增收口。
- [x] Mac原UI Memory关闭→开启→再关闭三新任务：正常v13 memory-v2实际8项/33.263s通过；独立原始主请求4/6/8连续记忆正文0/1/0、标题5/7/9独分，current8/176及other2/44全行隔离，原撤seat/logoutcold继续过，19known+2BH/4TCP/OS闭。v1缺hashlib测试设施FAIL5保留，实际片段RED/GREEN及全局依赖合同已补；不代自动提取写回。
- [ ] Mac自动Memory提取→原Write写入index/topic、memoryRoot外本case文件拒绝→下一原UI新任务消费，现有功能已定位，独立新切片准备中；无未测提前通过。

- 2026-10-21 用户最新范围：只验收 Mac；Windows 真实联测取消，不再作为当前目标阻塞。Linux 客户端不再追加；发布由用户使用 GitHub Actions，本轮未要求发布。

- [x] Mac Memory 自动加载遵守后台 filesystem=false：v13 显式策略真实 RED；500914df 原子修复及29项 Runtime/502项企业策略回归通过，正常 v15 四步完整重建；v4 Native 6/6 GREEN，body/header扣留、普通请求及账务保留。
- [x] Mac Memory filesystem=true 自动提取/原工具写入/跨任务 index 消费：v15 Auto v2真实8/8通过，原调度2sidecars/两份真实写入+owned root外拒绝/新任务索引消费；自己8call/176 Credit、他人全行不变，原seat/logout/cold和cleanup[]；Root已复核raw/files，独核报告整理中。
- [ ] Mac 消息编辑重跑与 assistant fork：真实入口已确认，独立薄控制器准备中，未以纯测试代替 Native 验收。

- [x] Mac 消息编辑重跑/fork/child续问/reload：v15 message v3真实8/8通过，raw4→5→5→6→6；完整active分支/clone语义与IDs、parent保持/双actor账务/原7tail收口；独核完成，前两次设施FAIL保留。
- [x] Mac 同task archive/unarchive/reload：v15 archive v1真实8/8通过，原六阶段tasks-index归档位0→1→0、CLI历史/model/cwd保持，所有阶段推理/账务零增；独核待整理。
- [ ] Mac 自动提取 manifest 的 filesystem 策略：独立source审计确认topic description未经准入进首sidecar，真实Runtime12项=3正控PASS/9RED；正在准备正常v15显式false/三词新task Native RED，未改该产品路径。

## 2026-10-21 编译发布前真实联动目标（取代平台优先级）

- [x] 按最新用户范围：只继续共享前端/开发运行时与后端联动，发布后多系统客户端交由 GitHub Actions；外部 MCP、网盘不测，真实企微纳入。
- [x] 忙任务原 Composer A 暂挂→B 入队删除→C 入队执行；原请求/本人账务/另一成员隔离通过。
- [x] 原归档任务删除取消/确认/reload、tombstone与保留CLI历史、零新增推理和账务通过。
- [x] 真实复现并修复共享确认框取消焦点 Enter 误删除；v8/v9真实联测通过。
- [x] 修复主渲染帧先销毁导致退出状态IPC报错；源码RED/GREEN、13项关联回归及v9真实退出通过。
- [x] Desktop Main独立类型检查83条错误已清零；44371033把Main严格检查纳入默认根typecheck，新增边界回归通过。
- [x] task-index syncer异步退订与Agent销毁顺序：5cab2ccb修复，3项回归及v10/v11真实关闭通过，原8条警告降为0。
- [ ] 真实企微当前可信IP60020；当前已登录管理台无配置应用。原URL/state/取消/旧会话拒绝通过，真实回调/前端成员登录未完成，不绕过既有自动操作策略拒绝。

详见 `docs/prepublish-integration-progress-2026-10-21.md`，本轮不以累计测试执行数代替独立功能全覆盖。

- [x] 编译前原回复点赞/点踩/清除与三次reload：v11共7阶段CLI持久值一致，原消息ID保持、请求/双方账务零增；原队列和删除回归仍过。
- [x] 编译前任务侧栏重命名/置顶/检索：b52afcc8修复置顶元数据导致重复行，v15原12状态/标题正文检索/未读清除及零推理计费通过。

本轮补充证据见 `docs/prepublish-integration-continuation-2026-10-21.md`。真实企微60020和授权回调边界仍开放，目标active。

- [x] 编译前批量归档删除：v20原两子任务取消/确认/reload、父任务保持和历史保留、零推理计费通过；v16–v19设施假设失败保留。
- [x] 2026-10-21 用户更新可信IP后，真实企微四接口成功；主库副本两次真实同步幂等，角色/席位/主库保护通过。
- [ ] 真实企微OAuth回调及前端成员会话闭环：当前7个attempt均cancelled；原自动操作策略拒绝未绕过，不能由API/sync成功代证。最新审计见 `docs/prepublish-sidebar-batch-and-wecom-2026-10-21.md`。

- [x] 真实企微原管理UI六阶段v6：登录/组织往返刷新/两次同步/13成员与1部门/退出刷新通过，10位企微成员，角色席位与主库保持，私有资源全闭。
- [x] 管理端登录与组织切换改用既有Cookie交付，真实v3 RED→v6 GREEN；新增3项回归、后端309项及类型/lint/build通过。见 `docs/prepublish-real-wecom-admin-test-2026-10-21.md`。
- [ ] 真实企微成员OAuth回调/客户端身份领取仍开放；可信IP已恢复，不再作为阻塞。
- [x] 原Vite源码页面同六阶段v7通过；开发前端/副本后台全关闭。本机3000保存一致性备份后正常重载，Cookie登录/切换/退出HTTP及人员摘要复核通过。

- [x] 原始策略拒绝溯源：CUA getApp Chrome URL停止；原远端综合探针回合task_complete.error=cyber_policy，未记录单个Provider RPC拒绝。原记录行号/hash与纠偏报告已保存。
- [x] FirstRun保留安全阶段/固定原因码，3项新RED→GREEN及Node24原13项回归；不扩大异常原文输出、不重试已claim输入。
- [x] v24本机原UI队列草稿冲突/撤回编辑/拖拽排序/reload/实际A→E→D与CLI持久顺序通过；本人4settled88Credit、另一成员全行保持、4端口和私有资源关闭。
- [x] v26原Stop/暂停队列/reload/原Resume/实际A→C及CLI顺序通过；A原reserved等额uncertain，C+标题2settled44Credit，另一成员全行保持、4端口/fixture根/BH全闭。

- [x] 新消费者v27原队列立即发送：实际A→Y→X、CLI同序/热冷不重放、A预留uncertain/其余3settled66Credit、另一成员保持及4端口/私有资源关闭。
- [x] admin-run v3原执行/详情/取消/刷新/原操作日志搜索通过，原worker及真实供应商2次，14settled+取消预留uncertain、3运行审计匹配。
- [x] admin v4页面创建两样本数据集/评测发起/评分/刷新通过，原worker2/2评分1、2settled28Credit及密文存储；独立v5原取消评测使两个在途子run/连接均取消，2笔uncertain原预留保持、日志匹配。

- [x] 原后台自动化v6：自然跨due停用0派发、过期启用可见拒绝、另once恰一次原worker成功/14Credit、原删除取消/确认/reload保护另一计划及历史账本通过。
- [x] 原模型管理v8：后台Vault连接探测、原编辑费率实际消费30Credit、停用取消/确认及403零计费、原编辑恢复revision4/再30Credit、密文不变通过。
- [x] 原管理确认框v9真实RED：在途两次确认产生204/404两DELETE且Esc提前关闭；Collection同步准入/busy与Modal受控cancel修复，v10单次请求及真实404后解锁通过，18项相关测试/严格类型/Lint/build全绿。

- [x] v13原隔离Runtime创建/编辑/真实容器执行输出/在途Stop/取消详情/原删除/reload通过；owner/无网络/无host绑定、2执行密文历史保持、模型账本0。专用Colima恢复Stopped/default context。
- [x] v14原访问与分发策略deny/停用/启用/删除取消确认→真实catalog/Gateway准入通过；两允许2settled28Credit、拒绝零增量、模型资源不改。
- [x] v15原skill创建/审核前拒发/审核发布V1/编辑审核V2仍交付V1/发布V2 checksum/旧版本409/停用403通过，版本1不可变、模型账本0。

- [x] 原部门/成员席位v16：页面创建/分撤席位/停用恢复/旧session不复活/部门更名和占用删除拒绝及清空关联删除通过，2settled28Credit归属保持、owner原行不变。
- [x] 原限量v17：表单0/1000/已用14/移除→Gateway402零新增/两成功28及原统计reload通过；原订阅/模型不变。
- [x] Settings晚读v19真实RED：后台0规则/UI先0后回灌1，原晚200完成；代际和挂载准入修复后v20相同晚成功20样本0，v21仅相关限量正常回归28Credit通过，类型/Lint/build通过。

- [x] 2026-10-21：新增凭据轮换/撤销/恢复v22、分类引用保护v23、企业/角色/留存v24RED→v25GREEN；修复企业改名顶部标签不同步，新增逻辑3/3及typecheck/lint/build通过。详见docs/prepublish-credentials-categories-enterprise-test-2026-10-21.md。

- [x] 2026-10-21：v28新增原观测页面3维聚合、实际留存删除/其他企业隔离/账本保持；v29新增5份原链接CSV实际下载与导出审计。类型/Lint/驱动语法通过，仅新增模式，未重复已通过场景。

- [x] 2026-10-21：v32原会话角色降级与auditor/operator/member权限；v33原Web 320/768功能与v34稳定补图通过。详见docs/prepublish-admin-role-viewport-test-2026-10-21.md；原终端凭据UI、console门禁仍待新增。

- [x] 2026-10-21：v35原终端凭据签发/列表与实际消费/后台撤销通过；v36两通过阶段+v39原320阶段补齐管理端25页面/11配置标签/3宽度console门禁。只修测试驱动动画时序，原产品未改；转查未打包退出退订告警。

- [x] 2026-10-21：未打包v33原历史消息preserve编辑取消/确认→assistant Fork→child新问→父/子回看与reload；4笔88Credit、另一成员完整ledger保持、独立4端口/进程/根清理通过。只修设施source快照/生成目录/SSE marker；文件回滚编辑仍单列。

- [x] 2026-10-21：v34原组合文件回滚、v35仅重置对话；v37RED→v38GREEN修复文件摘要把accepted当applied的错误关窗。7源码回归/3缓存合同、完整typecheck/lint/architecture通过，独立核5组资源闭合。详见docs/prepublish-edit-file-rewind-test-2026-10-21.md。

- [x] 2026-10-21：v39原审批拒绝后恢复、v40中文多行反馈、v43精确路径项目授权Main/CLI冷恢复及跨文件询问；模型/完整ledger/规则/实际进程独核通过。v41/v42设施失败保留，未改产品源码。

## 2026-10-21 原结构化问答新增覆盖

- [x] 多题/中文自定义/返回改选/待答reload，真实后继模型/账本验证（v44）。
- [x] v46历史卡误报未答RED；结构化原字符串输出/旧摘要保留修复，v47原卡实时/刷新/Main与CLI冷恢复GREEN。
- [x] 原空答案提交/模型非拒绝指引/历史自动继续（v48），12项新回归、类型/Lint/架构/正常构建及五轮资源核对通过。
- [ ] 整体目标active；下一步审计忽略问答/计划审批的既有证据，仅补真正缺失消费者，继续排除外部MCP/网盘/发布后多系统客户端。

## 2026-10-21 问答忽略及计划审批新增覆盖

- [x] v49原问答忽略：真实decline/canonical error、同任务恢复、5笔110Credit，全部资源闭合。
- [x] v52计划反馈/真实steer/修订B批准/实际文件/待答刷新阶段通过；整体failed在折叠卡定位处保留。
- [x] v53只补原工作组/计划卡/side pane/完成刷新，4笔88Credit通过；四轮资源独立核对，设施失败不当产品缺陷。
- [ ] 纯计划忽略停turn独立入口；先查本地Git原stage/commit历史证据再补缺口。整体目标active。

## 2026-10-21 原计划忽略与Git新增消费者

- [x] v55计划忽略停止当前turn，无自行模型改写；新用户指令才恢复审批并写B，5笔110Credit。
- [x] v58原staged-only生成/取消阶段通过，整体设施失败保留；v59仅补原实际提交/剩余文件生成，2条commit精确且reload不重放。
- [x] v60同文件index B/worktree C：原stagedOnly提交B、C与其他文件/diff保持，生成0，原finally及5轮进程/端口/根关闭。
- [ ] 整体目标active：继续原本地分支创建/切换等缺失消费者；外部MCP/网盘和发布后多系统客户端排除，企微/远程不阻挡其他联动。

## 2026-10-21 原Git分支与覆盖保护新增覆盖

- [x] v61原创建/无效名/取消/no-op/搜索/切目标/reload，模型新增0。
- [x] v62真实RED：警告列1文件却显示2；bd0b6d4b修复警告计数，原提交预览全量保持；3新回归及类型/Lint/架构/正常构建通过。
- [x] v63 tracked保护复测通过，v64独立untracked保护通过；原取消不变、确认先commit当前再switch目标，四轮资源/原新源hash独核。
- [ ] 整体goal active：核对Git图谱/提交详情既有证据后补缺失动作，不重跑既有正例，不重开发布客户端验收。

## 2026-10-21 联动补缺最终核对

- [x] Git纯重命名实际显示新增的缺陷修复：3RED/2PASS→5GREEN，当前源码原UI v77通过，456项服务回归与类型/Lint/架构/正常构建通过。
- [x] 新增原订阅、安全策略优先级、智能体版本到worker、配置草稿/冲突、企微两处绑定保护、会话27条分页/搜索/详情，分别v41/v43/v44/v47/v49/v52通过。
- [x] 当前真实企微API及Vite管理页v8六阶段通过，主库身份保持，测试资源关闭。
- [x] 当前25页/11配置标签与23份具名结果核对，13份原失败保留且清理通过；常用3000无监听后保存一致性备份并恢复原源码服务，10类业务表保持。
- [ ] 真实企微成员OAuth/客户端领取：此前URL自动操作拒绝未绕过；managed远程/移动云渠道仍有缺实现或受拒运行边界。整体不标全部覆盖。外部MCP/网盘/发布后多系统客户端仍排除。

详见docs/prepublish-linkage-final-2026-10-21.md。
