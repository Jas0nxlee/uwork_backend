# macOS ARM64 同任务归档与取消归档

状态：源入口已核，准备阶段；未启动 App。本薄片仅使用正常 ARM v15 及其已审 manifest `3cbde851c06c5975b1620e8443942dcf648fed4fe111b4f71b4efdb3ec90d93c`。新 profile 建议为 `client-native-packaged-macos-clock-arm64-task-archive-v1-20261021`。只增加本用例的 spec、observer、controller 与纯回归；不改产品、76 source pins、Memory 原源、现有 fixture 或其它人的消息用例。不重新建包、不改变权限、不删除任务或真实数据。Root 是唯一 App writer，冻结 exact plan 经独审后才可运行。

原 warm 五项完成后，以已完成的同一 task/session 为唯一目标，保存 `taskId`、精确 workspace path/key、标题、model/provider/mode/thought、CLI 实际映射的私有 DB 路径及 PID/birth。六份观测按 `baseline` → `confirming` → `archived` → `opened` → `restored` → `reloaded` 收口：

1. `baseline`：目标位于原正常任务列表，tasks-index 唯一行 `archived=0/deleted=0`，CLI user/assistant 历史已完成。
2. `confirming`：沿原 `task-archive-ID` 首击进入同一行确认态；仍为同一 ID，原 tasks-index 和 CLI 历史保持不变。不能用直接 service 调用代替 UI 首击。
3. `archived`：再击同一原按钮确认，正常列表该 ID 消失且 tasks-index `archived=1/deleted=0`。
4. `opened`：经原 sidebar archived toggle 打开归档视图，唯一标题与完整 workspace path 的原归档行出现。原点击该行后，实际活动 session 必须仍为原 taskId、原历史、model 与 cwd；不能只凭标题声称同一任务。
5. `restored`：点击该原归档行的“取消归档任务 / Unarchive task”按钮，tasks-index `archived=0/deleted=0`；归档行消失，仍显示同一活动 session。
6. `reloaded`：关闭归档视图、原 renderer reload，再由原正常行打开同一 ID，session/history/model/cwd 保持原语义。

现有归档行没有 taskId test-id：只允许用 DOM 中唯一 `p[title=原标题]` 与同 `li` 中 `span[title=完整 workspacePath]` 做双条件定位，并在原打开后验证实际活动 sessionId；不新增产品属性、不读 React store/fiber、不用私有 Runtime sender 或手工派发服务命令。定位不唯一、未完成或出现其它 workspace 时应停止。不得触碰同视图的单条删除、批量删除或 Trash 操作。

唯一归档状态 owner 是原 Host tasks-index。`zcodeTaskServiceAdapter.archiveTask/unarchiveTask` 只更新原 indexed task state 并发布原列表变更；不镜像写 CLI `session.time_archived`。因此 observer 应核 `tasks.archived` 的 0→1→0 和 CLI 历史语义不变，不能错误要求 CLI `time_archived=1`。初始 indexed 行必须存在，不靠 fallback 从 Agent seed 来补齐验收数据。

每阶段在原 UI 到达后，只读打开该 case 内已由实际 CLI FD 绑定的 DB 与 `data/.uwork/v2/tasks-index.sqlite`，执行固定 SELECT。记录完整 task-index 的归档/删除标志与身份，及 session/message/part、原 `runtime/model_selection`、`runtime/execution_state` 的稳定语义和哈希。路径必须属于本 case、无 symlink，不构造 Repo、迁移、写库或修改既有 session。`updatedAt`、已读标记等允许原 UI 自行变化，但不得替换 ID、workspace/model、用户/助手正文或已完成状态；所有变动都应明确保留在 receipt。

归档与恢复不得增加模型业务。各阶段保留两 actor 的原完整账务投影和旧行，原 supplier/raw inference POST/full modelRequests 均零增。正常 warm 基线应保持当前成员 2 次/44 credits/24 input+20 output、另一成员 2 次/44，总 raw/supplier 4。不能将“账务没增加”单独作为没有模型请求的证明；同时核原 supplier 与入口原始计数，并保存阶段 full-row 对照。

原 renderer 30 秒、secondary 10 秒、实际共享 work160/case180/cleanup20 不变。复用已审 packaged-only ASAR Main reader，不读或复制 live development out。原 seat 拒绝、logout、同 controller/profile cold-start 尾段完整保留，沿原 warm 基线继续零增；原 finally、BH/UNIX、进程、端口与 OS 恢复错误均可使本用例失败。本轮仅 Mac，不包含 Windows、Linux、外部 MCP、网盘或远端 workspace。

准备期 TDD 至少覆盖：首击未改归档状态、归档/恢复同 ID 正例、删除标记与 foreign workspace/ID 拒绝、message/part/model/cwd 漂移拒绝、原双 actor 旧行/计数零增、实际 controller namespace/预算闭包与原 finally 字节保持。DOM 纯合同检查刻意不可见的 model metadata anchor、重复归档行、foreign active session 和遮挡目标；它不替代真实 DOM 验收。纯控制或受控临时 SQLite 证明的是观察设施合同，不冒称已执行 Native 生命周期。冻结后再进行单次实际运行。

源码依据：`TaskListItem.tsx:433` 同一 archive test-id 的普通/确认态；`WorkspaceTimelineTasksSection.tsx:368` 两击分支；`WorkspaceArchivedTasksFlatSection.tsx:150` 原归档行和 `:232` unarchive；`WorkspaceSidebar.tsx:1001` 归档/关闭 toggle；`zcodeTaskServiceAdapter.ts:1382` indexed state owner 与 `:2991` 两入口；`taskIndexRepo.ts:1567` 原持久状态更新。以上是当前源事实，尚无本薄片 App 运行证据。
