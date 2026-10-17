# UWork 客户端与后端持续联动覆盖

2026-10-17。当前目标为继续自动覆盖所有尚未验证的真实联动，发现问题修复并复测。真实企微、外部 MCP 和网盘按用户要求排除。本表保留未完成项；通过一个层次不自动证明其他层次或整个项目完成。

判定依据是 `SPEC-uwork-client.md`、`SPEC-client-policy.md`、`SPEC-ai-assets.md` 及客户端 enterprise specs、实际 UI/Host/CLI 入口、测试代码和执行证据。原始审计在 ignored `evidence/client-coverage-audit-20261017/`。只审计当前支持的行为，不为了造通过而增加云服务、远端身份或协作产品。

## 既有能力与证据层次

| 能力                                                   | 当前已证实层次                                                                                    | 仍需单列的边界                                                              |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 交互身份、issuer、企业/成员切换、私有会话存储与撤销    | 后端 HTTP、实际 Host/加密存储、CLI；Native 注销和重启                                             | 真实企微明确不测；原生企业选择对话框切换尚未等同私有 Host 测试              |
| 成员角色/部门/企微映射、席位和有效额度                 | 249 项后端基线、129 次用户链路 HTTP、24 HTTPS/Host、Native 角色/额度/席位/会话                    | 基线报告 `client-user-journey-test-2026-10-17.md`；本轮未重复付费生成       |
| 后端模型目录、默认选择、能力与参数、私有 Keyless relay | Registry/SDK、真实 HTTPS/Host、当前打包 CLI、Native 实际对话                                      | 当前正式 CLI 与 staged SHA 相同；安装包和远程模型出口分别验收               |
| JSON/SSE、取消、私有输出防泄露、账务终态               | 真实 TCP、SDK、打包 CLI、Native 停止和退出                                                        | uncertain 是保守预留，不推断远端费用或副作用退款                            |
| 企业技能发布/下载/缓存/更新/撤权                       | HTTP、Host、真实磁盘、打包 CLI；本轮 Native Skill 工具及后继模型上下文                            | 缓存故障组合及个人技能生产入口仍见下表                                      |
| 企业专家                                               | 当前正式 CLI 的 v1/v2、同 session 冷恢复、撤权及个人别名隔离；Native 指定企业专家正文和撤权冷恢复 | 动态工作流资产消费与运行中的合法快照按各自规格验收                          |
| 受控连接器                                             | 本机 MCP 与真实 Host/CLI/后端合同、逐次准入和回收                                                 | 外部 MCP 明确排除；不把技能文件缓存当连接器权限                             |
| 已发布菜单、欢迎和风险提示                             | HTTP/Host、真实 Sidebar 浏览器；本轮 production Electron 动态发布/路由/退出                       | 隐藏入口不等于禁止全部快捷键；实际执行另有渠道守卫                          |
| 个人模型/技能/连接器、危险技能策略                     | Native 个人模型；实际 CLI 用户/项目 Skill、本机 MCP 开关及真实 identity 注销                      | Native 技能/连接器设置 UI、跨平台出口不由 CLI 代替                          |
| 分享、文件、网络/域名/席位与身份变更                   | 本轮真实文件 DB+HTTP+现 Host+真实受控分享服务；实际 multipart/hash                                | 公网链接不可当组织协作；不是正式外部分享服务或 Native 分享对话框验收        |
| 兼容后端 Agents/runs API、本人任务与取消               | `client-console-contract-smoke.ts` 实际 HTTP/Host，后台 Runtime 测试                              | 与本地自动化菜单独立；不由菜单跳转推断后端任务执行                          |
| 本地自动化                                             | 本轮 Native 创建、立即运行、渠道拒绝、重启后再次运行与真实供应商/计量                             | 已接受次数不等于成功次数；绑定已有任务的 resume 分支仍待专项联动            |
| 审计、Trace、用量与客户端事件                          | 后端全量/导出/脱敏及既有实际客户端 HTTP 证据                                                      | 用量隔离已验；不把合成事件当全平台遥测部署验收                              |
| Web/手机 attachment、远端 workspace                    | 正式 standalone Web/Server HTTP/静态 JS、真实 WS/RPC 与重连、Host ticket 首用/重放/30s 到期       | standalone 企业身份实际未配置；managed 远端/手机 attachment、浏览器渲染另列 |
| 云助手/组织协作/微信与企微分享                         | 后台布尔准入已有验证                                                                              | 没有对应本地产品出口/外部合同，不能以 200 或配置布尔声称真实云/协作成功     |
| Windows/Linux/macOS 发行安装及生产目标机               | macOS 仓库构建的独立 Electron、CLI、后端镜像可运行                                                | 已安装发行包、Windows/Linux runner 和生产主机/远端 CI 保留未验收            |

## 尚缺组合证据的执行矩阵

此表不要求无穷输入笛卡尔积。每项需要对应的实际允许、拒绝/更新、异步边界和清理证据。测试脚本存在、方法返回 200 或目录文件存在不能单独勾完成。

| ID  | 原缺口                                         | 当前新增证据                                                                                                                                                          | 剩余工作                                                                                         |
| --- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| G01 | 跨企业/issuer 资产缓存和当前交互身份           | **完成 HTTP/Host/打包 CLI 层**：2 项、279 次 HTTP、4 个 CLI；A→B→A 当前版本、旧下载迟到、双 issuer、冷恢复、禁用/恢复及退出                                           | Native 组织选择界面不由此替代                                                                    |
| G02 | 资产正文进入实际会话、子任务及恢复             | **补完指定专家切片**：原 Native Skill；当前 CLI 专家 4 项；Native 实际 Agent 使用批准正文，撤权后重启/打开原任务，旧名称不可用且无个人子请求                          | 真正动态工作流资产消费组合；不由普通 session resume 代替自动化                                   |
| G03 | 损坏/并发/崩溃缓存贯穿实际 Host+CLI            | **已列五类故障完成**：原 3 项315 HTTP/9CLI，加真实双 Host、部分 stage SIGKILL 两项131 HTTP/4CLI；当前新 CLI 再验证                                                    | 本机 macOS 结果不替代 Windows/Linux 的安装/进程语义                                              |
| G04 | Native 菜单/欢迎/risk 动态发布与身份变化       | **部分完成**：草稿/发布、禁用隐藏、名字/顺序/既有页面、退出；另延迟真实配置响应后旧可见菜单点击确实被拒，未路由                                                       | 自定义 HTTPS 页面与原生身份切换迟到响应                                                          |
| G05 | 助理渠道与真实本地自动化入口                   | **指定 Native/Host 切片完成**：原 Native 创建/立即运行/重启；补真实 CronCreate 绑定原 task→production Host run-now，关闭 local 无新增派发，恢复权限并重启仍执行原任务 | Main 定时 scheduler、agents/全局作用域组合、移动云助手仍单列；默认 task 及消息合同修复见追加报告 |
| G06 | 个人模型/技能/本机 MCP 的生产入口开关          | **指定 Host/CLI 切片完成**：原 Native 个人模型；新增用户/项目 Skill、本机受控 MCP、实际 owner 注销 3 项；当前新 CLI 回归通过                                          | Native 技能/连接器设置界面与更广身份切换 UI；外部 MCP 仍排除                                     |
| G07 | 正式 CLI builtin Read/Write/Bash/WebFetch 出口 | **指定 Host/CLI 切片完成**：原5项真实副作用及批准/Hook/yolo后撤权；补公共HTTPS正文→提取→后继模型，同runtime移除域名后拒绝且0目标网络帧                                | Native 工具 UI 与各平台限制分别验收，不能推广为任意网站或带身份页面成功                          |
| G08 | 分享文件完整允许/撤权出口                      | **完成指定 Host/service 切片**：5 项新测试+26 回归，299 次 HTTP；生产文件源 stat/read→自动 manifest/hash→实际 multipart→confirm，并测 prepare/upload 后撤 files       | Native 分享 UI、正式外部分享及组织协作独立保留；不回滚已发生的分享/上传副作用                    |

## 新增实测的具体边界

Native 使用独立 HOME、数据根、真实后台文件 DB/TLS、自有 CA 和 production Electron/Main/Host/staged CLI。只通过实际 DOM 输入、点击和原生目录选择器操作；未注入 React 状态或替换业务响应。身份初始会话来自真实 email 登录 API，写入生产加密存储后由原身份 owner 恢复，**不是真实企微扫码**。

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

本目标仍在推进：G03 和 G06 的指定 Host/CLI 缺口已补完；G02/G04/G05 的其余组合、Native 设置/分享 UI、managed remote/手机和跨平台安装继续保留。standalone Web 的两项网络实测不等于 managed enterprise 远端验收。不能据本表局部成功宣称“全部测试已覆盖”，也不关闭原 T13c6/T13d/平台验收项。

## 追加权限修复与新产物验收

详见 [企业权限追加联测报告](client-enterprise-authorization-test-2026-10-17.md)。实际发现并修复撤权企业专家回退到同名个人 profile 的问题。个人 profile 采用明确 canonical 名称，按同次目录装配，并在个人内容读取和每次新子模型请求前复核当前权限与 owner。当前正式 CLI 和 Desktop staged SHA 均为 `0d9588624db3368787cbbd86c3d27a92b327e1d169614f1b1162f7e61895454c`。

当前产物下专家4项及相关15项共19/19通过，1569后台HTTP、92供应商/92账本（90settled、2取消uncertain）；个人技能/MCP三项已在其中，不重复相加。Native 专家正向与撤权重启原任务复测另有8供应商/8settled（含另一成员初始化2），撤权后新Agent工具调用返回不可用，0个人子请求。实际工具结果决定拒绝，受控供应商的固定完成文案不决定权限。

独立 Web/Server 另有2/2真实网络场景：正式产物静态JS、Cookie/WS/RPC、真实文件写盘和重连、Host票据首用/重放/实际30100ms过期。企业身份实际signed-out/unconfigured、模型为空；没有伪造Desktop身份来制造企业成功。规范见 `docs/client-web-standalone-live-spec-2026-10-17.md`，证据 `evidence/client-web-standalone-20261017/validation.json`。

新门禁为Core25、任务读取合同4、Host/UI15、资产合同4、SDK1通过，根/CLI类型和Lint、严格测试类型、格式、架构0违例及正式构建通过。主后台health200，业务表只读哈希不变。全部结果按层次记录，保留未完成的U02/U03/U04/U05、T13c6/T13d及平台验收项。

追加发现并修复默认 task 首条输入外键失败、实际权限模式与元数据不一致、历史消息未转 wire 形状被严格 schema 拒绝。三项原始失败和默认首发/读取/绑定自动化的真实 Host 复测单列在 `evidence/client-automation-bound-resume-20261017/`，不把最初传可选deferred的成功当作默认调用成功。

最终候选为 `0d9588624db3368787cbbd86c3d27a92b327e1d169614f1b1162f7e61895454c`：Root相关23项和独立production Host默认任务/绑定自动化1项，共24个不重复真实用例通过。Native同产物专家允许/后台撤权/重启原task复测也通过；Core29（含任务读取4）及Host/UI15定向通过。格式后正式ordered重建仍为同一字节SHA，证据不混用中间fd6或原8663产物。未完成的Native设置/分享/身份界面、Main定时scheduler、动态工作流、managed远端和平台验收继续保留。
