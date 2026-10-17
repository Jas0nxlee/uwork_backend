# 动态工作流企业资产联测

2026-10-17。G02 的真实动态工作流专项已完成：最终同版正式 CLI 的 10 个不重复场景全部通过，另 5 项 keyless 模型回归通过。实际验证包括 actor 消费批准 Skill 正文、同 run 更新/撤权、身份 fence、冷恢复及直接启动权限绕过修复。Native 工作流 UI 和未具产品出口的企业专家 persona 不由这些结果替代。

## 最终正式产物验收

正式 CLI 与 Desktop staged CLI 字节相同，SHA-256 为 `a684e40751e1f9bf7e8e7e3710f8518001451ec33d74964e5502a297a1d23d0c`，Node 为 24.14.0。统一构建的 Main/Host SHA 分别为 `9ab3816f44acea49a06105fd6cc77989ca94031c35701b42aabac96b0541cca7`、`dd066c697dd69e519eb835b432d6918c310986bab38b212cf609415c400b78a7`。本组实际使用正式 CLI stdio、真实 Host 源服务、隔离后台 HTTP 和本机受控供应商；production Electron 使用构建后 Main/Host 的 Native 验收由对应专项记录。

| 场景                   | 最终实际结果                                                                                                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 未公开 expert selector | 正式 SaveWorkflow 编译拒绝，零批准、零定义、零 actor；同名企业专家不隐式变成 workflow persona                                                                                      |
| 保存与模型工具边界     | 合法定义保存一次；Create/Amend/Resume 模型工具返回 `enterprise_capability_unsupported`，同 session 冷启动仍拒绝，原字节保留                                                        |
| 新保存文件撤权         | `enterprise_filesystem_denied`，没有新文件、第二次批准或旧定义改写                                                                                                                 |
| 父请求身份注销         | 下一 workflow 触发零新增供应商请求                                                                                                                                                 |
| actor 当前批准版本     | 两次 ask 的 Skill v1/v2 正文分别实际进入后继模型请求，同名专家正文未混入                                                                                                           |
| actor Skill 撤权       | 第二 ask 当前结果为 `enterprise_skill_not_found`，不从缓存补正文，合法第一 ask 历史保留                                                                                            |
| actor 文件撤权         | 第二 ask 首个已准入请求确实发生；后续因 `enterprise_filesystem_denied` 进入 `errored`，零工具正文后继模型请求，合法历史保留                                                        |
| actor 身份注销         | 第二 ask 零供应商派发、零额外账本；公开 cancel 仍 accepted，真实终态为显式 `stopped(user)`                                                                                         |
| 持久冷恢复             | 未派发第二 ask 时取消、退出 CLI，再冷恢复原 session 与同一 run ID；第一 ask 零模型重跑，第二 ask 读取当前 v2 完成                                                                  |
| 初始文件权限拒绝       | V4 startSavedWorkflow 返回 failed/`enterprise_filesystem_denied`，没有 run ID、actor 或新增供应商请求，工作区入口项不变；源码测试另证明拒绝先于定义 lookup、Engine/createRun 和 VM |

这 10 项最终证据合计 **1,699 次后台 HTTP、54 次本机供应商请求及 54 settled 账本、18 个 CLI 正常退出、30 个端口关闭、10 个临时目录删除**。独立 keyless 回归 5/5：JSON、SSE/自动标题、Gateway 默认模型，以及 open/read 两种取消。该组另有 187 次 HTTP、7 次供应商/7 条账本（5 settled、2 次已发生取消按原合同 uncertain），5 个 CLI 退出、15 个端口关闭和 5 个目录删除。

聚合证据 `evidence/client-workflow-assets-20261017/final-formal-artifact-summary.json` 对每个正式 CLI SHA、检查项、供应商/账本相等、端口/进程/目录清理逐项断言；每个私有模型 open 均含严格不透明 owner proof，模型正文与 read/close 不含该字段。`summary.json` 只汇总四项保存/入口场景，`dynamic-summary.json` 只汇总六项动态场景，均不以各自子集代替总体验收。

首轮 9/10 的失败完整保留在 `final-a684-first-pass/`：旧观察器等候 completed，而新 run 已正确以 filesystem_denied 进入 errored。仅调整此观察器并拆出独占断言 helper 后，六项动态场景重跑全部通过。`final-test-driver-manifest.json` 证明生产源码和构建产物未变；57 项原冻结中仅这一个已批准测试 driver 的 SHA 改变，新增 helper 也只用于测试。终态再次 cancel 明确返回既有 not_running 业务语义，不假称取消了已终止 run。

## 真实公开入口与权限边界

当前存在两套正式入口，不能混同：

| 入口                                                          | 当前实际结果                                                                                                       | 状态所有者                                        |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| 模型 `SaveWorkflow`                                           | 显式 project/global 作用域、逐次交互批准后保存真实定义；编译拒绝未声明的 expert persona 字段                       | 既有 saved workflow store / 编译器                |
| 模型 `CreateWorkflow` / `AmendWorkflow` / `ResumeWorkflowRun` | 当前企业 Host 返回 `enterprise_capability_unsupported`，尚无这些 permission 的分类；不代表整个 workflow 产品不可用 | Host 当前企业准入                                 |
| V4 `startSavedWorkflow` / `resumeWorkflowRun`                 | 正式 GUI 使用的直接入口，真实启动/恢复 run；点击替代交互批准，企业安全准入仍必须检查                               | 原 Core runtime / bootstrap run service / journal |

`clients/uwork/apps/zcode-cli/packages/bootstrap/src/app/create-app.ts` 的 `startSavedWorkflow` 调用 Core `startSavedWorkflowRun`；后者源码明确自己是 `port.submit` 的第二个调用方。`dynamic-workflow-run-start.ts` 原路径绕开 ToolExecutor，不可仅凭模型工具拒绝或默认灰度关闭停止调查。

灰度由既有 CodingPlanSubscriptionService 的 `getDynamicWorkflowClientConfig` 解析本地覆盖/远端快照，经 `zcodeAgentService` 同源发送 `workspace/updateDynamicWorkflowPolicy` 与 createSession flag。本测试只在独立夹具显式打开该正式协议开关，没有冒领 Native 当前已打开灰度，也没有调用外部灰度服务。后台 `assistants.agents` 归 `/api/client/agents`、`/api/client/runs` 的独立兼容能力；此处本地 workflow 的私有工具/模型执行仍检查 local 渠道，不能用 agents=true 推导本地 workflow 已授权。

actor 工厂复用父 `modelFactory`、`permissionService`、企业 Skill catalog 和父 runtime 派生的私有 client ports：见 `create-app.ts`、`script-workflow-child-runtime.ts` 与 `createChildClientPorts`。这已被实际供应商 IO 验证。当前 `AgentPersona` 公共 facade 只有 `system?: string`；actor name 是 run 内身份键，并不查企业 AgentProfile。企业专家正文归既有 `Agent` 子任务 owner；未增加新的专家 workflow 产品或手工复制正文冒充集成。Playbook/自定义指令无当前 owner 的分发拒绝保持原合同。

## 正式旧产物的实测证据

旧正式/staged CLI 均为 `0d9588624db3368787cbbd86c3d27a92b327e1d169614f1b1162f7e61895454c`。以下九个有名场景的各自记录均包含完成检查、供应商/账本和清理；汇总为 1,296 次后台 HTTP、51 次本机受控供应商请求/51 settled、16 个 CLI 退出、27 个端口关闭及 9 个临时目录删除。它们是修复前的独立观察，不能冒称未来新产物已经通过。

- 公开 SaveWorkflow 编译拒绝 expert selector；合法定义真实落盘。
- 模型 Create/Amend/Resume 的真实企业拒绝；同 session 冷恢复后仍拒绝模型入口。
- 文件权限撤回后新保存拒绝，原定义字节不变；实际身份注销后下一父触发无新增供应商。
- V4 直接启动：同 actor 两次 ask 分别通过 Skill 读取当前批准 v1/v2，正文实际进入各自后继模型请求。
- 当前资产 deny 后，第二 ask 的新 Skill 结果为 `enterprise_skill_not_found`，不拿缓存补正文。
- 当前 filesystem=false 后，第二 ask 的新 Skill 结果为 `enterprise_filesystem_denied`，合法第一 ask 历史保留。
- 第二 ask 私有模型 open 前真实 identity.logout，零该 ask 供应商派发/零额外账本；随后显式取消清理，不冒称自动终止。
- 第二 ask 未派发时取消，关闭 CLI、冷恢复原 session，再经正式 V4 resume 同一 run ID。第一 ask 从 journal 回放、零模型重跑；第二 ask 读取新 v2 完成。

旧观察在 ignored `evidence/client-workflow-assets-20261017/pre-fix-0d-artifact/`；`pre-fix-formal-artifact-summary.json` 固定上述九项历史样本，未加入最终新产物统计。当前目录的 `*-proof.json` 属于最终 a684 产物。受控模型固定生成的“完成”不用于判断权限；判定取当前调用的实际工具结果和派发/账本数量。

## 三个实际缺陷

1. 后端对单工具 description 限 20,000 字符。正式 CreateWorkflow 为 30,137 字符/30,397 UTF-8 字节，SaveWorkflow 为 23,062/23,208；打开正式工具面后真实 HTTP 400、零供应商/零账本。仅将单说明的明确上限改为 65,536，保留整体 2 MiB body、64 工具、参数 schema 100,000 字节/20 层/10,000 节点、完整 UTF-8 tools 上下文预算和严格上游工具合同。HTTP 回归先在 30,137 字符重现 RED，修后 30,137/23,062/65,536 成功结算，65,537 仍在派发/计量前拒绝。Gateway 相关及供应商回显回归 66/66 通过。
2. 后台发布 filesystem=false 后，旧正式 V4 直接启动保存定义仍返回 accepted 和新 run ID，未在读取定义/VM 启动前检查企业准入。立即公开 cancel 清理，不能把该取消算作拒绝。原始观察在 `pre-fix-0d-artifact/direct-start-filesystem-fence-observation.json`；源修复前的独立 Core/公开定义读取测试也得到 missing expected rejection。修复按既有 filesystem 能力与不透明 operation owner fence 接入 Core、run owner、准备/VM、真实 world/artifact IO 和公开定义内容读写，不新增模型权限白名单，不删已接受历史或假定回滚已发生写入。最终正式产物该项已返回真实准入失败。

3. 独立受控本机探针证明：CLI 初始模型准入归 A，私有 open 真正处理前切换为另一有效 B，旧输入已派发到 B，只有回包阶段才报 identity_changed。修复复用既有 ModelDispatchGuard ALS 首 owner，私有 open 严格携带该不透明证明，由 Host 在同一 scope、构造/派发前比较；不在缺失时认领当前新身份，不降级到旧协议。独立 GREEN 4/4：同 A 正常请求/read/close；切 B 为零供应商；缺失/非法证明为零 open/零供应商。HTTP/V4、模型正文、header、VM 与持久化不增加该字段。

## 源码验证与验收边界

当前 22 项专用严格源码测试通过，覆盖初始拒绝先于 lookup/Engine/createRun、初始化 await 后撤权与 draft、迟到取消、owner/managed 变更/缺 key、真实文件读取后 fence、artifact 读后撤权零 store 写、service close 后零注册、VM 准备后的真实错误终态。`pnpm test:enterprise-policy` 的 Core 106/106、Host 158/158 全过；Host relay/catalog 定向 23/23；后台完整 250/250（包含 gateway description 回归）通过。根 backend/admin 与客户端类型检查、Core/Bootstrap 类型检查、根/CLI Lint 和架构检查通过，根 114 条与 Core 11 条既有 warning 保留、0 errors。CLI 格式使用其 0.47 工具，未用根格式忽略 CLI 子树代替检查。最终观察器变更后重新执行根 backend/admin 严格类型检查、两项 driver Lint/格式，均通过。

构建前最终只读审查确认 57/57 冻结文件 SHA 一致、无剩余高置信必修项。审查先独立重现了转录读后换 owner 仍继续两次写/一次 resume 的问题，修后独立检查为 4 次同 fence 校验、零写/零 resume；import 读取不能把权限错误降级为无缓存。每个 actor 模型尝试与队列后复核原 run owner；已发生的一次 message 写入不冒称回滚，后续 part 写入和 resume 会被拒。公开冷回放的 report/log/instruction 内容也走当前读取准入，原纯状态/内存计数与取消保留。最终同版正式产物和真实场景已完成上述复测。取消、关闭、内部结算/内存计数继续可用，跨会话恢复的原开放语义不擅改；本轮实际冷恢复使用原 session。

G02 动态 actor Skill 正文消费/当前权限/同 run 恢复切片据此补完；模型工具的未知 capability 分类与当前未公开的企业专家 workflow persona 仍按实际拒绝记录，不造新产品或白名单。Native 工作流 UI、定时调度、手机/远端 attachment、Windows/Linux 安装及真实外部供应商分别由各自验收负责，不由本组结果替代。没有读取主 `.env`、解密主 Vault、写主 DB、使用付费模型/真实企微/外部 MCP/网盘；主后台未重启，其他代理的产物与用户的 `tests/security-sixth-provider-echo.test 2.ts` 保留。
