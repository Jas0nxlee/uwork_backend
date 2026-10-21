# 原结构化问答、跳过与历史恢复

本轮仅新增原AskUserQuestion消费者，使用共享UI、未打包Main/Host/CLI、真实隔离HTTP/SQLite与受控HTTP供应商。原Input完成单选、多选、自定义、上一题、跳过、工具卡展开和任务恢复；不写Runtime答案、不替换产品存储。受控供应商证明真实模型请求/传输/计量，不代表外部模型质量或实际供应商账单。

| 场景         | 实际结果                                                                                                                                                                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v44多题交互  | 待答时原reload恢复同一个问题且无重复模型请求；先选北京，勾选日志/文件、取消指标，填写中文自定义；原上一题改南京，返回后多选/自定义仍在；末题直接提交。模型实际收到南京、日志/文件/中文自定义以及跳过1题指引。此轮未检验历史卡展示，不能扩写为该项通过。 |
| v46产品RED   | 单题选择南京后，模型和CLI确有南京，展开原工作组和工具卡却显示“未提供回答”。v45此前因工作组未展开而未定位到工具卡，是设施失败，原结果保留。                                                                                                              |
| v47修复GREEN | 原单题选择南京，实际模型、CLI持久输出、原卡片实时/renderer reload/Main与CLI冷恢复后都显示南京。刷新与冷恢复请求/完整账本零增。                                                                                                                          |
| v48空答案    | 原下一题两次、不选任何选项后提交；实际模型收到JSON空答案及非拒绝/不捏造偏好指引。原待答reload无重复，完成卡实时与刷新都显示“未回答，已自动继续”，没有误报历史不可用。                                                                                   |

## 修复依据

生产formatter原先把answers压为自然语言，该字符串同时是持久ToolPart.output；原UI只解析结构化JSON或legacy answered格式，故模型答案正确而历史卡失真。现沿用原字符串通道输出`{answers, annotations?, guidance}`，复用原UI JSON读取器，保留部分/全部跳过含义；不重复questions/options，不增加RPC union、DB结构或额外状态所有者。

旧自然语言历史没有可靠结构映射，原摘要直接作为React纯文本展示并转义；无摘要且答案未知才显示“历史回答不可用”，与明确空字典区分。不从引号/换行文本猜答案，不回写旧库。原结构化/legacy answered兼容保留。详见[客户端spec](../clients/uwork/specs/ask-question-result-presentation.md)。

## 请求、冷恢复与资源核对

v44/v47/v48各当前成员3笔settled/66Credit，包含Ask提议、后继回复、自然标题；另一成员两笔完整ledger行逐字段保持。独立读取实际供应商请求，tool结果与CLI canonical output逐字相同。所有完成刷新及v47冷恢复与完成时完整快照相同，未发生额外请求或计费。

v47真实Primary Main为34203→34519，工作区CLI34303正常退出code0后，新CLI34627才启动，最终也正常退出。控制器launch事件、直接Main日志、workspace agent生命周期相互核对，未把fixture Node或openWorkspace副实例PID当Primary。v44–v48包括两次失败的全部Main/Host/CLI/fixture PID均已不存在，4个自有端口均拒连、cleanup.errors为空、fixtureExit0、私有运行根移除；browser-harness daemon/socket关闭。

v47原结果沿用当时通用check名和pendingReloadNoDuplicate字段，名称过宽；执行源码和动作证明该轮仅验证完成后renderer reload及Main/CLI冷恢复，未执行待答刷新。原收据不改写，待答刷新由v44/v48独立证明，当前驱动已按模式记录pendingReloadPerformed。

## 门禁

- 新Core formatter4项、生产formatter→UI读取/恢复5项、实际卡片renderContent闭包SSR3项，共12项定向回归通过；涵盖中文引号/换行、部分/空答案、annotations、不复制未选大preview、旧摘要纯文本转义与未知/空值差异。保留真实RED日志。
- 客户端根`pnpm typecheck`（含Main）、`pnpm lint`通过，Lint114条既有警告/0错误；CLI类型27任务、Lint14任务通过，CLI测试tsconfig检查通过；架构0违例。首次根typecheck无诊断退出1，原因未证实；加明确8GB堆后正常通过。首次CLI lint为嵌套PATH找不到既有Turbo，补已有root .bin后正常通过，没有停用检查。
- 正常CLI构建及暂存通过，两份zcode.cjs逐字一致且运行后SHA不变。正常Desktop源码构建通过，冻结5087源输入/6669产物供v47/v48使用，每项实际副本hash校验；保留全部原产物，没有过滤既有编号文件，也不宣称清除了它们。未生成/测试发布安装包。
- 目标MJS ESLint/格式通过；Python AST通过，原finally AST不变。新CLI测试与formatter源按该子仓自己的formatter格式化；后者仅排版改动后再次正常构建CLI与Desktop，供后续未覆盖入口使用，未重复已通过UI流程。

证据：[独立最终复核](../evidence/prepublish-continuation-20261021/question-final-verification.json)、[v44](../evidence/client-native-prepublish-v44-20261021/result.json)、[产品RED v46](../evidence/client-native-prepublish-v46-20261021/question-history-live.json)、[GREEN v47](../evidence/client-native-prepublish-v47-20261021/result.json)、[v47冷恢复卡](../evidence/client-native-prepublish-v47-20261021/question-history-cold.json)、[空答案v48](../evidence/client-native-prepublish-v48-20261021/result.json)、[12项中的Core4](../evidence/prepublish-continuation-20261021/question-formatter-green.log)、[UI8](../evidence/prepublish-continuation-20261021/question-presentation-integration-final.log)、[CLI字节](../evidence/prepublish-continuation-20261021/question-agent-staging-verification.json)。各profile保留执行源码副本和SHA；旧失败不改写为通过。

本轮没有重跑旧权限/文件回滚/队列/管理CRUD套件。企微OAuth和远程未验证路径不阻挡后续本地源码消费者；外部MCP、网盘、发布后多系统客户端继续排除。整体目标仍active，问答忽略入口与计划审批须先核对既有具名证据，再补真正缺失场景。
