# 企业用户配置、权限与用量的追加真实联测

2026-10-17。本轮继续验证现有客户端与后台链路，发现权限绕过后直接修复，再以实际 Host、正式 CLI 和原生客户端复测。全部开发位于本仓库的 `clients/uwork`，未修改外部客户端仓库。真实企微、外部 MCP 和网盘仍按用户要求排除。

## 发现并修复的权限问题

实际父模型调用企业专家，退出 CLI 并恢复原任务后，撤权的企业专家名称会匹配同名个人 profile。最初 `personal.skills=false` 已实际复现；补充开放个人能力的场景后，旧企业名称仍会静默回退。受控供应商收到的真实子模型 system 包含个人正文 marker，原始失败保留，不能以目录内容或测试预期替代这个发现。

修复沿用既有目录、profile registry、身份 owner 和工具准入：

- 同一次企业目录结果决定本次 profile 装配。缺少必需端口、拒绝、异常或取消都不能形成个人允许结论；失败也不保留部分已加载 profile。
- 托管模式下，个人 profile 使用 `personal:<source>:<name>`，必须精确选择。用户、项目、插件及 runtime 注入项不能自报 enterprise/built-in 来豁免检查。旧 plain 名不再回落到个人 profile；独立模式保留既有名字和匹配方式。
- 个人子智能体在读取个人上下文之前，以及每次新模型请求之前，按当前 `personal.skills`、文件权限和危险技能策略准入，并绑定当前 owner。等待 memory、模型 factory、override、bind 和 lazy stream 都不能保留过期允许。
- 沿既有 exact-code resolver 补个人专家拒绝的本地化提示；单测验证映射，不把供应商任意正文改写成错误提示。

该修复不删除合法历史消息，不迁移或删除个人记忆文件，也不承诺回滚已经获准的请求或副作用。已运行企业专家的合法版本快照与新 runtime 重新加载当前版本分别按既有规格验证。

顺带修正 Core 公开入口中两个接口的值导出为 type 导出；新增公开值导入时暴露的源码 ESM 加载错误已通过原入口回归，而不是绕过模块边界。

## 默认任务创建与返回合同

追查正式 Host 自动化派发时，又实际复现了三项公开合同问题：

- 合法 `createTask` 不传可选的延迟持久化字段，创建成功后首次 `sendPrompt` 触发外键错误。协议 immediate 标签不能证明 runtime 已写入 session 主记录；输入 admission 改为先调用已有的幂等持久化 owner，再保存输入，不手补 SQL、不吞错误，也不要求调用者添加规避参数。
- 请求 yolo 且实际 runtime 为 yolo，任务和 session 元数据却返回 build。活跃 session 的 mode 改为优先读取原 runtime；无活跃 app 的历史 session 仍读取投影，不增加另一份模式状态。
- `readSessionMessages` 直接返回 Core 的内部字段，遭 Host 严格 schema 拒绝。原分页、游标处理后复用 snapshot 已使用的 wire mapper，保留消息/部件 ID 和正文，不放宽客户端协议校验。

三项实际失败均保留在 `evidence/client-automation-bound-resume-20261017/` 的各自 RED 子目录。最初带可选 deferred 的测试通过不代表默认调用正确，后来已更正这个判定；原始失败没有被归为驱动问题或跳过。对应模式、冷历史、严格 tool wire 和分页的四项定向单测通过；最终真实 Host 测试同时检查默认首发、模式一致、历史可读和重启后原消息 ID。

## 正式 CLI 与原生客户端复测

当前正式 CLI 与 Desktop staged CLI 的 SHA256 均为：

`0d9588624db3368787cbbd86c3d27a92b327e1d169614f1b1162f7e61895454c`

四项专家实测覆盖企业 v1 正文、运行中快照与发布 v2、冷恢复原 session 后使用 v2、撤权后无同名个人回退，以及显式 canonical 个人选择后再关闭个人权限。恢复通过正式 V4 conversation subscribe，不以新建任务代替恢复。

专家四项与 stdio、Agent、builtin、个人技能/连接器的相关十五项，在同一最终产物上共 **19/19 通过**。连同缓存/启动清理三项、公共 WebFetch 一项及独立 production Host 默认任务/绑定自动化一项，最终 **24/24 个不重复的真实用例通过**；Native 和 standalone 网络证据另列。前述十九项产生实际 1,569 次后台 HTTP、92 次受控供应商请求，对应 92 条账本；90 settled、2 uncertain，后两项属于取消场景的保守预留。该十九项的 22 个 CLI 已退出，57 个基础监听端口和另外 3 个本机 MCP 端口关闭，19 个临时根移除。个人能力三项包含在这十九项中，不能重复相加。

另外以 production Electron/Main/Host 和同一 staged CLI 走实际 DOM：发送企业专家任务，真实子模型 system 含批准的企业正文，不含同名个人正文。随后通过真实管理 HTTP 撤权，确认第一组 Electron 进程全部退出后重启，在实际侧边栏打开原任务并再次调用旧名称。新调用的工具结果为专家不可用，原 session 保持相同，新增两个父请求、零个子请求，没有个人回退。该隔离 Native 共 8 次供应商/8 settled，其中 2 次是另一成员的初始化对照，6 次来自上述 Native 操作。

Native 的拒绝判定来自当前 tool_call_id 对应的实际工具结果和子请求数量；受控供应商固定生成的“完成”文本不被当作权限判断。恢复后合法历史仍在，也不把历史 tool 消息当作撤权后的新执行。

身份初始化使用真实 email 登录 HTTP，再写入生产加密存储，由原身份 owner 恢复。没有调用或冒领真实企微扫码。供应商为自有 loopback 服务，测试验证真实协议、请求正文和计量关联，不是正式 UCAS 服务的费用或可用性验收。

## 其他追加覆盖

G03 补真实双 Host/CLI 并发和安装中 SIGKILL 两项。并发使用同加密身份与磁盘缓存，旧 manifest 迟到不能清理新选择；中断命中第 21 个实际 stage 正文文件且 manifest 尚未写入，随后新 Host/CLI 只发现当前完整 v3。旧版本拒绝、未提交 stage 回收，工作区哨兵不变，无模型或工具副作用重放。与先前三项损坏场景合起来覆盖五种已列明故障；本机 macOS 结果不推断其他操作系统。

G06 三项实际 CLI 覆盖用户/项目 Skill 正文进入下一模型请求、两个个人技能策略开关的即时拒绝、本机受控 HTTP MCP 的正向 marker 与关闭连接器后零新增帧/调用，以及真实 identity owner 注销后的现有 runtime 无新增模型/MCP 派发。拒绝不修改个人配置文件；合法历史不作泄漏判定。这里的本机 MCP 仍不是用户排除的外部 MCP 服务。

生产 standalone Web/Server 两项通过：实际正式 tsup/Vite 产物、HTTP token/Cookie、静态 JS、真实 WS/RPC、物理文件写盘及新 WS 重连读取；一次性 Host capability 首用成功、重放拒绝、真实等待 30,100 ms 后过期拒绝。普通客户端不能靠旧 mode header 调 Provisioning。该入口的企业身份/Gateway 实际未配置且模型为空，这是独立模式的拒绝边界，不是企业登录成功或远程模型验收。

公共 HTTPS WebFetch 另外通过正向和同 runtime 域名撤权：真实公共正文进入提取模型，短工具结果进入后继主模型；移除目标域名后实际工具被拒、没有目标 network_request 帧或新提取请求。保留本机受控模型出口的允许域名，不通过修改 DNS、TLS、SSRF 或替换响应造成功；不声称持有公共站点访问日志。

绑定已有任务的自动化走实际 CronCreate 注入 targetTaskId，再调用 production Host 的 runAutomationNow：允许执行、关闭 local 拒绝且模型/账本零新增、恢复权限并重启 Host/CLI 后在原 task 再执行。该项最终 90 次后台 HTTP、52 次实际服务 RPC、3 次供应商/3 settled，5 个自有 PID、3 个端口及临时根已清理。它不是手动 sendText 代替自动化，也不替代 Main 定时 scheduler 或 Native 按钮。尚未证实的 Native 菜单身份切换、自定义 HTTPS 页面、分享 UI、动态工作流和跨平台安装继续保留在覆盖矩阵。

## 门禁、证据与主环境

- Core 定向 25/25、任务读取合同 4/4、Host/UI 定向 15/15、真实资产合同 4/4、SDK 合同 1/1 通过。这些是不同验证层次，不相加为覆盖率。
- 后端/admin 类型、客户端根类型/Lint、CLI 类型/Lint、严格测试类型、定向格式和架构检查通过，架构 0 违例。根 Lint 的 114 条和 CLI Core 的 11 条既有警告保留，没有降低规则或跳过测试。
- 正式 CLI、Native Desktop、Server tsup 和 Web Vite 构建通过；构建守卫排除客户端根 `.env*`，主 `.env` 未读取，主 Vault 未解密。
- 原生测试两次 Electron 的 12 个进程及夹具父进程均退出（共 13 个 PID），4 个端口关闭，专属数据根和 browser-harness daemon 已清理。其他真实测试各自保留退出、端口和目录证明。
- 主后台 `/health` 为 200，业务表只读哈希与之前基线一致，原配置、成员、凭据、资源和账本未改，不调用主供应商。用户无须手动操作。

最后统一使用 CLI 工作区的 0.47 格式工具检查 15 个改动文件。此前根格式工具忽略 CLI 子树的问题已纠正；六个文件只整理格式，规范化 TypeScript→JavaScript 前后完全一致。格式后再次执行正式 ordered build/stage，CLI 字节 SHA 仍为上述最终值，因此既有实际运行证据仍对应同一产物；没有因格式整理重跑已绿的真实套件。

原始证据位于 ignored `evidence/client-expert-resume-20261017/`、`evidence/client-native-final-current-20261017/`、`evidence/client-assets-concurrency-crash-20261017/`、`evidence/client-personal-ports-20261017/`、`evidence/client-automation-bound-resume-20261017/`、`evidence/client-webfetch-public-20261017/` 和 `evidence/client-web-standalone-20261017/`。正式规格和可复跑脚本保存在仓库，原始失败、驱动准备错误和产品缺陷分开标注。

继续以 [覆盖矩阵](client-integration-coverage-2026-10-17.md) 管理剩余边界，不把本轮通过宣称为全部功能或生产环境已经验收。
