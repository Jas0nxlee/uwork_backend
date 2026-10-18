# UWork 客户端与后端持续联动覆盖

2026-10-17。当前目标为继续自动覆盖所有尚未验证的真实联动，发现问题修复并复测。真实企微、外部 MCP 和网盘按用户要求排除。本表保留未完成项；通过一个层次不自动证明其他层次或整个项目完成。

2026-10-19 当前：G04h v8空身份原登录三epoch、freshDraft实际自动选模与G07c v3原文件A/B链已通过。Standalone Web v8已在Electron41内嵌Chromium完成11项原DOM业务；[G04i v5](client-plugin-skill-bridge-test-2026-10-19.md)已完成插件安装到Skill正文消费与同会话撤权拒绝，5模型/5settled/5Trace、45 Credit。后续补上[W02成功连接后断线](client-web-disconnect-recovery-test-2026-10-19.md)：原RPC与浏览器实际复现后修复两处问题，42 项相关回归、完整门禁与 Server/Web/Desktop 正常构建通过；v4 实际断线、四宽、原键盘 Retry、Cookie/项目/文件恢复通过，console0/script0。此前本机切片全部完成的概括撤回；跨环境边界及U02–U05保持开放，历史具名切片保留原日期/候选。

新增 [G09b Native用量取消](client-native-gateway-usage-logout-test-2026-10-19.md)已通过：原刷新真实200暂挂、原Back后退出触发abort/drop、匿名重开无旧资料/额度/用量；模型/账本/Trace/Credit增量0，console0/script0。初始化2/2/2/44单列，Common关闭超时与Root精准终止分列，五已知PID/四端口/BH socket独立收口、私有根保留。有限剩余审计发现的[G04j推荐卡绑定](client-native-installed-plugin-suggestion-test-2026-10-19.md)也已实际通过：原Native自有安装setup、原卡mention＋prompt、原User禁用后同卡纯prompt/mention0；八业务click、每卡HTTP不增与Native计量增量0，console0/script0。其setup与G04f/G04i旧验收分列，六已知PID/五端口/BH socket独核收口，私有根保留。

判定依据是 `SPEC-uwork-client.md`、`SPEC-client-policy.md`、`SPEC-ai-assets.md` 及客户端 enterprise specs、实际 UI/Host/CLI 入口、测试代码和执行证据。原始审计在 ignored `evidence/client-coverage-audit-20261017/`。只审计当前支持的行为，不为了造通过而增加云服务、远端身份或协作产品。

## 既有能力与证据层次

| 能力                                                   | 当前已证实层次                                                                                    | 仍需单列的边界                                                                     |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 交互身份、issuer、企业/成员切换、私有会话存储与撤销    | 后端 HTTP、实际 Host/加密存储、CLI；Native 原登录、认证冷恢复、退出拒发及再次冷启                 | 真实企微明确不测；原生企业选择对话框切换尚未等同私有 Host 测试                     |
| 成员角色/部门/企微映射、席位和有效额度                 | 249 项后端基线、129 次用户链路 HTTP、24 HTTPS/Host、Native 角色/额度/席位/会话                    | 基线报告 `client-user-journey-test-2026-10-17.md`；本轮未重复付费生成              |
| 后端模型目录、默认选择、能力与参数、私有 Keyless relay | Registry/SDK、真实 HTTPS/Host、当前打包 CLI、Native 实际对话                                      | 当前正式 CLI 与 staged SHA 相同；安装包和远程模型出口分别验收                      |
| JSON/SSE、取消、私有输出防泄露、账务终态               | 真实 TCP、SDK、打包 CLI、Native 停止和退出                                                        | uncertain 是保守预留，不推断远端费用或副作用退款                                   |
| 企业技能发布/下载/缓存/更新/撤权                       | HTTP、Host、真实磁盘、打包 CLI；本轮 Native Skill 工具及后继模型上下文                            | 本机缓存故障和 Native 导入已补测；其余管理入口与跨平台见下表                       |
| 企业专家                                               | 当前正式 CLI 的 v1/v2、同 session 冷恢复、撤权及个人别名隔离；Native 指定企业专家正文和撤权冷恢复 | 动态工作流资产消费与运行中的合法快照按各自规格验收                                 |
| 受控连接器                                             | 本机 MCP 与真实 Host/CLI/后端合同、逐次准入和回收                                                 | 外部 MCP 明确排除；不把技能文件缓存当连接器权限                                    |
| 已发布菜单、欢迎和风险提示                             | HTTP/Host、真实 Sidebar 浏览器；本轮 production Electron 动态发布/路由/退出                       | 隐藏入口不等于禁止全部快捷键；实际执行另有渠道守卫                                 |
| 个人模型/技能/连接器、危险技能策略                     | Native 个人模型；实际 CLI 用户/项目 Skill、本机 MCP 开关及真实 identity 注销                      | Native 技能导入/连接器设置已实际验证；其余管理入口和跨平台仍单列                   |
| 分享、文件、网络/域名/席位与身份变更                   | 真实文件DB/HTTP/Host、multipart/hash；G08d原Native发布，G08f同guest企业成员登录/阅读/退出         | 组织只读分享已按自有后台合同验收；OS外链/剪贴板/选择器、签名安装与正式外部服务另列 |
| 兼容后端 Agents/runs API、本人任务与取消               | `client-console-contract-smoke.ts` 实际 HTTP/Host，后台 Runtime 测试                              | 与本地自动化菜单独立；不由菜单跳转推断后端任务执行                                 |
| 本地自动化                                             | Native 创建/立即运行、绑定原任务；完整 Main 自然到期和重启恢复、当前权限拒绝及真实计量            | 已接受次数不等于成功次数；agents/全局作用域及移动云助手仍单列                      |
| 审计、Trace、用量与客户端事件                          | 后端全量/导出/脱敏及既有实际客户端 HTTP 证据                                                      | 用量隔离已验；不把合成事件当全平台遥测部署验收                                     |
| Web/手机 attachment、远端 workspace                    | 正式 standalone Web/Server HTTP/静态 JS、真实 WS/RPC 与重连、Host ticket 首用/重放/30s 到期       | 普通 Docker File/System 断开/重连已补测；managed 远端/手机仍另列                   |
| 云助手/组织协作/微信与企微分享                         | 后台布尔准入已有验证                                                                              | 没有对应本地产品出口/外部合同，不能以 200 或配置布尔声称真实云/协作成功            |
| Windows/Linux/macOS 发行安装及生产目标机               | macOS 仓库构建的独立 Electron、CLI、后端镜像可运行                                                | 已安装发行包、Windows/Linux runner 和生产主机/远端 CI 保留未验收                   |

## 尚缺组合证据的执行矩阵

此表不要求无穷输入笛卡尔积。每项需要对应的实际允许、拒绝/更新、异步边界和清理证据。测试脚本存在、方法返回 200 或目录文件存在不能单独勾完成。

| ID  | 原缺口                                         | 当前新增证据                                                                                                                                                    | 剩余工作                                                                                                             |
| --- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| G01 | 跨企业/issuer 资产缓存和当前交互身份           | **完成 HTTP/Host/打包 CLI 层**：2 项、279 次 HTTP、4 个 CLI；A→B→A 当前版本、旧下载迟到、双 issuer、冷恢复、禁用/恢复及退出                                     | Native 组织选择界面不由此替代                                                                                        |
| G02 | 资产正文进入实际会话、子任务及恢复             | **指定 Host/CLI 切片完成**：专家/Native Skill，新增正式 V4 动态工作流 10 项；actor 正文 v1→v2、撤权、原 owner、同 run 冷恢复零已完成模型重跑                    | Native workflow 保存/取消/同 run 冷恢复及父结果通知已追加；生产安装包灰度、跨 session 及未公开 expert persona 仍保留 |
| G03 | 损坏/并发/崩溃缓存贯穿实际 Host+CLI            | **已列五类故障完成**：原 3 项315 HTTP/9CLI，加真实双 Host、部分 stage SIGKILL 两项131 HTTP/4CLI；当前新 CLI 再验证                                              | 本机 macOS 结果不替代 Windows/Linux 的安装/进程语义                                                                  |
| G04 | Native 菜单/欢迎/risk 动态发布与身份变化       | **指定菜单切片完成**：草稿/发布、禁用隐藏、名字/顺序/既有页面、退出、旧可见菜单迟到点击拒绝；补实际自定义 HTTPS 页面导航                                        | 原生企业选择/身份切换迟到响应仍单列；真实企微排除                                                                    |
| G05 | 助理渠道与真实本地自动化入口                   | **指定 Native/Host/Main 切片完成**：创建/run-now/绑定原 task；完整 Main 自然到期和完整重启继续原任务，撤权后真实模型调用/账本增量 0                             | Main 已派发输入后才模型拒绝，不称 scheduler 未派发；agents/全局作用域与移动云助手仍单列                              |
| G06 | 个人模型/技能/本机 MCP 的生产入口开关          | **指定 Host/CLI/Native 切片完成**：个人模型、用户/项目 Skill、原生 MCP 设置连接/撤权；原生技能先选后撤权零写、恢复导入立即可见、再次拒读文件保留                | Native 技能开关、删除确认/取消及撤权已补测；复制/移除以 source FS 证据为限，更广身份切换 UI 单列；外部 MCP 排除      |
| G07 | 正式 CLI builtin Read/Write/Bash/WebFetch 出口 | **指定 Host/CLI 切片完成**：原5项真实副作用及批准/Hook/yolo后撤权；补公共HTTPS正文→提取→后继模型，同runtime移除域名后拒绝且0目标网络帧                          | G07c已验原mention/Read正文和撤FS拒绝；G07d结果复验/真实CLI与OS另存；不按每tool重复Native，也不冒称OS等待期间撤权     |
| G08 | 分享文件完整允许/撤权出口                      | **完成指定 Host/service 切片**：5 项新测试+26 回归，299 次 HTTP；生产文件源 stat/read→自动 manifest/hash→实际 multipart→confirm，并测 prepare/upload 后撤 files | G08d原Native发布/G08f成员guest链已补齐；OS外链/剪贴板/选择器及签名安装另列，不推广为正式外部或完整组织协作           |

## 新增实测的具体边界

Native 使用独立 HOME、数据根、真实后台文件 DB/TLS、自有 CA 和 production Electron/Main/Host/staged CLI。通过实际 DOM 输入、点击、可用的原生选择器及正式启动参数操作，锁屏后的系统选择器未验收；未注入 React 状态或替换业务响应。此前具名Native组的初始身份来自真实email API与生产加密store恢复；G04h v8另从空身份原登录，G07c v3仍用email/store基线。各组均**不是真实企微扫码**。

16 个 Native 有名检查、13 次本机受控供应商请求均有对应账本 settled；其中 2 次是另一成员的初始化对照，9 次为三组 Skill 主调用/后继调用/标题，2 次为自动化允许调用。关闭 local 后的自动化尝试及退出后的发送均未增加供应商或账本。自动化 UI 记录的“已运行”统计接受次数，不能把拒绝的模型调用算成功。模型 IO 证明当前 Skill 版本正文进入请求；目录和缓存存在不被当作执行证明。

插件商店实际页面已打开，但公共市场显示 TLS issuer 错误；本轮只验菜单路由，未安装插件，也未关闭证书校验来造成功。最初禁用菜单探针因轮询已提前隐藏按钮而未执行；后续另用受控代理延迟真实配置响应，在旧按钮仍可见时实际点击，被当前后台准入拒绝且页面不跳转。没有替换业务响应或注入 UI 状态。首次草稿探针存在测试控制顺序错误，丢弃后重新取得实际轮询证据；它不是产品 RED。

个人模型 Native 补测使用自输入的无效测试 Key，仅供本机受控供应商，不从后台 Vault 获取 Key。先验证 personal.models=false 创建被拒且 Provider 文件字节不变，再由后台发布 true，经真实 UI 创建、配置、发现并完成个人模型主调用和自动标题。发布 false 后同一已存在 CLI 会话拒绝新派发，配置保留。此隔离夹具供应商总数为 4：2 次其他成员的初始化对照走后台账本，2 次个人模型测试走受控个人供应商，**不是新增企业账本消费**；撤权后数量不变。

实际发现并修复两条提示问题：创建供应商的所有失败被误诊为“配置格式无效”，改为检查配置或企业权限；个人模型撤权后对话直接显示内部码，沿既有 exact-code resolver 增加本地化操作提示。后者 unit RED→GREEN（2 项含旧回归），任意供应商正文包含码字样不会被改写。新 production Native 重建/重启后，两条提示均截图复测通过；实际权限/模型选择/重试逻辑没有变更。

Agent 子任务实测为父模型工具调用→子 SSE→父继续→标题 JSON，4 次受控调用/4 settled。子请求前撤销席位后，真实后台返回 NO_SEAT，只有先前父请求的 1 次派发/1 条账本。子任务继承同一私有 relay，CLI 不收到身份、供应商凭据或后台 CA。

分享最终 299 次 HTTP 分为 96 次管理/控制、169 次现 Host 授权请求及 34 次受控分享服务请求，已去重。三种 access mode 都不能把 organization 配置变成公网发布；草稿、seat、网络/精确域名、组织切换、prepare/安全检查等待后撤权均实际验证。原文件一例只测 HTTP client 手工 descriptor/Blob，因此额外补第五例：实际 ConversationShareService 从受控会话 Markdown 发现自有 81 字节 report.md，经生产 LocalArtifactSource 的真实 stat/read 自动生成 manifest/descriptor/hash，到真实 multipart 和 confirm；接收端独立核对字节、SHA 和 confirm 行的 size/SHA。三个发布过程各自读取文件，prepare 后撤 files 阻断上传，上传后撤 files 阻断 confirm，原文件不变。已真实创建外部分享后才撤权的一例，只压住 Host 迟到成功，不承诺回滚外部副作用。cloud 与 local 权限按各自 owner 验证，关闭 cloud 不影响已允许的本地分享，开放 cloud 不授权被关闭的 local。

## 证据、门禁与后续

- 既有基线：[企业用户配置/权限/用量报告](client-user-journey-test-2026-10-17.md)、[客户端私有会话报告](client-live-test-2026-10-17.md)。原通过结果保留历史日期，不用旧数量冒称本轮新覆盖。
- G01：`evidence/client-assets-identity-20261017/summary.json`、`report.md`；279 次 HTTP，2 项通过，4 CLI/6 端口/2 临时目录均已清理。
- G02 Agent：`evidence/client-subagent-relay-20261017/summary.json`；新增 2 项与原 stdio 5 项回归均通过。
- Native：`evidence/client-native-enterprise-20261017/summary.json`、`skill-*-proof.json`、`automation-model-proof.json`、截图与 `outer-cleanup.json`。外层实际确认 7 个自有进程退出、端口关闭、根目录及浏览器 daemon 删除；没有用旧夹具的固定等待代替清理证据。
- 分享：`evidence/client-sharing-live-policy-20261017/summary.json`；5 项新测试和 26 项既有回归通过，自有目录均清理。
- 缓存故障：`evidence/client-assets-cache-fault-20261017/summary.json`；3 项通过，9 CLI/6 端口/3 目录清理。
- Builtin：`evidence/client-builtin-policy-live-20261017/summary.json`；5 项新测试及原 7 项实际 stdio 回归通过。
- Native 个人模型/旧菜单：`evidence/client-native-personal-20261017/summary.json`、`personal-model-io-proof.json`、`provider-denial-no-write-proof.json`、RED/GREEN 与 `outer-cleanup.json`；7 个有名检查，7 个自有进程退出、4 端口关闭、根目录/daemon 清除。
- Native 夹具已补有界 Electron exit 确认、强制退出后确认、逐项继续清理和稳定清理结果；独立无 Electron 与实际 Electron 启动/关闭两条检查均 0 错误。

前一轮生产改动为上述两条 UI 提示及 exact-code 映射；追加本轮已修复企业专家撤权后的个人别名回退，以及个人子智能体逐次准入，详见追加报告。后端/admin 类型、新脚本 Lint/格式、客户端全类型/Lint/定向格式/架构和 Native 构建通过；客户端保留 114 条既有警告、0 错误，架构 0 新违例。新增切片及共享夹具经独立只读审查通过。主后端保持运行，未读取主 .env 或解密主 Vault；只读校验主业务表哈希，确认原资源/配置/成员/账本等未变，不调用真实付费供应商。Git 中另有不属于本轮的未跟踪 `tests/security-sixth-provider-echo.test 2.ts`，保留且不纳入提交。

上述2026-10-17阶段保留原日期/候选；后续已完成的Native管理、workflow、分享和Web DOM见下文及[本机最终结论](client-local-integration-acceptance-2026-10-19.md)，不再作为新的本机待办。managed远端/未实现手机与目标平台分层保留，不关闭T13c6/T13d或宣称全环境完成。

## 追加权限修复与新产物验收

详见 [企业权限追加联测报告](client-enterprise-authorization-test-2026-10-17.md)。实际发现并修复撤权企业专家回退到同名个人 profile 的问题。个人 profile 采用明确 canonical 名称，按同次目录装配，并在个人内容读取和每次新子模型请求前复核当前权限与 owner。该阶段正式 CLI 和 Desktop staged SHA 均为 `0d9588624db3368787cbbd86c3d27a92b327e1d169614f1b1162f7e61895454c`。

当前产物下专家4项及相关15项共19/19通过，1569后台HTTP、92供应商/92账本（90settled、2取消uncertain）；个人技能/MCP三项已在其中，不重复相加。Native 专家正向与撤权重启原任务复测另有8供应商/8settled（含另一成员初始化2），撤权后新Agent工具调用返回不可用，0个人子请求。实际工具结果决定拒绝，受控供应商的固定完成文案不决定权限。

独立 Web/Server 另有2/2真实网络场景：正式产物静态JS、Cookie/WS/RPC、真实文件写盘和重连、Host票据首用/重放/实际30100ms过期。企业身份实际signed-out/unconfigured、模型为空；没有伪造Desktop身份来制造企业成功。规范见 `docs/client-web-standalone-live-spec-2026-10-17.md`，证据 `evidence/client-web-standalone-20261017/validation.json`。

该阶段门禁为Core25、任务读取合同4、Host/UI15、资产合同4、SDK1通过，根/CLI类型和Lint、严格测试类型、格式、架构0违例及正式构建通过。主后台health200，业务表只读哈希不变。全部结果按层次记录，保留未完成的U02/U03/U04/U05、T13c6/T13d及平台验收项。

追加发现并修复默认 task 首条输入外键失败、实际权限模式与元数据不一致、历史消息未转 wire 形状被严格 schema 拒绝。三项原始失败和默认首发/读取/绑定自动化的真实 Host 复测单列在 `evidence/client-automation-bound-resume-20261017/`，不把最初传可选deferred的成功当作默认调用成功。

此前候选为 `0d9588624db3368787cbbd86c3d27a92b327e1d169614f1b1162f7e61895454c`：Root相关23项和独立production Host默认任务/绑定自动化1项，共24个不重复真实用例通过。Native同产物专家允许/后台撤权/重启原task复测也通过；Core29（含任务读取4）及Host/UI15定向通过。格式后正式ordered重建仍为同一字节SHA，证据不混用中间fd6或原8663产物。当时仍未完成的 Native 设置、Main scheduler 与动态工作流，现已按下节指定范围补验；分享/身份界面、managed 远端和平台验收仍保留。

## a684 阶段产物与原生导入收尾

该阶段正式 CLI/source 与 Desktop staged 均为 `a684e40751e1f9bf7e8e7e3710f8518001451ec33d74964e5502a297a1d23d0c`。工作流直接入口的文件权限、准备/VM、转录和正文回放缺口均已修复；每次 actor 模型请求仍绑定原 run，私有模型 open 携带首次 invocation 的不透明 owner proof，Host 在构建请求前比较，不向 Renderer、模型正文、read/close 或 VM 增加该字段。独立 source 探针已证有效 A→B 窗口派发前拒绝；不是仅在输出后发现身份变化。

- 正式 G02 10/10：1,699 HTTP、54 本机供应商/54 settled，18 CLI、30 端口、10 临时目录全部清理。模型 Create/Amend/Resume 未分类 capability 及未公开 expert selector 仍按实际拒绝记录，不能冒称新增支持。
- 私有 stdio 5/5：187 HTTP、7 供应商/7 账本（5 settled、2 取消 uncertain）。另 Root 23/23 实际回归覆盖专家、身份、缓存故障/崩溃、个人技能/MCP、Builtin、副作用、子任务和一次公开 HTTPS；含一项夹具准备超时清理检查。各自历史证据先归档，未拿旧候选结果冒充新候选。
- 完整 production Main 的自然到期、Main 重启原任务及 local=false 模型拒绝通过，精确最终组合见 [Main 报告](client-automation-main-scheduler-report-2026-10-17.md)。独立 MCP Host 和 Native 设置均完成 false→connected 1 工具→false，撤权无新 peer 帧；只保存配置不授予运行权限。
- 普通 Desktop Docker File/System 连接→断开→重连已真实通过，两个 stdio PID 正常回收、文件字节一致、容器/Host/临时根清理。只验普通 transport lifetime；不是 managed enterprise remote、模型或手机验收。新脚本为 `scripts/client-remote-docker-lifecycle-smoke.ts`。
- 原生技能导入另修复先选后撤权仍写入、写旧目录导致成功不可见两条实际缺陷。最终 2 个真实 Copy 导入立即列出，源/目标字节一致；再次撤权拒读且文件不变、旧目录保留。整个 Native 夹具 8 供应商/8 settled，含另一成员初始化 2；最终 9 自有 PID、5 端口、数据根与专用浏览器 daemon 清理。详见 [Native 报告](client-native-settings-live-test-2026-10-17.md)。

技能导入收尾只重建 Desktop，最终 Main `15610678767611a3efeefaacafc84a0749df7818aed9c70fdfbb995e9c20b899`、Host `29ed78eadf5f9529ad4909502aa777e8ecaec27f0c543fa8fa90bb0e041312b5`；Renderer 文案收尾后 Main/Host/CLI 不变。完整 enterprise-policy 最终 Core 106、Host 197 通过，专项工作流 22、技能导入 runner 39（含分组）、UI 提示 9 均通过；后台 250/250。类型、lint、定向正确版本格式和架构检查通过，客户端 114 既有 warning、0 error。

Native 分享按钮仍依赖已停用的旧登录状态；已取得实际无入口的证据，不伪造 OAuth 用户或服务。个人技能开关/删除和 Native workflow UI 的后续指定补测见下一节；managed 远端/手机、正式分享/组织协作和 Windows/Linux/macOS 安装包仍保留。远端模型/命令探针曾被工具自动安全审查以可能网络安全风险拦截，已停止并保留历史证据；后续仅独立 File/System 元数据夹具，不重试被拦动作。CI 所在 GitHub 远端当前为空，公开发布代码不在既有授权内；未 push/触发发布。主后台保持运行，只读业务表哈希不变，相邻客户端仓库干净。原 T13c6/T13d/U02/U03/U04/U05 仍不因上述局部完成而关闭。

## 755438 当前产物与 Native 追加验收

正式 CLI 与 staged 当前为 `755438930a2f893a12a2dd339c4b281d06413412ddf3774fd8633f1c33fd63fa`；Main `5170a79a4cd71def9f9420ca16fe0652d0f94fc53a5abe955364cee8f93a1f75`，Host `d717e06c3a76255109aaf4e200b02c215f2c285f12a9947d153934321c116cc6`。这些结果不把旧候选的全部用例冒称在新候选上重跑。

- G06 个人技能管理：修复实际 Native 开关绕过权限的问题，将六个公开方法归到既有 scope/队列，包含异步等待、当前身份、文件和个人/危险技能权限。Native 允许→撤权开关零写、恢复后启用、删除确认期间撤权拒绝、取消保留及允许后删除均通过；新开关具有技能名 AX。详见 [管理报告](client-native-skill-management-test-2026-10-17.md)。复制/移除及队列 race 有真实 FS source 证据，不能冒称所有 Native 入口完成。
- RendererReady：原 Native 第二实例目录请求长期 cached，实际原因是 UI 没有调用已有 ready 通知。原 Hook 的平台监听建立后通知，StrictMode 清理取消旧 microtask；没有新增缓存或重试。新 Main 同运行中接收正式 `--open-workspace`，实际项目和 composer 均切换且仅路由一次；原生系统选择器仍受锁屏阻断。
- G02 Native workflow：正式 out 的未打包 Electron 沿原 dev alwaysOn 路径完成 SaveWorkflow 原批准、Run、Cancel、原会话冷恢复同一 run。旧限额组保留 9 条账本、1 uncertain 与两次父通知 402；新独占组通过真实 API 设足够的测试额度，第一 ask 未重跑，最终同 run 结果进入父模型请求并在 UI 新增消息。新组 10 supplier/10 ledger（9 settled、1 uncertain），0 次 402，详见 [新工作流报告](client-native-workflow-label-test-2026-10-17.md)。生产安装包尚无已接通的灰度来源，不由 dev 验收替代。
- 模型名称：后台已有 name 被客户端丢弃，现由原私有 Gateway→Provider 同锁整体替换，与候选 ID/owner 一致，再由 ModelSelection 投影；没有改变执行 ID。Native 初名、后台同 ID 改名、实际“重新读取”、selector/composer 新名和两次冷启动前后对话均通过。公开 writer 拒私有 map、远端 Source 去除/Target 写前拒绝；该 strict schema 需要 CLI 与桌面一起迁移。详见 [名称与文件提示报告](client-native-model-label-test-2026-10-17.md)。
- 新模型名称源码经独立审查：79 相关回归、UI/实际 HTTP 2 项通过，HTTP 13 阶段含换 owner、缺名称与 401/403/402 清空/重启，0 生成。完整 enterprise-policy 为 Core 106、Host 274；类型/严格测试类型/格式/架构通过，最终 Lint 113 既有 warning、0 error，不把重叠的测试数量相加。
- 新 CLI 实际代表性回归为 25 个命名检查：child/expert/personal 9，workflow 10，skills stdio 合同 1，私有 relay 5。前组 57 supplier/57 settled；workflow/relay 为 62 supplier/62 ledger（60 settled、2 uncertain）。两组来源明确，旧证据已归档，实际 CLI/端口/根均清理。Native 名称组另有 6 supplier/6 settled（含初始化对照 2），17 已知 PID/4 端口/数据根/两阶段 BH 均清理。

当前日志又发现旧 desktop context prompt、client-scenes 与 help 配置请求 404，正在追踪实际 owner 和现有合同，不能凭对话正常声称全部配置链路已通过。Native 组织切换/分享、生产工作流灰度、managed 远端/手机、跨平台发行与上述未解配置仍保留。主后台只读复核 health 200、原 PID 37266、9 张业务表哈希不变，外部客户端 checkout 干净；真实企微、外部 MCP、网盘和付费模型未参与。

## 自有控制面与模板缓存追加验收

用户选择保留功能并补齐自有后台。已实现 scenes/help/desktop/plugin-store 四类发布配置、结构化管理页和同一私有身份 owner 接线；[规格](../SPEC-client-experience.md) 与 [管理页报告](admin-client-experience-report-2026-10-17.md) 说明草稿、发布、弃稿、严格输入和同 kind 企业切换竞态。旧 UI 的迟到 A 响应可覆盖 B 表单并被真实保存到 B，新 UI 在同序列保持 B。四类完整生命周期和 16 个稳定布局已实测，主静态资产未替换。

初版控制面 CLI/stage 为 39175fd；[25 项正式 CLI 回归](client-experience-cli-regression-2026-10-17.md) 全过，117 supplier/117 ledger（115 settled、2 uncertain）分组保留，不与其他层次重复累加。postbuild Core 109/Host 288 通过，bootstrap 默认 noEmit 已消除旧声明的 5 个错误；Main 独立 noEmit 仍有 81 项既有诊断、无语义新增，CLI 标准 typecheck/lint 仍因缺 turbo 失败，不写成全绿。

[同后台管理页→Native](client-native-experience-test-2026-10-17.md) 已证：desktop 只保存草稿时无 Desktop 段，发布 on/off 后同会话下一 turn 立即采用当前值；设置导航真实产生 14 条 Renderer span，关闭后同样 54 次导航无新增。scenes 草稿冷启保持旧值、发布后原轮询暖更新、再冷启仍为新值；帮助关闭及身份撤销后的直接反馈入口没有请求旧工单。撤销后新模型/账本增量 0，两条旧匿名控制面请求 0。该组 16 supplier/16 settled 包括另一个成员初始化及未派发 child 的专家尝试，不能当 16 个业务成功。

实际 Native 发送后切自动化暴露共享 SWR 清空/去重标记问题；源码修复仅退休最后 reader 的资源。React/SWR 10/10、scope 2/2、独立审查通过，Desktop-only 重建后 [bf0/61fe Native 组](../evidence/client-native-scenes-fixed-20261017/summary.json) 证明模板表单、三轮往返、同 profile 冷启及 V2 暖更新均正常，CLI 字节仍 39175。该组 4 supplier/4 settled、18 个 PID/4 端口/两代 BH/root 已清。

另发现 Native 企业专家首次目录读取与后台同步 CAS 冲突，导致专家未注册；matched trace 的真实 RED 保留。现已沿同 Host/store 串行完整目录事务，保留原 scope、取消、dispose 和跨 Host CAS。新实际专项 9/9、原跨 Host/崩溃 3/3、独审另跑 9/9 及真实尾链 1/1，Required none。Root 全量 typecheck 与正式 Desktop-only 构建通过，CLI/stage 39175 不变，新 Main c3d27b、Host 9afc1a。[最终 Native 组](client-native-experts-config-final-test-2026-10-17.md) 首启与同 profile 冷启各有真正批准专家 child，父 system 有 Desktop、child 无 Desktop、全部无个人 shadow；两轮各 4 请求/4 settled。夹具连初始化合计 10 请求/10 settled，0 CAS 拒绝。模板/09:00 表单/返回取消/草稿点击在两代均通过，17 PID、4 端口与独占根已清理；Root 独立重算正文并核对 107 项证据及 88 源/6 产物 SHA。

公开商店排序、offPeak 旧 plan 入口、原生 chooser、OS 外链、生产安装包/跨平台，以及上述原有远端/分享/组织切换边界继续保留。同 Main 并发第二 Root 当前没有产品 UI/命令入口，应标当前 UI 不适用；普通 Renderer reload 复用原 Host，不能冒称 Host 代次恢复。[只读依据](../evidence/client-native-window-child-readonly-20261017/plan.md) 保留入口适用性。定时表单模型选择区的截图疑点已在另一独占 Native 连续三次判别为正常 200ms 动画；0.5/1 秒后只有一个稳定 label，无产品修改。真实企微、外部 MCP、网盘仍按用户要求排除。

## 同 Main Host 故障恢复追加验收（2026-10-18）

[真实 Native 恢复联测](client-native-host-recovery-test-2026-10-18.md) 已通过：唯一 owned H0 单次 SIGKILL 后 Main/原 CDP target 保持，标准 Page.reload 创建 H1 并自然恢复原身份；R0/R1 的 54 次导航分别实收 12/14 条 span。实际发布 desktop v2 后，H1 活 TLS 四元组与完整 false 收据对应，交付后的 54 次导航零新 R1 导出；真实“问题上报”无工单/反馈请求。基线 2 个初始化模型正文与 2 settled/44 Credit 零增量，79 配置收据全 sent。11 PID、4 端口及独占根已清，Root 独立复算、134 项证据及原 107/70/125 证据 SHA 通过。该结果不替代 UI 恢复按钮、自动重启、直接 sender ID 或完整旧 child 迟到隔离。

首轮测试观测器错误要求 ISO fetchedAt，实际后台返回 Date.now 数字，因此旧 60 条拒绝收据和部分恢复 GREEN 保留；新增真实 createApp TCP 三阶段 RED→GREEN，13 单测及独立真实 HTTP 回归后另起 profile 才通过完整 Native。修复只在测试层，产品源码和产物保持原候选。最终主后台 health200/PID37266、9 表哈希、7 静态资产和外部 checkout 均不变，未重新部署。

会话分享的后续[只读计划](../evidence/client-native-sharing-readonly-20261018/plan.md) 明确：自有服务当前只有分享准入/配置，没有准备、确认发布和预览存储 API；此前 299 HTTP 是外部旧服务的本机替身。客户端按钮和发布 client 仍依赖旧 OAuth，不能只换 URL/token 或解除 gate 即声称完成。企业内认证访问、外部公开链接或关闭入口的产品选择已询问用户，未决定前保留当前隐藏状态。

## 当前入口适用性核对（2026-10-18，只读）

[技能入口核对](../evidence/client-native-skill-copy-readonly-20261018/plan.md) 确认 `copyToCommon` / `removeFromCommon` 目前没有产品 UI caller；两语言遗留文案不能作为菜单存在的证据。它们保留现有 service/真实 FS 验证，Native UI 项为不适用。现有“导入→直接复制→当前项目”调用 `settingsSyncService.importSelected`，项目行 Trash 调用 `deleteSkill`，是另两条真实入口；项目目标、跨项目隔离与三门撤权另以独占 Native 切片验收，不能据此把前两个 legacy RPC 勾为 UI 成功。

[企业选择核对](../evidence/client-native-org-switch-readonly-20261018/plan.md) 确认已登录 Badge 只有同步、网关设置和退出，没有热切换企业入口；登录页 radio 仅持久化登录应用偏好。后台 `/api/auth/switch`、偏好 A→B→A 与实际认证主体切换分开记录。当时拟补的偏好、退出、失败和冷恢复现已由下述G04c完成指定范围验证，不能替代真实企微或多企业认证成功。

[商店与 offPeak 核对](../evidence/client-native-store-readonly-20261018/plan.md) 确认公开分类排序有真实 caller，但个人/企业目录不走相同分类排序，不能用两条个人资源替代公开商店验收。旧套餐 provider 的配置字符串没有当前 DI caller；当前 provider 固定关闭 offPeak，新建入口被 gate。存量任务的 ticket/status/settle 路径仍存在，不能据此宣布整个领域均为死代码，也不使用会代理真实付费上游的 mock gateway 进行本机测试。

本机 IORegistry 于北京时间 2026-10-18 01:24 实收 ScreenIsLocked/OnConsole 均为 true，证据为 [console-state.json](../evidence/client-platform-local-boundary-20261018/console-state.json)。这只说明该时点状态，不作为历史阻断的追溯原因；本轮没有尝试解锁或系统输入，系统选择器、剪贴板、安装注册和三平台发行验收仍独立保留。上述三份入口核对都是源码审计，不是新增 Native 成功记录。

## 项目范围技能追加验收（2026-10-18）

[真实项目 Copy/Delete 联测](client-native-project-skills-test-2026-10-18.md) 已通过：选好技能后撤权再提交拒绝、恢复后 Copy 的字节/模式、W2 无 W1 技能且返回 W1 恢复原行、三门独立撤权后的真实确认拒绝，以及取消/允许删除。10阶段文件与账本断言、8次真实已发布权限回读通过，2个本机初始化请求与原账本零增量。未提交的驱动 attempt1 和 AX 快捷键名误判保留原 SHA 归档，成功参考是实际 attempt2，不计产品失败或 UI 阻断。

16个自有 PID、4端口与专属 BH 全闭；私有 R 因 fileproviderd 的8个写句柄保留，不声称优雅 fixture close 或根目录已删除。572项源/产物/历史保护、252项本轮证据已封存。主 health200/PID37266、9表与原静态资源哈希均未变。该项目技能切片没有修改生产业务源/产物，两个新工具只属于测试层：受限正式第二实例工作区入口、完整受信候选清单复制器；后者已独立验证6,659文件/138,785,047字节的三方哈希，未用于替换本轮13,268文件完整快照，也不以冷热缓存不同的耗时宣称提速倍数。后续企业登录应用偏好由下述G04c独占切片另行验收，真实企微等排除项保持。

## G04c 登录应用偏好与窗口失败提示增量

真实退出、A/B登录应用偏好、跳过重开与同profile冷恢复已完成原生基线。基线同时发现真实缺陷：B实际503后，重开或成功改选A仍显示旧失败。按既有Host身份所有者修复窗口内提示的生命周期，保留Host诊断和取消屏障；原始145工件不回写。新正式Desktop产物12阶段、4次实收B503复测通过，重开/成功选择清除旧提示，新失败及同B重试仍正常显示。23个真实React交互、11纯测试、3项既有登录回归及client typecheck/lint/格式/架构通过，Lint保留113项既有警告、0错误。

新Native144工件封存，准备和新候选128项前后同；完整out6,662文件逐项复制/hash校验，未使用旧清单或快捷筛选。模型正文和账本零增量，初始2次本机供应商请求/2笔settled/44单列。9个已知自有PID/4端口/BH退出，私有新R因系统写句柄保留0700，后台精确非优雅停止如实记录。主服务37266/health200、9业务表、原7静态及独占admin4产物/10相关源不变，外部客户端checkout干净。

详见[联测报告](client-native-org-preferences-test-2026-10-18.md)。该完成项是公开应用偏好和窗口失败链路，不是已认证tenant membership切换或真实企微成功；新run不重复冷启动，原基线冷恢复结果保留其旧候选边界。分享范围、公开商店排序、managed remote/手机和跨平台发行仍保留，不关闭整体U02/U03/U04/U05。

## G05d 闲时功能关闭时的 Native 导航增量

[独占原生实测](client-native-offpeak-disabled-test-2026-10-18.md) 已验证真实 action 导航后只显示定时任务入口，正常返回时原 composer 和工作区标识保持一致；从标准自动化入口打开已发布的定时模板并取消，也未创建任务。三次 SQLite 只读当前 WAL 快照的闲时任务、未结算 outbox、自动化及运行记录均为0；初始2次本机受控模型请求、2笔settled/44保持不变。原输入为空白，未声称保留非空文本。

本项只验收当前固定 `enabled=false` 下的公开可见结果，没有独立 eligibility RPC/loading 完成或 Native 配置正文版本收据，不替代 enabled=true 创建或存量 ticket/status/settle。113工件封存，124项准备/依赖/源/正式产物及541项旧证据保持原SHA。11个自有PID、4端口和BH已闭；新R因8个外部写FD保留0700，自有fixture精准非优雅停止如实记录。公开商店实际排序继续由独立Native切片推进，整体U02/U03/U04/U05不关闭。

## G04d 真实公开目录、CA修复及 Native 排序增量

[实际公开商店](client-native-public-store-test-2026-10-18.md) 已验证46个真实条目、两mode的默认→草稿不生效→发布生效→恢复null，分类、两对稳定ID和未配置项顺序均有直接DOM证据。ghost没有生成条目，搜索46项及公司/个人空对照单列。Root独立复放八组全部46项，公开排序不再仅有Source或空目录证据；公司/个人、Featured、已安装排序仍没有正向库存验收。

前置同时发现[自定义CA替换默认根缺陷](client-catalog-custom-ca-test-2026-10-18.md)，旧正式CLI真实证书失败，修复单一loader并正式构建/stage新09a版本后，单证书无手工bundle的真实目录复测取得46/0安装/0诊断。Source4项严格TLS、全client typecheck/lint、CLI标准27类型与14Lint任务、正式构建均通过。新101源/6产物与旧候选区分，四Desktop产物未重建。

本轮完整复制实际12,972文件并逐字节核验旧6,662及新增6,310编号副本，没有使用过滤快捷清单。公司SkillHub按测试计划被拒，403横幅保留；Renderer外部图片blocked138单列，不称全局出口零。模型/账本仍2次本机初始化、2笔settled/44，Native增量0。13自有PID/5端口/BH已闭，新R保留0700及fixture精准非优雅停止如实记录。未捕获Native插件版本正文收据，未验证身份迟到/分享/远端/手机或跨平台发行；整体目标继续推进。

## G04e / G07c 配置读取生命周期与文件引用增量

[独占 Native 联测](client-native-configuration-lifecycle-test-2026-10-18.md) 已通过同页 P→真实私有读取 pending→约10s超时 D→恢复 P；正常退出发生在新请求 TLS 入口后1,575ms，该未交付事件位于退出输入区间，原 Host 四元组随后消失。恢复传输后63次、31,570ms保持 signed-out/默认D，无旧P回灌。包含正常presentation scope失效，不独立归因hook.catch；53条记录中50sent/3原样invalid_metadata、最终pending/drop均0，没有直接插件版本交付或成功晚到声明。

同profile先完成63字节自有文件预览、正常右键添加到聊天、真实按键移除引用和非空草稿保留；原文件/hash/权限不变，无聊天发送。路径由真实绝对行、当前工作区和相对mention联合核对，不冒称DOM有绝对mention属性或正文已进入模型。11份完整请求/现有账本快照保持初始化2请求、2settled/44，Native增量0；沿用09a候选，未改生产源码/产物或重建。

完整复制12,972文件，源/目标receipt逐项对应已接受树；124项源/依赖/产物及原证据各自保持原SHA。13自有PID、5端口及专属BH已闭，Root另实际复核拒连。新R因8个外部写FD保留700权限，夹具精准非优雅停止，无完整desktop-traffic。如实保留首次视口外点击和副实例birth报告修正，未将驱动问题计为产品缺陷。主37266/health200、9业务表和原静态资源不变，未重新部署。

当前只读审查再次确认：手机无生产接入caller；SSH/Docker入口存在，但企业执行authority未贯通，T13d保持开放。手动transport是否允许连接不能被擅自定义为“必须零连接”的现产品合同，也未重试此前被拦截的远端模型/命令探针。分享产品范围仍未决定，当前配置管理页选择不替代分享授权；锁屏下的OS选择器/剪贴板/外链与三平台发行继续单列，U02/U03/U04/U05不整体关闭。

## G08b–G08f 企业成员分享增量

用户后续已明确仅已登录企业成员访问。自有发布/存储/访问后端、私有 Host 传输和同源只读页已补齐，原后端 301、客户端 49、跨仓真实 HTTP 3 项与独立浏览器 Cookie/附件/跨企业/撤销验证按各自层次保留。Native 正常发布和打开见[发布联测](client-member-sharing-test-2026-10-18.md)及[匿名浏览联测](client-native-share-browser-test-2026-10-18.md)。

新独占 Native 从原成功面板打开同一 guest，经原登录按钮、受控 provider 和原 callback/claim 完成普通同企业无席位成员阅读，再经原退出清空正文。preview401→200→401、logout204；分享、登录和阅读阶段模型/账本/Trace无增量。五已知PID/五端口收口，保留私有根0700；细节和历史驱动失败见[成员阅读联测](client-native-member-viewer-test-2026-10-18.md)。

客户端空身份原登录由G04h v8、文件引用实际发送/Read正文与撤FS拒绝由G07c v3另行通过。Standalone Web v8原DOM已通过；此前加密会话恢复、文件预览和HTTP/WS结果保留各自原范围。真实企微、外部 MCP、网盘、远端权限及平台安装边界继续保留，U02/U03/U04/U05不整体关闭。

## G04g 登录 poll 与 Native IPC 交付顺序

[真实 React 回归](client-enterprise-login-polling-test-2026-10-18.md) 已一次通过新2和旧23：open未决时原poll effect先认证，随后旧null/ERR_ABORTED不回退、无cancel/重复close或sync。类型/Lint/架构/改动格式通过，已知进程/端口与临时根收口，正常out全部原SHA恢复；生产Hook未改。该组件合同补足原生测试的时序前置证明，与插件 G04f 分开编号，不能代替下述 G04h 的完整 Native 身份验收。

## G04h 客户端空身份原生登录本机受控完成（2026-10-19）

[v8及历史公开证据](client-native-primary-login-progress-2026-10-18.md)确认全新空身份、七原FirstRun与prelogin全0后，原登录/唯一callback/Host私有claim/guest关闭/原公开身份和默认模型均通过。主回复与原标题实际2模型HTTP请求、2笔本人settled、2条Trace、44 Credit，supplier后台Key匹配2/拒绝0。

同profile冷启无新attempt；公司/Gateway身份、角色、有效额度及本人用量exact。原Settings Back→原task→原UI退出后，旧task固定发送拒绝且模型/账本/Trace零增量；再次冷启保持退出。170公开文件manifest SHA `7ee47b3ef9872a0c73a212187bd37a6629ad6f43ca5c2c729f3720bd463413a6`；8已知PID/4端口/3BH闭合，原handoff失败保留并由Root独核收口。真实企微/外部模型与平台边界不变，历史v1–v7不回写。

## G07c 原文件mention→Read正文与撤权拒绝完成（2026-10-19）

[独占v3联测](client-native-file-context-test-2026-10-19.md)在正常email/store恢复身份下，经原右键添加、原“返回任务”和各一次发送：A指定Read call的带行号正文进入后继模型，3条Native请求/3settled/3Trace、66 Credit；同task B在FS=false发布并回读后发送，Read拒绝且新B marker不进模型，新增2请求/2settled/2Trace、44 Credit。不能把工具拒绝写成模型零增量。

Native共5请求/110 Credit；另一个成员初始化2B/44单列，总7请求/154 Credit，四原快照均通过。69公开文件manifest SHA `1d57885b64b6036ab53f5a657ffd19446a934c78f731849327fcdb56fdfe041c`，已记录PID/4端口/BH及21 helper终态。此项不替代G04h空身份登录，也不声称OS Read handler等待字节期间的Native撤权。

## Standalone Web完整DOM完成（Electron41，2026-10-19）

[Web v8联测](client-web-standalone-dom-test-2026-10-19.md)以正常Web/Server产物完成无认证401、原Cookie bootstrap/200、未配置身份、原FirstRun、原目录选择、文件预览及一次reload后的Cookie/引导/项目/文件恢复，11项业务标志全true、uiDriver exit0，无模型发送或企业登录动作。不是Desktop产品Main，也未注入身份或Cookie。

Root独核9公开文件/23 journals，275已知PID及两端口均闭。controller exit1仅因根FD扫描不完整而保留私有根，不能写成controller全绿或写者零。旧Chrome导航超时原样保留、根因未唯一确定；本结果限Electron41 Web，不代表Chrome安装、自动重连、Web企业认证或跨平台。[本机阶段结果与剩余边界](client-local-integration-acceptance-2026-10-19.md)另列已完成G04i v5及跨环境待验项，U02–U05未整体勾选。

## G07d Read 返回结果的权限与账号复验

[修复与复测](client-read-result-authorization-test-2026-10-18.md)已覆盖文件端口等待期间撤权、原 owner/端口改变、管理模式变化、取消与不合作授权端口的原 deadline。正文在序列化、PostToolUse 和成功结果发布前扣留，迟到 allow 不重复发布。正式 Core119/Host292、根及CLI标准typecheck、Lint、格式和架构通过；正常CLI/Desktop重新构建并核对全部来源和产物。

新打包CLI经真实本机后台、Host relay和OS文件完成禁读/禁写/允许Read正文/允许Write/同会话撤权五阶段；Token记录字段遗漏修复后全新复测通过。实际11次供应商请求、11笔settled账本，55 input/22 output Token、99 Credit，凭据未进入CLI流或模型RPC。Native原界面分别由G07c v3和G04h v8另验；实际OS阻塞读期间的Native撤权仍不由本项或发送前撤权替代，U02–U05暂保持原范围。

## G04i 插件安装到Skill正文消费桥（v5通过）

原PluginManagementService、正常新CLI及自有HTTP/FS已实际贯通安装记录、启用状态、非默认manifest根与别名：普通成员的D/S两个新App分别读取禁用/启用catalog；同S首轮A正文及baseDirectory进入后继模型，发布personal.skills=false后未消费B被拒且无B正文，恢复目录无额外模型。baseline全0、原发送2次，实际2A+标题1+2B共5请求/5settled/5Trace、25 input/10 output、45 Credit；request与ledger按真实复合键关联，Trace/supplier独立。详见[G04i报告](client-plugin-skill-bridge-test-2026-10-19.md)。G04f Native生命周期不重演，v1–v4零模型失败原封存保留，不把相位直接当作产品根因。

## W02 Web 成功连接后断线与原 Retry 恢复（v4通过）

[W02 联测](client-web-disconnect-recovery-test-2026-10-19.md)补上 W01 手动新 WS 与 Web v8 reload 未覆盖的成功后断线。原 RPC 和浏览器均取得真实 RED；修复连接关闭时释放 RPC/旧 Root，并在复测中修复三个服务 Hook 随恢复路径改变调用序列的错误。最终 42 项相关回归、完整门禁及正常 Server/Web/Desktop 构建通过，源码与产物均独立核验。

最终 v4 在 Electron41 独立 Web 中沿原界面完成目录/文件→精确自有 Server 断开→匹配 WS Closed 与错误页→四种宽度/Tab→同配置 Server 恢复→唯一 Enter Retry→新 document、Cookie200、原项目/文件恢复，console0/script0，文件字节不变。三 UI driver exit0，控制器 exit1 仅因 FD 查询不完整按原策略保留目录；305 个已知 PID 与两端口已独立核对关闭。此项没有企业登录或发送模型动作，不替代 Native UI、自动重连、Web 企业认证、Chrome 和平台安装验收；U02–U05、T13 边界不变。
