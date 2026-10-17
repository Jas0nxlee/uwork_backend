# UWork 自有客户端配置控制面

状态：后台四类合同、管理页及客户端私有接线已实现并完成分层复核。真实管理页、同后台 Native 草稿/发布、上下文/追踪关闭、场景更新与重启已有实测；模板共享缓存与同 Host 目录 CAS 自冲突均已修复。新产物的原生首启、冷启均实际调用批准企业专家，父请求含 Desktop，子请求排除 Desktop 及同名个人覆盖，并逐条结算用量。公开商店排序、offPeak 旧 plan 入口、OS 外链及平台边界继续单列，不能宣称整个项目全验收。用户已明确选择补齐自有后台配置和管理页面，保留现有场景、帮助及桌面功能；不通过空响应掩盖旧接口 404。详见 [控制面 Native 记录](docs/client-native-experience-test-2026-10-17.md) 与 [企业专家最终联测](docs/client-native-experts-config-final-test-2026-10-17.md)。

## 范围与唯一所有者

在现有配置仓库新增 `scenes`、`help`、`desktop`、`plugin-store` 四种 kind，分别拥有独立草稿 revision、发布 version、放弃草稿和已有历史存储/审计。沿用现有租户 API `/api/tenants/:tenantId/configurations/:kind`，以及经鉴权的 `/api/client/configuration` 聚合读取；不增加旧匿名 `/api/v1/client/configs` 或 `/api/v1/client/scenes` 别名，不转发企业 token 给旧服务。现有历史只有存储，没有读取 API；本轮不冒称已有历史浏览或回滚界面。

后台配置仓库拥有发布事实。Host 的既有 `UWorkBackendSession`/企业身份 owner 负责当前身份与唯一私有读取，通过现有 presentation 投影只暴露验证后的所需字段。旧 `IClientScenesService`、`IClientConfigService` 保留 facade，由该投影无状态适配，不拥有另一份 accepted cache、token 或旧 HTTP 回退。Renderer 不接收模型 Key；Main 不接收身份 token，不保存全局 last-tenant 配置。

```text
管理界面 → 现有草稿/发布仓库 → 当前私有 Host scope → 验证/owner fence → 安全投影
                                                                    ├→ scenes / plugin facade → UI
                                                                    └→ 当前 window/child 绑定 → Main help / trace
CLI FIFO/reservation → 原 runtime-preferences 准备 → 本 turn context 快照 → 原模型/工具准入
```

本轮不新增云反馈工单、远端身份、自动安装插件、遥测上传地址或生产安装包动态工作流启用来源；模板不授予工具、文件、模型或助理执行权限。已有真实企微、外部 MCP、网盘排除不变。

## 后台数据合同

所有对象 strict，值字符串去首尾空白；localized text 为 `{cn?: string, en?: string}`，至少一种非空，客户端复用原语言回退。单项 ID 1–64 字符、标题每语言 ≤100、提示词每语言 ≤4000、说明每语言 ≤1000、canonical kebab 图标名 ≤64 且以小写字母开始。pluginOrder 的 record key 必须原本没有首尾空白，不能因自动 trim 把两个分类静默合并；原始 `__proto__` key 在 record 解析前拒绝，不能静默丢弃。列表中的 ID 正常 trim 后去重校验。未知执行字段、任意 `on_finish`、namespace、额外 options 或脚本控制字段拒绝。

| Kind         | 发布数据与初始值                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| scenes       | `{draftSuggestions:[],scheduledTemplates:[],offPeakTemplates:[]}`。各组最多 20 条，组内 ID 唯一；每项必需 id/title/prompt，可选 icon。draft 可带最多两项、去重的 `NAVIGATE:AUTOMATIONS` / `NAVIGATE:AUTOMATIONS:OFFPEAK` actions，以及 trim 后 1–200 字符的 opaque `pluginStableId`（只匹配已存在插件，不触发安装）。scheduled 必须有 cronExpr；offPeak 可带 description，ID 去掉 `/^item[-_]?/i` 前缀并转小写后不能是 `customize`，与现客户端相同。整 kind UTF-8 JSON ≤128 KiB。 |
| help         | `{communityUrls:{"zh-CN":null,"en-US":null},feedback:{mode:"disabled",url:null}}`。URL 只允许 HTTPS 且禁止用户名/密码，null 明确关闭。feedback 仅 disabled/external，external 必需 URL，disabled 必须 null。整 kind ≤16 KiB。managed 不回退旧内置反馈提交或上一企业 URL；unmanaged 保留已有本地帮助。                                                                                                                                                                             |
| desktop      | `{desktopContextPrompt:{enabled:false},rendererActionTrace:{enabled:false,sampleRatio:0,enabledGroups:[]}}`。ratio 0–0.2；groups 只允许 core/settings/workbench/extensions/automation/account，最多六项且唯一。保留现有本机授权、显式本地导出/TTFT 设置；不接受 URL、header、token、路径或模型配置。                                                                                                                                                                              |
| plugin-store | `{order:null}`。非 null 沿原 `PluginStoreOrder` 的 code/work 两种模式，每种可有 categoryOrder 与按 category 的 pluginOrder。只改变展示顺序，缺项继续原目录顺序，不授予安装/执行权限。每模式 categoryOrder 最多 64，pluginOrder 最多 64 个 category，每插件列表最多 100，所有 ID trim 后 1–200 字符，逐列表禁止重复；整 kind ≤64 KiB。                                                                                                                                             |

scheduled cron 必须同时通过后台语法和现有客户端 builder 的无损子集：分钟/小时/日期合法且无前导零；仅分钟间隔、小时整点间隔、每日、工作日、升序去重星期列表、每月日期、按天间隔。六段、固定月份/年份、月份步长、不可无损表示的星期范围或顺序拒绝。维护共享的验收样例并由实际客户端 predicate 和后台 validator 分别验证，不引入第二个调度 owner。

新增 kind 是聚合响应的可选扩展，旧的七种配置保持原字段和行为；新后台提供显式默认值与 version 0。客户端面对旧后台缺失字段须明确 unsupported/unavailable 并清旧身份派生值，保留原欢迎语等已支持字段，不能把缺失或请求失败伪造成已发布空配置。ETag 继续绑定版本和有效安全配置，草稿不影响客户端。

## 客户端时序与失效

私有读取必须验证 payload/tenant/current scope，并在结果消费前围住 owner、issuer 和请求代次。身份、端点、Host child 或窗口绑定变化立即清除相应派生值；旧成功和旧失败都不能覆盖新身份。managed 失效时禁用相关入口，不回旧匿名服务、上一租户、本地菜单或旧排序缓存。unmanaged 路径明确独立。保留 welcome 原 ready/unmanaged/unavailable 根投影，每个新 kind 另有 ready(version/data)、unsupported、unavailable；只有新 kind 的 data 与 version 同时缺失才算旧后台 unsupported，只缺一侧属于 unavailable。旧后台缺 kind 不丢既有 welcome，present 但坏 schema 不能算 unsupported 或 empty-ready。

现有 UI scenes 十分钟 SWR 和插件排序 hook 必须按原企业 identity revision 失效，清除旧 owner 值并围住迟到结果，不能继续只按稳定 service 实例去重；不增加第二个 accepted cache。远程 workspace 原来重建的匿名 scenes service 必须借用 base Host 的同一安全显示投影，不能把 token 发到 remote 或声称此改线就是远端模型验收。

scenes 投影固定 namespace=`uwork`，仅适配现有 draft-suggestion/scheduled-task/off-peak-task 所需 options/labels/contents/defaults，不暴露可执行的任意配置语法。模板选择只填充现有 UI，由原创建/执行 owner 再准入。插件排序 facade 移除旧匿名 configs HTTP 与一小时缓存。

Main 的 help/trace 必须按 sender → window → 当前 Host/child 代次路由。禁止复用旧全局 rollout、firstHost latch、全窗口广播或 lastConfig。旧可见帮助入口在点击时再次取当前绑定的已验证 URL；trace batch 的入口和 dispatch 也验证当前 sender/owner 的派生决定，不能只校验 schema/容量。派生非秘密 binding epoch 区分相同发布 version 的不同 owner/child/window，Renderer epoch 改变时丢弃旧 pending batch，Main 拒绝不匹配 epoch。managed 发布值优先于旧本地强制开启 debug override，不能突破 disabled 或 0.2 上限；unmanaged 保留原显式本地 debug 能力。失败默认关闭；不输出用户内容、身份 token 或模型 Key。

context 使用既有 reverse runtime-preferences/runtimeConfig.presentationSurface 单路径，不增加并行 context bool。CommandInbox/FIFO 先接纳并 dequeue，executeTurnCommand 先建立原 reservation，再在 context prefix/模型派发前捕获当前私有配置；禁止 reservation 前新增 await。整 turn（含 steer/模型重试）保持同一快照，下一次已排队 turn 真正执行时重新读取；不改变已经派发的调用。请求传递 turnAbortSignal，503/unsupported/unavailable 配置采用原 terminal surface 并保留 unavailable 诊断，模型仍独立执行原准入；取消或 owner 变化传播到原 turn 终态并释放 reservation，不能被元数据降级吞掉。WorkflowActor、customPrompt、subagent 的原 Desktop 段排除规则保持。原 admission 顺序、取消、owner proof、工具权限和账务语义保持。协议 strict schema 变化必须正式 CLI → stage → Desktop 同版构建，不兼容旧 CLI 不能靠宽松解析兜底。

## 管理界面与验收

在“客户端定制”中增加四类配置表单，提供清楚的中文字段、增删模板、语言字段、cron 子集说明、HTTPS 链接开关、追踪采样率/分组，以及可选插件排序。复用原保存草稿/发布/放弃草稿，明确发布状态、版本与冲突；不让管理员必须手写旧 options 或任意脚本。长文本用 textarea，空链接保存为 null，仅转换合同明确可空字段；旧菜单及 MCP Hub 行为不变。整个编辑状态绑定 tenant+kind：切换后立即清空/禁保存发布，只有当前 scope 成功读取的 data/revision 可编辑；迟到 load/action 回执不得覆盖新 scope，已经发送的旧 scope 操作可以完成但不显示为新 scope 成功。不能把旧草稿配当前新 kind/tenant 发出。

先建立 RED，再实现并复测：默认/草稿/发布/冲突/放弃/历史/租户与角色隔离、严格输入/字节上限/恶意 URL、旧客户端兼容、cron 双侧一致；Host 当前 owner 与旧结果迟到、注销/端点切换/失败/冷重启；Main 双窗口/child 代次/帮助迟到点击/trace batch 准入；CLI FIFO/context 开关与已执行 turn 快照。真实管理页保存发布、Native 场景/帮助/功能投影、实际 plugin 排序及重启都需相应层次证据。最终新 Native 的两条旧端点请求应为零，保留此前真实 404 作为 RED，不能删日志代替实现。
