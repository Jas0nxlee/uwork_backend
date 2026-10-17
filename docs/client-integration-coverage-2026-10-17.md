# UWork 客户端与后端持续联动覆盖

2026-10-17。当前目标为继续自动覆盖所有尚未验证的真实联动，发现问题修复并复测。真实企微、外部 MCP 和网盘按用户要求排除。本表保留未完成项；通过一个层次不自动证明其他层次或整个项目完成。

判定依据是 `SPEC-uwork-client.md`、`SPEC-client-policy.md`、`SPEC-ai-assets.md` 及客户端 enterprise specs、实际 UI/Host/CLI 入口、测试代码和执行证据。原始审计在 ignored `evidence/client-coverage-audit-20261017/`。只审计当前支持的行为，不为了造通过而增加云服务、远端身份或协作产品。

## 既有能力与证据层次

| 能力                                                   | 当前已证实层次                                                                                    | 仍需单列的边界                                                          |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 交互身份、issuer、企业/成员切换、私有会话存储与撤销    | 后端 HTTP、实际 Host/加密存储、CLI；Native 注销和重启                                             | 真实企微明确不测；原生企业选择对话框切换尚未等同私有 Host 测试          |
| 成员角色/部门/企微映射、席位和有效额度                 | 249 项后端基线、129 次用户链路 HTTP、24 HTTPS/Host、Native 角色/额度/席位/会话                    | 基线报告 `client-user-journey-test-2026-10-17.md`；本轮未重复付费生成   |
| 后端模型目录、默认选择、能力与参数、私有 Keyless relay | Registry/SDK、真实 HTTPS/Host、当前打包 CLI、Native 实际对话                                      | 当前正式 CLI 与 staged SHA 相同；安装包和远程模型出口分别验收           |
| JSON/SSE、取消、私有输出防泄露、账务终态               | 真实 TCP、SDK、打包 CLI、Native 停止和退出                                                        | uncertain 是保守预留，不推断远端费用或副作用退款                        |
| 企业技能发布/下载/缓存/更新/撤权                       | HTTP、Host、真实磁盘、打包 CLI；本轮 Native Skill 工具及后继模型上下文                            | 本机缓存故障和 Native 导入已补测；其余管理入口与跨平台见下表            |
| 企业专家                                               | 当前正式 CLI 的 v1/v2、同 session 冷恢复、撤权及个人别名隔离；Native 指定企业专家正文和撤权冷恢复 | 动态工作流资产消费与运行中的合法快照按各自规格验收                      |
| 受控连接器                                             | 本机 MCP 与真实 Host/CLI/后端合同、逐次准入和回收                                                 | 外部 MCP 明确排除；不把技能文件缓存当连接器权限                         |
| 已发布菜单、欢迎和风险提示                             | HTTP/Host、真实 Sidebar 浏览器；本轮 production Electron 动态发布/路由/退出                       | 隐藏入口不等于禁止全部快捷键；实际执行另有渠道守卫                      |
| 个人模型/技能/连接器、危险技能策略                     | Native 个人模型；实际 CLI 用户/项目 Skill、本机 MCP 开关及真实 identity 注销                      | Native 技能导入/连接器设置已实际验证；其余管理入口和跨平台仍单列        |
| 分享、文件、网络/域名/席位与身份变更                   | 本轮真实文件 DB+HTTP+现 Host+真实受控分享服务；实际 multipart/hash                                | 公网链接不可当组织协作；不是正式外部分享服务或 Native 分享对话框验收    |
| 兼容后端 Agents/runs API、本人任务与取消               | `client-console-contract-smoke.ts` 实际 HTTP/Host，后台 Runtime 测试                              | 与本地自动化菜单独立；不由菜单跳转推断后端任务执行                      |
| 本地自动化                                             | Native 创建/立即运行、绑定原任务；完整 Main 自然到期和重启恢复、当前权限拒绝及真实计量            | 已接受次数不等于成功次数；agents/全局作用域及移动云助手仍单列           |
| 审计、Trace、用量与客户端事件                          | 后端全量/导出/脱敏及既有实际客户端 HTTP 证据                                                      | 用量隔离已验；不把合成事件当全平台遥测部署验收                          |
| Web/手机 attachment、远端 workspace                    | 正式 standalone Web/Server HTTP/静态 JS、真实 WS/RPC 与重连、Host ticket 首用/重放/30s 到期       | 普通 Docker File/System 断开/重连已补测；managed 远端/手机仍另列        |
| 云助手/组织协作/微信与企微分享                         | 后台布尔准入已有验证                                                                              | 没有对应本地产品出口/外部合同，不能以 200 或配置布尔声称真实云/协作成功 |
| Windows/Linux/macOS 发行安装及生产目标机               | macOS 仓库构建的独立 Electron、CLI、后端镜像可运行                                                | 已安装发行包、Windows/Linux runner 和生产主机/远端 CI 保留未验收        |

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
| G07 | 正式 CLI builtin Read/Write/Bash/WebFetch 出口 | **指定 Host/CLI 切片完成**：原5项真实副作用及批准/Hook/yolo后撤权；补公共HTTPS正文→提取→后继模型，同runtime移除域名后拒绝且0目标网络帧                          | Native 工具 UI 与各平台限制分别验收，不能推广为任意网站或带身份页面成功                                              |
| G08 | 分享文件完整允许/撤权出口                      | **完成指定 Host/service 切片**：5 项新测试+26 回归，299 次 HTTP；生产文件源 stat/read→自动 manifest/hash→实际 multipart→confirm，并测 prepare/upload 后撤 files | Native 分享 UI、正式外部分享及组织协作独立保留；不回滚已发生的分享/上传副作用                                        |

## 新增实测的具体边界

Native 使用独立 HOME、数据根、真实后台文件 DB/TLS、自有 CA 和 production Electron/Main/Host/staged CLI。通过实际 DOM 输入、点击、可用的原生选择器及正式启动参数操作，锁屏后的系统选择器未验收；未注入 React 状态或替换业务响应。身份初始会话来自真实 email 登录 API，写入生产加密存储后由原身份 owner 恢复，**不是真实企微扫码**。

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

本目标仍在推进：G02/G03/G04/G05/G06 的下述指定切片已补完；Native 技能其余管理、workflow/身份切换/分享 UI、managed remote/手机和跨平台安装继续保留。standalone Web 的两项网络实测不等于 managed enterprise 远端验收。不能据本表局部成功宣称“全部测试已覆盖”，也不关闭原 T13c6/T13d/平台验收项。

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

公开商店排序、offPeak 旧 plan 入口、原生 chooser、OS 外链、生产安装包/跨平台，以及上述原有远端/分享/组织切换边界继续保留。同 Main 并发第二 Root 当前没有产品 UI/命令入口，应标当前 UI 不适用；普通 Renderer reload 复用原 Host，不能冒称 Host 代次恢复。[只读依据与可行生命周期方案](../evidence/client-native-window-child-readonly-20261017/plan.md) 分开记录尚未运行的 owned Host 崩溃恢复。定时表单模型选择区的截图疑点已在另一独占 Native 连续三次判别为正常 200ms 动画；0.5/1 秒后只有一个稳定 label，无产品修改。真实企微、外部 MCP、网盘仍按用户要求排除。
