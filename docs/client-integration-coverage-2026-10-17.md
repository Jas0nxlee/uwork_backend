# UWork 客户端与后端持续联动覆盖

2026-10-17。当前目标为继续自动覆盖所有尚未验证的真实联动，发现问题修复并复测。真实企微、外部 MCP 和网盘按用户要求排除。本表保留未完成项；通过一个层次不自动证明其他层次或整个项目完成。

判定依据是 `SPEC-uwork-client.md`、`SPEC-client-policy.md`、`SPEC-ai-assets.md` 及客户端 enterprise specs、实际 UI/Host/CLI 入口、测试代码和执行证据。原始审计在 ignored `evidence/client-coverage-audit-20261017/`。只审计当前支持的行为，不为了造通过而增加云服务、远端身份或协作产品。

## 既有能力与证据层次

| 能力                                                   | 当前已证实层次                                                                 | 仍需单列的边界                                                                   |
| ------------------------------------------------------ | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| 交互身份、issuer、企业/成员切换、私有会话存储与撤销    | 后端 HTTP、实际 Host/加密存储、CLI；Native 注销和重启                          | 真实企微明确不测；原生企业选择对话框切换尚未等同私有 Host 测试                   |
| 成员角色/部门/企微映射、席位和有效额度                 | 249 项后端基线、129 次用户链路 HTTP、24 HTTPS/Host、Native 角色/额度/席位/会话 | 基线报告 `client-user-journey-test-2026-10-17.md`；本轮未重复付费生成            |
| 后端模型目录、默认选择、能力与参数、私有 Keyless relay | Registry/SDK、真实 HTTPS/Host、当前打包 CLI、Native 实际对话                   | 当前正式 CLI 与 staged SHA 相同；安装包和远程模型出口分别验收                    |
| JSON/SSE、取消、私有输出防泄露、账务终态               | 真实 TCP、SDK、打包 CLI、Native 停止和退出                                     | uncertain 是保守预留，不推断远端费用或副作用退款                                 |
| 企业技能发布/下载/缓存/更新/撤权                       | HTTP、Host、真实磁盘、打包 CLI；本轮 Native Skill 工具及后继模型上下文         | 缓存故障组合及个人技能生产入口仍见下表                                           |
| 企业专家                                               | 版本/正文校验、既有子智能体 owner、打包 CLI 读取与撤权                         | 泛用 Agent 子任务不能替代 Native 指定企业专家正文执行                            |
| 受控连接器                                             | 本机 MCP 与真实 Host/CLI/后端合同、逐次准入和回收                              | 外部 MCP 明确排除；不把技能文件缓存当连接器权限                                  |
| 已发布菜单、欢迎和风险提示                             | HTTP/Host、真实 Sidebar 浏览器；本轮 production Electron 动态发布/路由/退出    | 隐藏入口不等于禁止全部快捷键；实际执行另有渠道守卫                               |
| 个人模型/技能/连接器、危险技能策略                     | 真实 Host/source/adapters 与已存在合同；后台配置矩阵                           | 本轮未补完全部正式 builtin/Native 生产出口，见 G06/G07                           |
| 分享、文件、网络/域名/席位与身份变更                   | 本轮真实文件 DB+HTTP+现 Host+真实受控分享服务；实际 multipart/hash             | 公网链接不可当组织协作；不是正式外部分享服务或 Native 分享对话框验收             |
| 兼容后端 Agents/runs API、本人任务与取消               | `client-console-contract-smoke.ts` 实际 HTTP/Host，后台 Runtime 测试           | 与本地自动化菜单独立；不由菜单跳转推断后端任务执行                               |
| 本地自动化                                             | 本轮 Native 创建、立即运行、渠道拒绝、重启后再次运行与真实供应商/计量          | 已接受次数不等于成功次数；绑定已有任务的 resume 分支仍待专项联动                 |
| 审计、Trace、用量与客户端事件                          | 后端全量/导出/脱敏及既有实际客户端 HTTP 证据                                   | 用量隔离已验；不把合成事件当全平台遥测部署验收                                   |
| Web/手机 attachment、远端 workspace                    | 已有 transport/owner 合同及基础单元                                            | 当前 UWork 后台权限贯穿真实 transport 的组合证据仍未完成；本机窄屏不替代手机连接 |
| 云助手/组织协作/微信与企微分享                         | 后台布尔准入已有验证                                                           | 没有对应本地产品出口/外部合同，不能以 200 或配置布尔声称真实云/协作成功          |
| Windows/Linux/macOS 发行安装及生产目标机               | macOS 仓库构建的独立 Electron、CLI、后端镜像可运行                             | 已安装发行包、Windows/Linux runner 和生产主机/远端 CI 保留未验收                 |

## 尚缺组合证据的执行矩阵

此表不要求无穷输入笛卡尔积。每项需要对应的实际允许、拒绝/更新、异步边界和清理证据。测试脚本存在、方法返回 200 或目录文件存在不能单独勾完成。

| ID  | 原缺口                                         | 当前新增证据                                                                                                                                                    | 剩余工作                                                                          |
| --- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| G01 | 跨企业/issuer 资产缓存和当前交互身份           | **完成 HTTP/Host/打包 CLI 层**：2 项、279 次 HTTP、4 个 CLI；A→B→A 当前版本、旧下载迟到、双 issuer、冷恢复、禁用/恢复及退出                                     | Native 组织选择界面不由此替代                                                     |
| G02 | 资产正文进入实际会话、子任务及恢复             | **部分完成**：Native Skill v1→v2 的正文实际进入后继模型请求；撤权新会话无正文；打包 CLI Agent 子任务正反例 2 项                                                 | Native 指定企业专家；已绑定任务 resume/工作流资产消费组合                         |
| G03 | 损坏/并发/崩溃缓存贯穿实际 Host+CLI            | **部分完成**：3 项、315 次 HTTP、9 CLI；篡改/缺文件/symlink 均准确拒绝，冷恢复不静默修复，显式隔离后恢复                                                        | 双 Host 并发/安装 SIGKILL 的实际 Host→CLI 组合仍保留，不能由 adapter 历史证据替代 |
| G04 | Native 菜单/欢迎/risk 动态发布与身份变化       | **部分完成**：草稿/发布、禁用隐藏、名字/顺序/既有页面、退出；另延迟真实配置响应后旧可见菜单点击确实被拒，未路由                                                 | 自定义 HTTPS 页面与原生身份切换迟到响应                                           |
| G05 | 助理渠道与真实本地自动化入口                   | **部分完成**：UI 创建→run-now→实际模型；关闭 local 后无供应商派发；重启后持久化并再运行                                                                         | 绑定已有任务 resume、agents/全局作用域与自动化的组合；不冒领真实云/移动           |
| G06 | 个人模型/技能/本机 MCP 的生产入口开关          | **部分完成**：Native 个人模型创建拒绝不改文件，允许后创建/配置/发现及真实 CLI 调用；同会话撤权后无新增派发；两条提示修复复测                                    | 个人技能/本机 MCP 的生产入口开关与原生退出/更新组合                               |
| G07 | 正式 CLI builtin Read/Write/Bash/WebFetch 出口 | **完成指定 Host/CLI 切片**：新增 5 项，原 stdio/Agent 回归合计 12/12；真实文件/进程副作用与 yolo/批准/Hook 后撤权，WebFetch 域名拒绝及真实 SSRF 拒绝            | 公网 WebFetch 正向、Native 工具 UI 与平台限制分别验收，不据 server0 冒领网络成功  |
| G08 | 分享文件完整允许/撤权出口                      | **完成指定 Host/service 切片**：5 项新测试+26 回归，299 次 HTTP；生产文件源 stat/read→自动 manifest/hash→实际 multipart→confirm，并测 prepare/upload 后撤 files | Native 分享 UI、正式外部分享及组织协作独立保留；不回滚已发生的分享/上传副作用     |

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

本轮生产改动仅为上述两条 UI 提示及 exact-code 映射，无后端/Host/CLI 权限逻辑修改。后端/admin 类型、新脚本 Lint/格式、客户端全类型/Lint/定向格式/架构和 Native 构建通过；客户端保留 114 条既有警告、0 错误，架构 0 新违例。新增切片及共享夹具经独立只读审查通过。主后端保持运行，未读取主 .env 或解密主 Vault；只读校验主业务表哈希，确认原资源/配置/成员/账本等未变，不调用真实付费供应商。Git 中另有不属于本轮的未跟踪 `tests/security-sixth-provider-echo.test 2.ts`，保留且不纳入提交。

本目标仍在推进：G03/G06、G02/G04/G05 的剩余组合和可运行 Web/remote 入口尚需继续验证。不能据本表局部成功宣称“全部测试已覆盖”，也不关闭原 T13c6/T13d/平台验收项。
