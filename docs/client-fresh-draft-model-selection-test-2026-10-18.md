# 登录后首次模型选择修复与验证

2026-10-18。Native v6 已从空身份完成原登录，但发送前模型名称与 ID 未匹配。随后真实 React 回归确认一个产品缺陷：空目录先让草稿初始化 `mode`，登录后的合法目录到达时，旧初始化条件不再执行，草稿一直没有模型。

测试使用原 `useDraftConfigControl`、实际 `ProviderRegistry`、`ModelSelectionFacade` 和 `createModelSelectionService`，React 在内存中挂载一次。原事件已送达，服务已返回合法默认模型，最终草稿仍为 undefined；这份 RED 原样保留。它证明该状态转换缺陷，不将 Native v6 的有限布尔现场反推为完整内部状态取证。

修复继续使用原 `V4ComposerDraft.initializeFromNewTask`。明确新草稿在空目录时保留等待首个模型的资格；目录到达后仅补模型及合法 reasoning，不重置正文、模式或 plan。显式选模、明确空选择、已有历史和已接纳选择不自动覆盖。codec 保留已初始化模式的 pending 状态；首次分享导入也保留来源草稿的明确 pending，旧未标记的 mode+empty 不被猜成新草稿。

实际验证结果：

- 核心真实 Hook RED 0/1 → GREEN 1/1；首次导入遗漏的独立 RED 13/14 → GREEN 14/14。
- 最终新回归14项，加原模型名称回归，共15/15。包括同挂载目录更新、正文/plan保留、codec恢复、明确选择/清空、历史空态、持续空目录、accepted后不换默认及首次导入正反例。
- UI noEmit 与客户端标准 `pnpm typecheck` 均通过；5个改动文件格式与 diff 检查通过。
- `pnpm lint` 显式传入4,285个已跟踪代码文件，实际检查4,110个文件，保留113条既有警告、0错误。该选择避免遍历不属于本轮的未跟踪产物。
- 全量 `pnpm architecture:check` 在逐字节复制的7,324个已跟踪客户端文件上运行，0违例；只链接原依赖目录，没有复制或遍历未知产物，也没有修改规则或 baseline。
- 正常 `pnpm --filter @zcode/desktop build:no-runtime-assets` exit0。新 out 为6,631文件、138,811,556字节，逐SHA校验并复制。CLI源码没有变化，复用先前正常构建及stage的 `dd0a2693311cacf7cbf6e3482246761e8a6de7c27b598a8a896a2c791add5196`，没有把它称为本轮重新构建。

产品修复提交 `8bf33b1c37f12290c4c48f8c5dd56021f177cb67`。原失败与测试封存见 [Hook manifest](../evidence/client-fresh-draft-model-selection-20261018/manifest.json)，SHA `51ac6e576fdb1c670542b2d81ac309029de17c111d86e4d1c42e66ac263ae25d`；新构建见 [artifacts](../evidence/client-primary-draft-build-20261018/artifacts.json)，SHA `7fb08baa3e76025f993de274478765faa09b9f1992ad9395c7d4826d5f8c560f`。

此处未把组件回归或构建通过算作 Native 完整验收。新原生运行仍需验证首次模型选择、真实发送、本人账本与用量、认证冷恢复和退出；G04h 与整体 U02–U05 保持开放。真实企微、外部 MCP、网盘仍按用户范围排除。
