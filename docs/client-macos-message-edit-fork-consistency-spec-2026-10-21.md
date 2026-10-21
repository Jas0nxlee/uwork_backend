# Mac 原消息编辑重跑与 assistant fork：有限联测准备

当前为薄控制器、只读观察器与纯合同准备，未运行App；新ARM64 v15已正常产出，后续计划只绑定其严格loader及实际manifest/新Agent摘要，不能把v13命名成v15。旧89/382输入、Memory负例/AutoExtract源和产品代码保持；不启动第二Native、外网、个人浏览器、前台AX、剪贴板或OS快捷键。

## 原入口与真实请求数依据

| 阶段           | 原实现与可见入口                                                                                                                               | 原合同及控制前提                                                                                                                                           |               新inference请求 |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------: |
| 暖基线         | 沿正常原clock暖5：登录/模型/显式项目、文件reload、真实PTY、真实Main与title                                                                     | 原主+997B title均已settled，父task A仍在原live Runtime，Memory保持原引导false；供应商回复保留原完成文案并加唯一warm答案marker                              |         current2，另Bob seed2 |
| 编辑首query    | `v4-edit-<rowId>` → `v4-edit-input-<rowId>` → `v4-edit-submit-<rowId>`；原RowShell `data-row-id`；SessionPane.handleEdit→原CAS `editUserQuery` | latest real user query，原UI conversation-only/preserve，非文件回滚，不换session。CLI先submitConversationRewind再startCanonicalIntent/startPromptTurn      | **1 streamed main，0新title** |
| assistant fork | 编辑后最后assistant行的`v4-fork-<rowId>`；SessionPane.handleFork→原CAS `forkAssistant`                                                         | 原stable resolver固定message boundary，原conversation-only atomic copy/register/resume；不进入legacy workspace checkpoint fork，不停止父任务或修改项目文件 |                         **0** |
| child新问      | fork后原UI新child session的Composer发送唯一新query                                                                                             | child parentID为父、taskType=fork，继承fork边界模型/mode/reasoning/cwd；不是重新创建无父interactive任务                                                    |   **1 streamed main，0title** |

source依据：`commands/handlers/fork-edit-retry.ts`原edit重绕同record，`rewind-message.ts`重建active branch/turnNumber却不重置`sessionTitleGenerationAttempted`；原`session-title.ts`143首先短路已attempted，并在生成请求前以`first_query_edited`抑制首query编辑的标题。原暖title必须先完成，不能拿一个尚未结算的标题当编辑新增或把异步重播吞掉。

原`session-fork.ts`的child input明确`parentID=runtime.sessionId`、`taskType=fork`、title为`Fork of <parent title>`；bootstrap register继承parentSessionId/taskType。title guard同时排除parentSessionId和非interactive，因此child后继query不是普通新task的main+title两笔。fork命令只有copy/register/resume，没有startPromptTurn。本轮纯合同直接执行原title函数的attempted-parent/parentID/fork三拒绝和eligible interactive正控；它不代替Native实际调用计量。

## 有限实际流程与证据

1. 使用v15严格loader、实际签名/9runtime/12native/最终ASAR header、源和CLI provenance。复用原clock暖5与完整finally；通过新独立派生只读实际signed ASAR的`out/main/index.js`核Main，不复制无用live Desktop/out。复用已审packaged-only块及其实际handler合同，避免已有45秒复制问题。原renderer30秒、原副实例函数/stdio ignore/10秒不改。
2. 暖5完成后等title与两笔current账完全settled，冻结父session/task、原UI user/assistant row、实际persisted active branch、选模/reasoning/workspace与CLI/DB FD。本case受控warm主回复加唯一warm-answer marker，仍含原固定完成文案，不改变产品。title/seed依旧走原供应商分支。
3. 用原编辑器把首user query改成唯一`EDIT_PROMPT`，仅点原preserve提交按钮，不点独立workspace rewind提交按钮，不做文件改写/工具调用。原ACK及生产`v4 editUserQuery completed`日志只作为命令收据；后续同session新query/新答案、原模型请求和持久分支分别证明执行。原warm query/answer不得重新进入active provider上下文，物理旧行可以按原revert/history规则保留，不要求删账或删除旧历史。无需假设编辑后标题自动改名。
4. 在新assistant尾行点击原fork。读到不同child session、原fork notice与parent边界，并等TaskIndex/Session原注册落稳。child消息/part/turn/tool ID由原映射重建，不能要求和parent ID相同或把合法fork notice当多余用户重放；按role/text/模型等语义核复制前缀。fork本身原raw/supplier/双actor完整账务必须零增，父Session active branch与所有已接受消息/记录保持。
5. child原Composer只发送一个新单词label，实际主请求须继承编辑后的user意图和assistant答案，不带已reverted warm分支。用原UI分别回看parent/child并与只读Session/TaskIndex、实际CLI cwd和供应商上下文对齐。可做原renderer reload后同child恢复且零重放，不把UI成功文案或child ID本身当推理证据。
6. 如保留原seat/logoutcold尾段，先将原delivered自然更新为本次最终已证快照，再沿原UI拒绝发送/退出/同profile冷启；不重seed身份、不调用业务RPC代UI。任何新增实际模型请求、title、retry或未结算状态都严格失败，不调整期望计费求绿。

## 精确计量和归属

原受控供应商每次usage为12input/10output、22Credit；原rates保持，不联系付费供应商。

| 阶段后    | current settled | current Credit/input/output | raw/supplier总数（含Bob2） |
| --------- | --------------: | --------------------------- | -------------------------: |
| warm      |               2 | 44 /24 /20                  |                          4 |
| edit      |               3 | 66 /36 /30                  |                          5 |
| fork      |               3 | 66 /36 /30                  |                          5 |
| child新问 |               4 | 88 /48 /40                  |                          6 |

每阶段保留完整请求摘要/原入站POST计数和借用原backend DB的只读快照；旧current所有业务行逐ID保持，Bob全行2/44不变。ledger和gateway_calls按真实tenant/user/request_key复合键，Trace只按其真实actor/model/application/tokens集合，不造逐请求外键。fork零增不能仅看供应商（cache replay可能不增），必须看raw ingress。标题固定system/hash与非stream单独分类；不能因新query含旧marker而只据includes选错阶段。

## 本次准备范围

新增`scripts/fixtures/mac-message-edit-fork-oracle.mjs`只提供受控普通文本回复及只读请求投影；不发Runtime命令、不修改库或任务。其测试包含：编辑1/fork0/child1；额外title/replay、旧分支、错cwd、缺child继承拒绝；受控seed/title正常委托；实际原title函数正反合同。

薄派生已保留原warm5和seat/logoutcold尾段，新增edit/fork/child/reload为一个有限检查。原Memory驱动只复用经过实际验证的公共预算/IO绑定函数与原clock派生器的结构，替换整段Memory步骤，不执行Memory设置、写文件或提取。新只读观察器复用原message/part排序、原codecs和canonical active-branch selector，fork注册瞬间未发新turn，不把TaskIndex必须completed作为推理证据（仍要求原消息完成/无运行态）；child完成及reload保持原completed要求。新增纯合同实际执行派生command body、派生namespace/fixture重定向、临时SQLite readonly读取及原分支选择，后续Root冻结真实env/profile合同、完整source closure和同一180秒case/160秒work/20秒清理预算；不足原30/10或工作预算时失败，不重试/不放宽。失败也精确关闭本case Main/Host/CLI/PTY、BH/ports与OS guard，保留历史失败。

## 首轮设施失败与 v2 修正

v1 已实际完成原warm5，raw/supplier4、current2/44，随后测试投影错误地要求assistant正文RowShell内部包含fork按钮，未发生任何edit/fork/child。真实`ConversationTurnGroup`把`ConversationAssistantTextActions`延后至同turn footer，和正文RowShell是兄弟：`section[data-turn-id][data-turn-key]`为归属边界，footer testid仍使用`latestAssistantTextRow.rowId`。原失败/290源/plan/compiled逐字归档，不把暖5当消息生命周期验收。

v2只修测试读取：唯一完整受控reply正文RowShell取原rowId，在同active pane查精确`v4-fork-<rowId>`唯一按钮，且按钮和正文最近turn section必须同一DOM对象；原hover正文和实际按钮点击不变。安全失败投影增加body/action计数与turn元数据。没有放宽“存在任意分叉按钮”，没有改产品TID/DOMstyle或业务入口。实际原JSX的RowShell、AssistantTextRowView、TurnGroup和footer actions返回树经SSR生成DOM，周边Markdown/Flow内容边界用受控stub；旧真实projection重放assistantRow=null为RED，新projection为GREEN，错suffix/重复action/异turn严格拒绝。这是结构合同，不称整棵React应用或Native交互已通过。原v15 ASAR实际两个renderer chunk的turn/hover/testid字节事实另留独立只读摘要。

## 第二轮异步 fork 等待设施竞态与 v3

v2 已实际执行同session编辑及一次新增主请求，raw5/current3settled66且真实下一请求排除旧分支；点击原fork后，异步`dispatchCommand(...).then(onSessionCreated)`尚未完成界面切换。旧等待谓词只要求编辑后的query/reply与action，因此仍显示的parent本就满足，`until`立即返回parent后才断言非parent，发生设施失败。清理后原只读SQLite已证child session存在且parent_id/task_type=fork正确；这不证明UI曾切到child，也不证明forkProof或child模型消费通过。v2的295源/plan/compiled及实际失败原样保留。

v3仅将排除parent ID加入同一个原DOM投影的ok条件，在原20秒内等待真实child；正文/精确footer/同turn/同pane绑定全部保留。没有直接导航child、没有RPC、没有延预算。实际源JSX DOM投影按parent→parent→child提供给实际派生`until`函数，旧逻辑返回parent为RED，新逻辑只在第三次返回child为GREEN；没有child或无效child仍超时失败。原计费及旧历史验收不变。
