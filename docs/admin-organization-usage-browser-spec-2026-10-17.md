# 管理端双组织与非空用量搜索浏览器验收

## 目标与已有边界

本增量只补两个尚无真实浏览器记录的现有入口：同一合成用户通过管理端“当前组织”切换，以及用量聚合的非空模型 ID 搜索、三维切换与清空。成员 CRUD、角色/席位、基础聚合、分页和导出沿用既有证据，不重复计作新增覆盖。

`scripts/admin-ui-fixture.ts` 是隔离管理端夹具的基础；`admin-collection-smoke.py` 的聚合响应被替换，不能作为本增量的真实账本证据。生产行为以 `admin/src/main.tsx`、`Collection.tsx` 和 `src/identity.ts`、`telemetry.ts` 为准。

## 夹具与所有者

- 派生独立 fixture，临时磁盘根权限 0700、SQLite 和端口由本次任务独占。`createApp` 直接使用生产实现，静态资源使用现有 production admin 构建；不接触主 PID 37266、主 3000、主 DB 或公共 Native fixture。
- 两个合成组织、受控同用户双成员关系只在初始 bootstrap 中准备；后续部门/成员/模型/凭据和生成均走真实 HTTP。主密钥与登录材料仅存在进程或 0700 临时根，不写入证据日志、截图或源码。
- 仅一个本机固定受控供应商，真实文本生成使后台产生 settled 账本；不直接写入 ledger，不调用任何外部模型/企微/MCP/网盘。
- 采用本机已安装的官方 Chrome 可执行文件，独占 headless profile、loopback CDP、独占 browser-harness daemon。不得附着或改变用户 Chrome 会话；不替换 fetch/RPC，不注入 React/store/业务响应。

## 验收场景

1. 浏览器经真实登录表单进入组织 A；成员列表显示 A 专属成员、无 B 专属成员。实际操作 header select 切到 B，网络中出现真实 `/api/auth/switch` 和后续 `/api/auth/me`，header、列表与只读验证均属于 B；再切回 A，A 数据恢复且 B 数据不混入。使用当前组织的用量视图和导出链接核对租户路径及结果。
2. 通过真实模型 HTTP 生成 A 的两个成员/两个部门、两个模型及 B 的独立消费。用量聚合搜索 A 某个实际模型 ID，三个维度 member/department/application 的实际 DOM 行必须逐行等于真实 HTTP 聚合与持久化账本计算；切换维度仍携带同一非空 q，清空后恢复 A 完整 settled 数据；不存在模型 ID 得到真实空结果，再恢复搜索。B 消费不可混入 A。

主链以真实 CDP 键盘/鼠标输入驱动；select 仅通过 DOM.focus 和 Input.dispatchKeyEvent 导航并提交，不写 DOM value 或派发合成事件。浏览器 JS 仅作 DOM 只读检查，HTTP/CSV 交叉校验在 Python 通过夹具持有的独立合成会话执行，另存 verification-http.json，不记为 UI 请求或写入。聚合中应用维度只声明夹具实际生成的 `uwork` 应用，不冒称多应用数据覆盖。

## 文件与命令

- `scripts/admin-organization-usage-fixture.ts`：独立真实后台、受控供应商与初始业务准备。
- `scripts/admin-organization-usage-browser-smoke.py`：通过 browser-harness 执行真实 UI，输出无凭据检查与网络收据。
- ignored `evidence/admin-organization-usage-browser-20261017/<run>/`：每次独立证据，不覆盖旧记录。
- 启动：现有根 Node 24.19.0 执行 `node --import tsx scripts/admin-organization-usage-fixture.ts`，通过专用任务环境变量传入临时根、证据目录与独占端口。
- 浏览器：Python launcher 创建自有 Chrome，设置本次 `BU_NAME`、`BU_CDP_URL` 与 `BH_RECORD=0` 后将 browser smoke 输入 `browser-harness`。
- 完整入口：`python3 scripts/admin-organization-usage-browser-smoke.py`；由该 launcher 独占启动、等待、运行和逐项清理。
- 门禁：新 TS 文件纳入现有 `tsconfig.verify.json`；执行仓库 typecheck、定向 ESLint/Prettier 和 Python 语法检查。

## 失败与清理

保留首次失败和对应 DOM/HTTP/账本证据。真实产品 RED 不改生产源码，汇报最小修复位置由主任务安排；不能删断言或用响应替换造通过。驱动/准备错误单列，不算产品缺陷。

先退出自有浏览器和 fixture，再逐项确认所有已知自有 PID 消失、端口关闭、临时数据根与本次 BH daemon 已删除。清理继续处理后续项，不能因一个错误跳过。实际业务证据和清理结果都齐全才记本切片通过；不据此关闭跨平台、Native 组织切换或 managed remote 目标。
