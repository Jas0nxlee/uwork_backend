# 动态工作流企业资产实际消费验收规格

2026-10-17。G02 的独立验收切片，按当前源码公开合同验证，不增加产品入口。

公开入口有两类：父模型的 `CreateWorkflow` 工具，以及 GUI 使用的正式 V4 `startSavedWorkflow` / `resumeWorkflowRun` 命令。后者直接调用同一 run service，不经过模型工具的交互确认。正式源码注释明确用户在 GUI 的点击是交互批准；它不能替代企业准入。当前企业 resolver 拒绝 `CreateWorkflow` / `AmendWorkflow` / `ResumeWorkflowRun` 模型工具的未知 capability，但这不代表 V4 直接入口不存在。

run service 创建持久 journal，使用 `agent(name, persona).ask(...)` 派发 actor。actor 使用既有 `createScriptWorkflowAgentRuntime` 注入的受控 SkillPort、父会话派生的私有 Host 端口和企业模型 relay。当前 `AgentPersona` 只声明 `system?: string`；`name` 是 actor 身份，不是 AgentProfile 查找键。企业专家由既有 `Agent` 子任务 owner 消费，不能把同名 workflow actor 或手工复制专家正文当企业专家集成。公开脚本传入未声明的 expert 选项必须由实际 `SaveWorkflow` 编译拒绝。

状态所有者：后端拥有发布版本与当前权限；EnterpriseIdentityService 拥有当前交互身份；Host 只拥有派生缓存和私有端口；CLI run service/journal 拥有 run、actor、ask 与恢复；测试供应商只决定受控模型回复和外部观察。验收不直接写 journal，不插入 workflow 事件，不导入 bootstrap/core 内部类代替运行。

```mermaid
sequenceDiagram
    participant Parent as 真实父 CLI session
    participant Run as 生产 run service / journal
    participant Actor as 真实 workflow actor
    participant Host as 私有 Host
    participant Backend as 隔离后端
    Parent->>Run: V4 startSavedWorkflow 正式 GUI 命令
    Run->>Actor: ask，持久 actor 身份
    Actor->>Host: Skill 目录/正文与模型请求
    Host->>Backend: 当前身份、权限、不可变资产准入
    Backend-->>Host: 当前版本允许或拒绝
    Host-->>Actor: 已批准正文 / 稳定拒绝
    Actor->>Host: 后继模型请求（正文证据）
    Run->>Run: 完成步骤持久保存
    Parent->>Run: 冷重启后 V4 resumeWorkflowRun
    Run->>Actor: 回放完成步骤，仅重新派发未完成步骤
```

验收场景：

- 正式 `SaveWorkflow` 的公开 facade 拒绝不存在的 expert 选项，零 actor 模型派发；同名 actor 不能隐式注入已发布专家正文。合法定义可经明确 project/global 作用域和逐次交互批准保存。
- 实际 actor 的 `Skill` 读取批准企业 Skill，正文出现在该 actor 后继模型请求中；同一 run 后续 ask 重新读取当前版本，已进入历史的合法旧正文不冒称已擦除。
- 当前撤销资产发布后，新 Skill 读取被拒绝，不能用现有缓存补正文；模型/身份在新 actor 请求前撤销时，新供应商请求与新账本均不得发生。
- 支持持久恢复的真实 run 在 CLI 停止后，冷重启原 session，通过 `ResumeWorkflowRun` 恢复同一 run ID；完成 ask 从 journal 回放，未完成 ask 重新派发且执行当前权限。
- 当前 filesystem=false 必须在读取已保存定义正文之前拒绝 V4 直接启动：零新定义正文消费、零 run、零 VM、零 actor，不删除合法旧定义或历史。恢复/修订等其他公开运行入口必须服从同一执行 owner；异步文件读取、上下文准备、草稿写入、转录恢复或 VM 入口准备期间撤权/更换身份，不能沿用旧 owner 的一次允许继续派发。模型请求和 Skill 仍分别逐次准入。
- 若文件撤权发生在第二 ask 已完成 CLI 模型准入、Host open 尚未处理的边界，必须准确保留该 ask 的首个模型请求已发生这一事实。后续 Skill/模型或转录边界发现 `enterprise_filesystem_denied` 后，run 以明确拒绝的 `errored` 终止，零携带新工具正文的后继模型请求；合法第一 ask 历史保留。终态后再次 cancel 应报告既有 not_running 语义，不能假称取消了已终止 run；仍在运行的撤权任务取消另由实际身份注销场景验证。
- 每项使用独占临时文件 DB、本机 HTTPS/HTTP、自有 Host/CLI 进程和本机供应商；使用现有 `client-native-session-fixture.ts`。不读主 `.env`，不写主数据库，不解密主 Vault，不使用付费模型、真实企微、外部 MCP 或网盘；不重建/覆盖共享 CLI/Desktop 产物。输出与日志不含合成凭据，清理后端口/目录/进程必须留证。

不由此替代 Native 工作流 UI、定时 scheduler、远端 attachment、Windows/Linux 发行安装或生产供应商验收；Playbook/自定义指令无当前 UWork owner 的分发拒绝合同保留。

修复前实测发现 V4 直接启动绕过当前 filesystem=false，返回 accepted 并创建 run，随后受控取消仅用于清理。修复落在 Core/运行 owner 的共享边界与实际 IO，不仅是 V4 表层，也未把未知模型工具直接加入白名单。最终同版正式 CLI `a684e40751e1f9bf7e8e7e3710f8518001451ec33d74964e5502a297a1d23d0c` 的十项专项全过，包括 V4 Skill v1→v2、当前 Skill 撤权、actor 模型身份 fence、文件撤权拒绝终态、原 run 冷恢复和初始文件拒绝；五项 keyless 回归另列。精确统计和 Native/未公开产品边界见同日验收报告，旧产物观察与新产物结果分开保存。
