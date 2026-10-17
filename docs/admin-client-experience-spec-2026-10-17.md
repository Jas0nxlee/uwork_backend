# 客户端控制面的管理表单与作用域

本切片只修改 admin 表单、样式与对应测试。后台四类合同以根 `SPEC-client-experience.md` 和纯公共 `src/client-experience.ts` 为准，管理端直接消费其 `clientExperienceSchemas`、`clientExperienceDefaults` 与类型，不引入另一份 schema、任意 JSON/options 编辑器或调度 owner。后台路由、发布仓库、客户端和 Main/CLI 由其他分工负责。

## 现有竞态与唯一草稿所有者

现有 Configuration 的 data/revision/version 与 tenant base、kind 分离；切换后旧数据仍可见且按钮可写，迟到 load 会覆盖当前表单，造成旧草稿配新 URL。未加载时保存和放弃按钮也可触发。

Configuration 外壳只保留 tab 选择。每个 `(tenant base, kind)` 对应独立 keyed 子组件与一个局部草稿 session；该 session 是此表单的唯一数据 owner，不增加全局配置缓存。新 scope 首屏 data/revision/version 不可用，所有写操作禁用，直到该 scope 的真实 GET 成功并完成公共 schema 校验。旧后台缺 kind 或坏数据明确显示加载错误，不伪造 ready/default。

```text
scope key 变化 → 新局部 session，清空/禁写
                 └→ 当前 generation GET → 校验 → ready 草稿/revision/version
ready → 保存/发布/弃草稿（固定 scope URL 与开始时快照）→ 当前 generation reload
离开 scope → deactivate → 旧 read/error/action completion 丢弃
已接受旧 mutation 可由原后台完成，不追补新 scope GET、不写新表单、不发新 scope toast
```

同 scope 重读同样使用请求代次，迟到成功和失败都不得倒退状态。busy 时禁止重复提交和编辑；发生冲突保留当前草稿与错误，提供重新加载。发布仍提交已保存的 revision，弃草稿走原 DELETE；不改变原事务或声称可回滚已接受的旧写请求。

## 四类结构化编辑器

在原“客户端定制”内增加场景模板、帮助与反馈、桌面行为、插件排序四个 tab，保留原七类、菜单/MCP Hub 与保存/发布/弃草稿行为。

- 场景：草稿建议、定时模板、错峰模板独立增删，组内最多 20 条；显式 ID、中文/英文标题和提示词、可选图标。草稿额外提供两个允许导航动作的复选框与可选 pluginStableId；定时模板有 cron 字段及无损子集例子；错峰模板有可选双语说明与保留 ID 提示。标题 100、提示 4000、说明 1000、ID 64、图标 64、pluginStableId 200 的输入边界与最终公共校验一致，不用任意 options。
- 帮助：中文/英文社区链接可关闭，空值落为 null；只允许 HTTPS 且无用户名密码。反馈仅 disabled/external，关闭时 URL 为 null，外部模式必须有效 URL，不提供内部工单或脚本模式。
- 桌面：context prompt、renderer action trace 开关；采样率 0–0.2；六个允许分组以复选框显示。清楚说明这些开关不授予系统、文件或工具权限。
- 插件排序：默认 null，显式启用后可分别配置 code/work 的可选分类顺序与按分类插件顺序。列表通过 ID 输入、增删和上下移动构造，支持保留未指定的原目录顺序；不配置插件安装/执行。分类与插件 ID 200，分类列表/分组数量 64，每组插件 100；重复及总 JSON 预算交由同一公共 schema 拒绝。

new-kind 表单在加载与保存时使用公共 schema（含 trim、cron 无损子集、保留 ID 与 UTF-8 JSON budget），错误使用字段路径与中文说明展示。编辑期间可暂存未完成输入，不截断或静默丢弃字段；非法草稿不提交。空、加载、错误和 disabled 状态均有文字，按钮与字段有可访问名称，320/768/1024/1440 宽度不横向溢出。

## TDD 与验收边界

先使用实际 TSX/React SSR 固定未加载仍能保存/放弃的 RED，保留旧正式 admin 构建资产以供后续真实竞态 RED 对照。局部 session 的 request port 单测覆盖 pending 禁写、迟到 read/error、同 scope 乱序、旧 action 已发送后切 tenant/kind、旧结果不 reload/toast 新 scope；它们只是单元验证，不算真实 HTTP 或浏览器验收。

表单测试消费真实组件和 Root 的纯 schema：双语/空值、所有增删、动作/权限边界、URL、采样率、分组、排序与坏字段；旧 ValueEditor 的 MCP Hub null 和普通空字符串回归保留。执行根 TypeScript/admin TypeScript、目标 lint/format。

待 Root 后台 green 并构建 admin 后，以隔离临时 DB/端口/合成身份、自有 Chromium/BH 进行真实 DOM 保存/发布/弃草稿、当前 tenant/kind 切换与迟到响应回归，绝不覆盖 fetch/响应、注入 React/store 或合成 input/change。只使用原生 CDP 输入；不读主 env/DB/Vault，不动主服务、不签发终端凭据、不调用付费/外部服务、不 build 客户端 out。清理和旧/新资产边界单独留证，未执行项不能写成通过。
