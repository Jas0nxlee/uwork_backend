# UWork 企业管理后台：能力边界草案

状态：本轮自主构建的能力基线；完整产品验收未完成，当前实现与缺口见 [验收台账](docs/acceptance.md)。日期：2026-10-14（Asia/Shanghai）。主仓库：<https://github.com/Jas0nxlee/uwork_backend>。

目标：根据 WorkBuddy 企业控制台的可观察行为独立实现企业管理后端、管理 Web，并适配 <https://github.com/Jas0nxlee/UWork> 客户端。这里的“完整”包含真实持久化、鉴权、策略执行、任务运行和客户端应用配置，不能以菜单齐全、静态页面或模拟数据代替。

本文件先确定模块边界与实现顺序；审批后按模块编写 `SPEC-<module-id>.md`、计划与验收任务。现阶段未选择最终数据库、部署域名、生产凭据或云沙箱供应商。

## 能力地图

| 模块 ID | 唯一职责与状态所有者 | 依赖 |
|---|---|---|
| identity | 企业、企微扫码尝试、一次性回调、会话、吊销及组织切换；密钥只留服务端 | — |
| directory | 部门、成员、企微同步映射、平台角色、企业信息；企微来源与本地来源明确区分 | identity |
| access-control | 管理端 RBAC、成员/部门作用域、租户隔离与权限查询；后端作最终裁决 | identity, directory |
| entitlements | 席位、订阅、用量账本、成员/部门/应用限量、计量周期、幂等扣量 | access-control |
| model-gateway | 模型目录、供应商配置、探测、启停、模型访问策略、代理调用与计量事件 | access-control, entitlements |
| ai-assets | 技能、专家、连接器、分类、版本、审核/启停、可见范围、下发与个人资产策略；Playbook 与指令兼容边界 | access-control |
| credential-vault | 凭据加密、创建/轮换/吊销与按授权引用注入；列表和日志不回传原文 | access-control |
| agent-runtime | Agent 配置与发布版本、Runtime、Session、执行/取消、自动化及推送、评测数据集/任务/报告 | model-gateway, ai-assets, credential-vault, entitlements |
| client-policy | 客户端菜单草稿/发布、新对话页、助理渠道、分享范围、安全策略、IP 白名单；带版本的配置快照 | access-control, ai-assets |
| telemetry | 审计、对话日志、Trace、指标聚合、查询导出；消费已定义事件，不反向调用任务执行 | access-control |
| external-integrations | 网盘等外部产品的访问适配与能力声明，外部存储/订阅不伪装成本地已实现服务 | access-control, credential-vault |
| admin-web | 管理员路由、表单、查询、分页、权限与错误状态；业务事实归对应服务端模块 | 以上服务 API |
| uwork-client | 沿用 UWork 的身份/Host/服务/hooks 边界，应用模型、资产、菜单与安全配置；向后端上报终端事件 | identity, model-gateway, ai-assets, client-policy, entitlements, telemetry 的公开 API |

跨模块共享事件和协议放在独立 contract 层。`entitlements` 不导入 Runtime 实现；Runtime 通过额度准入接口和幂等计量事件与其交互。`telemetry` 通过事件合同接收事实，不参与业务状态写入。UI 不直接访问数据库或读取上游凭据。

## 建议实现顺序

1. **身份贯通**：自己的企微应用和回调 → 后端登录/会话 → 管理 Web 与 UWork 登录；验证过期、取消、组织切换和跨租户拒绝。
2. **组织、权限、席位贯通**：部门成员与企微映射 → RBAC → 席位和成员准入；超级管理员与普通成员分别验收。
3. **模型调用贯通**：创建一个真实模型 → 设置可见范围/限量 → UWork 同步 → 真实对话 → 用量入账和审计。上游长期密钥不下发客户端。
4. **资产分发贯通**：上传技能、专家和连接器 → 校验/版本 → 作用域策略 → UWork 安装与更新 → 取消授权后阻断继续使用。
5. **客户端管控贯通**：菜单草稿/发布、新建对话页、助理渠道、分享、安全和 IP 策略 → 客户端实际应用；不能只做界面开关。
6. **企业智能体贯通**：发布 Agent → 隔离 Runtime → Session → 执行/取消与异常终态；随后实现自动化、结果投递和评测。
7. **用量与观测贯通**：聚合/明细对账、周期重置、各级限额、日志/Trace/指标与导出。账本及审计从前面的切片开始写入。
8. **外部整合与整体验收**：网盘适配、所有入口/子页/异常状态矩阵与打包回归，分别验证 Windows/macOS/Linux 及实际启用组织。

每一切片必须同时提供服务端、管理 Web、相关客户端适配和行为验证。先做可运行闭环，随后扩展同一模块的其余能力，不一次生成所有页面后补业务。

## UWork 基线与适配约束

- 远端默认分支及本地隔离副本基线：`22a99b746504735bac3b59e0b4760a6fad9031be`，UWork `3.16.0`。这是 2026-10-14 当前核对结果。
- 适配副本：`/Users/ljp/Desktop/uwork_backend-client`，分支 `feature/workbuddy-admin-integration`。原 `/Users/ljp/Desktop/vibecoding/ZCode` 的两处已有改动未复制或更改。
- `packages/services/src/enterprise-identity/` 已有扫码适配、会话存储和跨窗口投影；不能另造 Renderer 登录状态所有者。
- `packages/services/src/ucas-gateway/` 已有模型/用量同步；新的企业后端适配需沿合同扩展，不能在 React 中直接请求内部服务或存放供应商 Secret。
- 已有网关客户端存在 `/api/keys/.../reveal` 和将 API Key 写入 Provider 的路径。它不自动满足本项目“上游密钥只在服务端”的目标，需在模型调用切片明确迁移；可使用受作用域、可吊销的终端凭据访问自有网关。
- Desktop Main 处理扫码窗口/原生操作；Host 服务负责业务状态。手机远控继续连接现有 Desktop Host，不能用新增云 Runtime 替代已有远控会话语义。
- 复用共享协议、依赖注入、现有 UI hooks、主题和国际化；遵守 UWork `AGENTS.md` 与架构合同，并在修改前更新对应 spec。

## 评审时需要定下的边界

1. 当前账号所见组织、角色成员和席位写操作委托企微后台。自有版本的默认方案是保留企微为组织来源；独立本地成员管理作为显式扩展，不能默认为原站已有功能。
2. 连接器白名单说明同时出现“额外获得”和“allow 取交集/可见范围优先”，语义有冲突；策略矩阵需通过受控身份/服务端证据或产品裁决确定。
3. 全局提示词页面同时出现历史“应用到所有对话”说明和“客户端不再生效”提示；不能默认对 UWork 注入旧全局提示词。
4. 网盘、支付、企微、模型供应商和云沙箱是实际外部集成。原站页面可见不等于这些服务的凭据、协议权限或部署资源已具备。

## 完成标准

- 功能台账中每项有观测证据、实现位置、验证步骤与结果；不可用/外部依赖/未验证分别标记。
- 管理端越权、普通成员越权、跨租户读取与执行全部拒绝；资源/策略限制必须在执行入口生效。
- 配置发布、下发、撤销可验证；限量并发扣减、任务超时/取消、日志脱敏和异常终态具备行为测试。
- 管理 Web 真实操作与 UWork 真实客户端闭环通过，随后执行各仓库规定的构建、类型、Lint、架构和交互检查。
- 新企微扫码与逐组织 callback、真实模型对话、真实任务运行及目标平台安装另行验收，不能由已有浏览器登录或模拟夹具代替。
