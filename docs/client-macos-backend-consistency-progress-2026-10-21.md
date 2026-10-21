# Mac 客户端与后端一致性：本轮实际进展

> 当前状态校正（2026-10-21）：下文按执行顺序保留历史，“未运行／下一步／锁屏限制／等待 Windows”均只描述当时，当前以本段及[有限消费者覆盖审计](client-macos-finite-consumer-coverage-audit-2026-10-21.md)为准。用户已取消 Windows；Linux 不新增；发布由用户通过 GitHub Actions。
>
> Memory 两项权限缺口已本地修复（`500914df`、`d14eef85`），正常 ARM64 v16 完整构建、严格签名及84源稳定。真实已有话题 filesystem=false 6/6、true 6/6、原自动写回和新任务索引消费8/8全部通过且有独立原始证据复核，见[完整验收报告](client-macos-native-memory-manifest-fix-test-2026-10-21.md)。Native 未外发不等于内核零读取；零读取因果由 Runtime 测试证明。自动写回初始空 manifest，已有话题 true 正控已另测，不能互相替代。
>
> 消息 edit/fork 和归档／恢复已真实各8/8。新确认的未覆盖原 UI 消费者为归档单条删除、忙碌 Composer 队列，正在分别准备薄切片。活动任务 Quit v11 已发原菜单并读回前台 true，随后 AXRole 返回 -25204 且无值，确认／Cancel／Allow尚未发生；不能继续沿用旧锁屏为本次根因。新 v12 只扩大私有消息子预算100→500ms并保留总5秒，待独立审核，不回填旧结果。
>
> 最终修复 x64 v17 正常四步和签名均0，但必需 Swift helper 缺失，严格11/12判 NoGo、无 manifest、无 Native。系统 Swift 缺 x64兼容库；隔离官方6.3.3可直接编译但标准 xcrun 选择探针仍 NoGo，临时入口已清理、默认工具链未变。App最低12来自原Electron41.10.7，非显式builder设置；将helper目标11提高12不能消除所需兼容库。现有 GitHub Actions使用原生 Intel runner，未运行发布。Mac全覆盖和整体goal仍未完成。

当前检查点：ASAR 完整性元数据修复已本地提交 `f4cac913`，正常 ARM64 v13 新包原七项及独立31项真实通过；正常 x64 v14 新包在原30秒门限内29.894秒进入页面，随后原生AX属性读取失败，0/7，未到BH、副实例或业务操作。原失败保留；独立只读诊断已确认AXWindows项等同应用根，本次未能辨识真实窗口，不能用诊断补足原七项。[当前新包验收边界](client-macos-asar-metadata-fix-acceptance-2026-10-21.md)为准。本文后半 CPU v3–v7 与旧 v11/v12 是历史执行链，“下一步/未运行”只代表当时状态。

[完整强杀恢复与新执行](client-macos-crash-task-consistency-test-2026-10-21.md)已由 v12/consistency-v5 真实通过：原7+新增2共9，Root30/独立32；旧任务A同UI/库语义零重放恢复，原UI新B仅新增2笔44且旧A/他人全行保持，原撤席及注销cold继续通过，30个自有/控制PID、四TCP和三BH关闭。v2/v3取证设施原失败、v4先行观察分别保留。[单件PDF原UI分享](client-macos-native-share-artifact-test-2026-10-21.md)也已原切片7/Root27/独立15通过，606B四方SHA、分享账务零增及撤销清理闭环。原应用活动任务Quit的当前前台条件受已观测锁屏限制，未发出Quit/取消/确认，不绕过锁屏；同成员重新认证、Mac OS-read await、物理Intel和Windows环境缺口仍开放。

按最新优先级先测Mac，Linux不再新增。正常ARM64 v10原签名包、隔离真实后端、原Host/CLI与受控供应商完成下列五个真实边界。没有把service/React测试、控制API成功或构建成功算作Native验收，也不将重复的原基线检查相加为新功能覆盖。

后续扩展设置消费者发现并真实补齐项目Memory开关：正常v13 `memory-v2` 原7加一项共8检查，33.263秒通过。原UI关闭→开启→再关闭的三个新任务，真实供应商主请求index4/6/8中完整记忆片段为0/1/0；标题5/7/9独立分类。34B文件由原xterm创建且SHA保持，UI只证明目录同scope/唯一文件/count1，不冒正文preview。本人2/44→4/88→6/132→8/176、另一成员全行2/44保持，原撤席与logoutcold继续通过；19known+2BH/4TCP/OS闭，89源稳定。v1缺hashlib设施失败保留，真正执行原失败片段与未解析全局依赖合同已修。只证明新任务上下文消费和自然短输入无额外请求；自动提取/Write写回为下一独立切片，尚未验收。[Root原始正文/数据库独核](../evidence/client-native-packaged-macos-clock-arm64-memory-v2-20261021/root-verdict.json) · [独立19项](../evidence/client-native-packaged-macos-clock-arm64-memory-v2-20261021/linux-sandbox-independent-verdict.json)。

| 新增真实边界                  | 实际结果                                                                                                                                              | 原检查／Root独核／peer独核 | 报告                                                                      |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------- |
| 登录态已完成任务冷恢复        | 同task/session、消息和part IDs、正文、模型/reasoning/workspace语义保持；真实POST和供应商、本人及另一成员账务零重放                                    | 8／21／37                  | [冷恢复](client-macos-cold-task-consistency-test-2026-10-21.md)           |
| 同ID模型工具能力往返          | 原Admin true→false→true，原UI同步及两次新task；实际主请求32工具→两个tool字段均省略→32，当前44→88→132 Credit且他人不变                                 | 8／33／48                  | [模型能力](client-macos-model-capability-consistency-test-2026-10-21.md)  |
| 同挂载网关401后成功晚200      | 真logout204→新401退休→旧200正常finish，973ms关闭；同node六次即时样本无旧投影回灌、账务零增                                                            | 5／24／28                  | [迟到响应](client-macos-mounted-gateway-consistency-test-2026-10-21.md)   |
| 原身份计时器自然到期          | 原内部issuer60000受控新会话，原me/store同expiry；原timer写revision1→2/session-null，expiry+4ms真实中止，release不投递，原模型菜单UCAS0                | 6／27／29                  | [自然到期](client-macos-natural-expiry-consistency-test-2026-10-21.md)    |
| 原UI安装插件后实际Skill正文桥 | 原User安装及根路径读回→原Composer→同call_id后继roletool真实440B，完整正文与117B manifest/140B SKILL SHA及本次安装路径吻合；新增3笔66 Credit且他人不变 | 4／29／37                  | [插件正文](client-macos-plugin-skill-body-consistency-test-2026-10-21.md) |

五次运行均自然结束，fixture为0、原清理无错误；每次自有进程、浏览器控制、四端口及原OS协议分别独核关闭/恢复，常驻后端PID92288未重启，未启VM。当前角色实际为operator，另一成员与当前用户账务分开；Trace无request-key外键，仅按实际模型/actor/application集合和tokens聚合核对。本轮新修正均属于测试夹具或取证断言，没有借故改产品、延迟原预算或削弱原权限门。

这不是“Mac与Windows全覆盖”：原包同成员重新认证仍缺合法受控本地IdP入口，不能借真实受拒SSO或重置一次性callback替代；真实Mac OS-read await撤权、物理Intel及其他明确缺口保留。正常v9 x64/Rosetta的正确clock-prefix freshcase v2已实际失败：原30秒renderer就绪超时、0业务检查，没有执行secondary，不能据此解释历史10秒副实例问题。原Main日志仅证明主实例取得锁，GPU退出等清理后日志不当启动根因。6个已知PID/4端口及原OS协议已关闭恢复，见[原失败报告](client-macos-x64-startup-diagnostic-test-2026-10-21.md)。下一步为[独立Main CPU诊断](client-macos-x64-cpu-diagnostic-scope-2026-10-21.md)，仍未运行；不修改原包或放宽原验收期限。

Windows本机仅发现Windows App远程客户端，没有已授权可用测试主机或Windows VM。已一次性索取现有测试入口，不要求用户执行测试；[运行输入静态审计](client-windows-runtime-input-audit-2026-10-21.md)、[合同审计](client-windows-linkage-contract-audit-2026-10-21.md)和[实际执行计划](client-windows-native-linkage-execution-plan-2026-10-21.md)分别记录，PE和Mac上纯测试不冒称Windows Native通过。真实企微浏览器、外部MCP和网盘不纳入本轮。整体goal继续active。

CPU诊断首次v3已实际失败在测试入口：fixture13、20.0446秒等待backend-ready超时，原工具输出含unsettled top-level await警告；没有App、inspector、profile或已分配端口。原finally的BrokenPipe及fixture非零退出保留，2个已知PID关闭、OS协议恢复，不能写“清理无错误”或伪造账务验收。7份已审源归档加28份未变文件可完整重放35源，见[16项独立失败收口](../evidence/client-native-packaged-macos-clock-x64-startup-v3-20261021/coverage-independent-failure-verdict.json)。后续v4只修测试入口模块环：CPU运行函数移独立模块，真实小Node模块图先验证，再单独冻结新case；未改产品或原业务预算。

CPU v4在诊断handler参数求值处resolve未绑定而失败，2.599秒/未发送Inspector RPC；原fixture0/cleanup[]、3PID5port已闭，[15项独核](../evidence/client-native-packaged-macos-clock-x64-startup-v4-20261021/coverage-independent-failure-verdict.json)保留。修复仅改测试命令的Common已有join绑定，并加入实际派生handler执行RED/GREEN。fresh v5终于取得完整CPU证据：[诊断报告](client-macos-x64-cpu-diagnostic-test-2026-10-21.md)、[25项独核](../evidence/client-native-packaged-macos-clock-x64-startup-v5-20261021/coverage-independent-verdict.json)。实际等待采样30001.128ms、profile窗口33622.323ms、总case38.712秒；1534194B私有0600数据、6069nodes/21197samples、7固定方法/单resume，双actor全账务与raw/supplier2精确零增，6PID5ports和40源闭合。

[独立全样本与ASAR源码分析](../evidence/client-macos-x64-cpu-profile-peer-20261021/analysis.md)定位首窗口创建/同步加载路径约9.526秒，其中loadURL3.538秒已包含，不能相加或把5.941秒自身帧全归某个native指令。后置架构提示属于预期Rosetta检测；CPU结果不足以支持猜测式产品修复或关闭原30秒renderer/10秒secondary验收。下一步[原副实例固定阶段诊断](client-macos-x64-secondary-diagnostic-scope-2026-10-21.md)只准备普通无inspect主实例及原1c一次，仍未运行，不新增业务验收主张。

2026-10-21本轮最新：副实例退出与预热归属修复已本地原子提交`0aeff9ad`（5文件），Root相关75项/4个fallback场景、必要门禁及fresh五轴源码审查通过。正常x64 v11与ARM64 v12包均静态签名/资源合格，ARM helper UUID/派生签名元数据差异先失败、独审后仅接受精确新SHA，原失败保留。ARM v12原7/7与独立29/29真实通过：原副实例自然0并由后续UI workspace/CLI cwd实际证明转发消费，文件/reload/PTY/本人2settled44与other2/44、seat零增及logoutcold均过，19known+2BH/4port/UNIX/OS闭。x64 v11原7首次仍0/7 FAILED30renderer、未到AX/BH/secondary，6PID4port闭，不能混为已过；随后同未修改v11的独立v7诊断（原1c10、primary<=60仅前置）实际false/自然exit0/noSIGKILL/Main同代/双actor全行与raw/supplier2零增，7PID4port/42源闭。该诊断不当ACK/UI消费，也不回填原30/7或物理Intel。详见[统一验收边界](client-macos-secondary-exit-fix-acceptance-2026-10-21.md)。Mac五个ARM64具名新边界仍单列，不将重复基线相加；Windows入口及Native重新认证/Mac OS-read await环境缺口保持，Linux不新增，整体goal active、未称全覆盖。

## 当前 Mac 单平台范围与 Memory 权限修复

用户已取消 Windows 联测，发布由用户使用 GitHub Actions。新发现的 Memory filesystem 权限缺口已用正常 v13 的显式发布/GET false 策略真实复现；本地原子修复提交 `500914dfe27f96d9db74381c6828244390413281` 接入原授权端口，保留同 owner 最终复验和原 turn 取消信号。独立审查发现并修复空 index 绑定丢失、初始身份失效被吞和待提交 Skills 提前共享三项边界。原 Runtime 29 项、含附件/技能的定向70项、Shared/Host40项和企业策略192+310项均通过（数量含重叠，不作去重相加）；client/CLI 类型、lint、架构及格式通过。

新 ARM v15 正常完整 CLI→stage→Desktop→package 四步均0，CDF 三处相等且区别旧字节，76源/9 runtime/12 ARM native、ASAR header 与严格签名独核通过。真实 filesystem=false 负例 v4 **6/6通过**，普通文本正常两次推理/44 Credit，新 MEMORY.md 正文及 header 不进主请求，fixture0/cleanup[]。自动提取与 true 策略正例正在运行，尚不宣称其通过；消息编辑/fork、归档/恢复和既有前台 Quit 等缺口仍按真实证据推进。

自动提取正例 v15 Auto v2随后真实 **8/8通过**（26.313秒）：原自然调度器两次非流式sidecar，原工具实际创建85B index与374B带来源session的topic，owned Memory root外文件未创建；新任务实际主请求含索引连续heading/body。本人8 settled/176 Credit，supplier/raw总10（含另一成员seed2），完整原seat/logout/cold尾链及fixture0/cleanup[]。Root已独读raw和两实际文件；这不等于直接观察进程内scheduler cursor、自动注入topic正文或全局文件sandbox。后续消息edit/fork薄控制器已准备，等待fresh plan最终冻结。

消息 edit/fork v3真实8/8通过（27.712秒），对实际wire/原只读DB及全部账务行独核：edit仅+1、fork0、child续问+1、reload0；父active分支未被child修改，child复制语义及ID映射正确。前两次分别是测试器误认footer层级及未等异步child切换，原FAILED保留，未改产品。原seat尾段合法追加两条拒绝历史及TaskIndex error另列，不伪称最终child全历史不变。

同task archive/unarchive v1随后真实8/8通过（27.075秒）。六阶段归档位false/false/true/true/false/false，stage历史/model/cwd全等、raw4不变；Root独立最终RO backend双actor完整账务行与baseline相等，原message/part/entries全前缀保留；尾段席位拒绝状态error单列。此为本地tasks-index生命周期与后台零副作用，不是云任务归档API。

进一步源码独审及真实SqliteSessionStore/NodeFileSystemAdapter Runtime测试确认自动提取manifest另有权限缺口：filesystem=false仍读取topic.description并发给首sidecar。与已修复index不同，原单词负例不触发此三词路径。17项测试现3正控PASS/14RED，正常v15 Native显式false/三词/topic负例准备中；尚未修改该生产路径。

## Manifest 独立权限缺口：实测 RED 与修复

正常 ARM64 v15 上，显式 filesystem=false/revision2 且 execution=true，原终端写入 154B topic（无 MEMORY.md），原 UI 四词任务自然触发 extraction。第 6 号零基非流式请求含 frontmatter description marker，32 工具目录保留；主请求/997B 标题不含该 marker。原始输入和请求、完整双成员账务、13 PID/4 TCP/OS 清理证据均保存；[实际报告](client-macos-native-memory-manifest-filesystem-denied-test-2026-10-21.md)。v1 终端输入丢换行属于设施失败，独立保留，不当产品 RED。

随后仅通过 4 处既有生产边界修复固定内部消费者 ProjectMemoryManifestRead：读取前准入、读取后同 owner 复核，原 scheduler signal 竞速，最后 await 后以同步消费者检查 scope/config/port；合法 live cd 仍沿原 snapshot cwd。新增永久 Runtime33 与 Shared/Host11 测试；完整 enterprise-policy 最终 225 Core +316 services=541，通过且零跳过，类型/lint/架构通过（根 lint 原114警告保留）。独立对抗复核 Go；本地原子提交 d14eef85，未推送或发布。新正常 ARM64 v16 建包与 Native 正反向复测尚未验收。

原活动任务 Quit v6/v7 均已成功发送原菜单动作，未使用置前 fallback。v7 失败诊断准确落在 AX 候选遍历 depth/seen 容量断言；本次尚未调用确认选择器或 Cancel AXPress，不能称产品取消或退出故障。原 finally 清理与账务收尾不是 Allow 退出效果。后续只准备有限只读候选诊断，不放宽原容量/时间边界。Windows 已按用户取消，发布由用户使用 GitHub Actions。
