# 管理端双组织与非空用量搜索实测

2026-10-17，Asia/Shanghai。两个新增切片均通过；未修改生产源码，没有重建客户端 out。规格见 [独立验收规格](admin-organization-usage-browser-spec-2026-10-17.md)。

## 实际覆盖

| 切片                       | 真实运行与结果                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 同一用户双组织 header 切换 | 通过真实管理页登录表单登录，再经原 header select 完成 A→B→A。实际 `/api/auth/switch`、后续 `/api/auth/me`、当前组织标识、成员列表、用量明细和 CSV 路径一致。A 的 3 个账本 ID 与 B 的 1 个账本 ID 分别精确对应真实持久化数据，专属成员不串租户。包含闭合 select 键盘 type-ahead 过程中的中间合法切换，本次捕获 4 次真实 switch POST，均成功；最终按三个命名状态核对。 |
| 非空聚合搜索与恢复         | 在真实搜索框输入当前过滤模型 ID，member、department、application 三个维度逐行等于独立账本累加及真实 HTTP 聚合结果。过滤集为两成员/两部门各 14 Credit，应用维度 `uwork` 共 28 Credit/2 请求；清空后恢复 A 全量 37 Credit/3 请求。不存在模型 ID 得到实际“暂无记录”，恢复原模型 ID 后回到两行；B 的 6 Credit 不混入。                                                   |

浏览器使用本机已安装的官方 Chrome、独占 headless profile/CDP、独立 browser-harness 环境。登录、搜索和按钮使用真实 CDP 文本/鼠标输入；select 通过 DOM.focus 后的实际 CDP 字符键盘 type-ahead 与 Tab 提交，不写 DOM value、不派发合成 DOM 事件。浏览器 JS 仅作 DOM 只读检查，HTTP/CSV 校验移到 Python urllib，使用夹具持有的独立合成会话并另记 verification-http.json。没有覆盖 fetch/RPC，没有注入 React/store、业务响应或浏览器身份。

后台由 `scripts/admin-ui-fixture.ts` 的隔离模式派生，独占临时 SQLite、端口及权限 0700 数据根。初始同用户第二组织成员关系只属于静态 setup，不冒称组织创建或企业同步验收。后续业务准备和四次文本模型请求均经真实 HTTP，受控供应商只监听 loopback。没有直接写入 ledger。

## 最终证据与清理

最终严格 CDP 输入运行是 ignored `evidence/admin-organization-usage-browser-20261017/20261017T211310/`：

- `summary.json`、`validation.json`：两个切片通过，完整最终快照与清理通过。
- `browser-report.json`、`browser-network.json`：13 条检查收据、12 个不同名称，末次 `aggregate-member-filtered` 是恢复搜索验证。按两个切片统计，不把重复名称或中途运行相加为新增用例。无未处理浏览器异常。
- `fixture-seed.json`、`fixture-final.json`：最终 82 次后台 HTTP；4 次本机受控供应商、4 条 settled 账本。浏览器前后供应商收据及账本完整一致，无额外生成。
- `verification-http.json`：13 次 Python 只读 GET，与 Chrome 的实际 UI 请求单独记录；Chrome 捕获 39 次 API 响应，其中 9 次为真实聚合查询，除首次未登录 auth/me 的预期 401 外没有 HTTP 错误。
- `select-diagnostics.json`：实际键盘输入前后的 select 焦点、选项和 index 只读快照，没有写入 DOM 或业务状态。
- `fixture-public.json`：本次 production 管理页实际静态 JS 路径和 SHA256。
- `usage-A-first.csv`、`usage-B.csv`、`usage-A-return.csv`、`organization-*.png`、`aggregate-*.png`：真实 UI 与租户隔离证据。
- `cleanup.json`：11 个已知自有 PID 消失、3 个端口关闭、临时数据根与独立 BH 环境已删除。主 PID 37266 只读检查仍存在，没有调用主实例或读写主库。

最初两次运行分别因驱动提前断言受控 select 的异步值、把空结果 colspan 占位行当作业务行而中止；原始证据保留。另一次 UI 已通过，但 SIGTERM 最终统计快照被截成零字节，不纳入完整验收。夹具改为正常 stop 握手和原子证据写入。`210117` 完整结果只记 DOM 事件激活层，不能当真实 CDP select 用户输入；后续按终审要求去掉 value setter、合成事件与浏览器内 fetch。四次 Arrow/原生弹出菜单尝试未产生切换，分别使用官方 Chrome 与既有缓存 headless-shell，均保留为驱动/平台限制。最终采用原 Chrome 闭合 select 的正常键盘 type-ahead 取得上述严格通过；没有产品 RED，也没有修改正式 Main 或伪造平台状态。

## 门禁与限制

新增 TS 夹具已通过仓库 `tsconfig.verify.json` 严格检查、定向 ESLint/Prettier；管理页类型检查、规格格式和 Python 语法检查通过。这里未重新跑已通过的全后端/客户端用例；本增量无生产行为改动。

终端凭据签发留给独立切片，本次没有操作。真实企微、外部 MCP、网盘、付费供应商、Native 组织切换、用户 Chrome、远端被拒探针和发行包/跨平台不在本实测中。闭合 select 键盘路径通过不等于操作系统原生弹出菜单验收。应用维度仅覆盖实际生成的 `uwork`，不声称多应用消费。既有 CRUD、分页和基础 CSV 证据不重复计数，项目级未完成目标继续保留。
