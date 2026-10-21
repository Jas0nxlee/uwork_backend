# Mac ARM64：登录态已完成任务冷恢复一致性

2026-10-21实际Native通过8项：保留原Mac clock 7项，增加1项“仍登录、同controller/profile已完成task受控停止后，由原UI打开同task且无推理重放”。Root独核21项与coverage独核37项均通过。本结果不覆盖尚未执行的成员禁用/重新认证、模型能力切换或Windows。

- 原结果：[result.json](../evidence/client-native-packaged-macos-clock-arm64-consistency-v1-20261021/result.json)
- Root：[root-independent-verdict.json](../evidence/client-native-packaged-macos-clock-arm64-consistency-v1-20261021/root-independent-verdict.json)
- 独立peer：[coverage-independent-verdict.json](../evidence/client-native-packaged-macos-clock-arm64-consistency-v1-20261021/coverage-independent-verdict.json)
- 精确资源收口：[owned-independent-closure.json](../evidence/client-native-packaged-macos-clock-arm64-consistency-v1-20261021/owned-independent-closure.json)

## 制品、身份和准入

正常原生ARM64包为v10，源`d0a5f374faec815cb5b8bfb73fe7b3b0743345c0`；[manifest](../evidence/client-macos-package-v10-manifest-20261020.json) SHA`5f88bd045a31e535215b603933da2d4940fad70f37b7e66aa50b0f6be169c475`，asar`c3ae2400…`，Agent仍CDF`cdf781ec…`。9项实际运行资源、12个ARM64 Mach-O、正常helper与严格签名已独核；未公证/未发布。旧四包完整目录字节、mode和symlink前后不变。制品于10月20日23:56–23:57产生，测试在21日进行，历史制品名不重命名。

fresh profile为`client-native-packaged-macos-clock-arm64-consistency-v1-20261021`，plan SHA`435bc6173cc4cb7b026456a006c3afe724c19c9ff9b623040dda506a1d1cb92c`、31个冻结源。启动前实际编译原clock派生代码，执行原profile断言；原7项、原1c工作区子进程函数/stdio/10秒预算不改，未使用外部sampler。

当前合成企业用户甲的实际role是`operator`；用户乙是同tenant、另一department的`member`。两者账户与账务分别核对，不把“普通用户”泛称当role证据。后台为同controller启动的隔离真实后端，模型供应商受控；原邮箱认证bootstrap和加密身份存储只在controller启动时做一次，没有真实企微请求。

受控模型500000 contextWindow经原Admin POST与GET回读，生产guard/32个工具定义保持。此合法前置不代表128000模型的保守字节上界适配已被本例验证。

## 实际冷恢复

初始原UI完成文件预览/reload、真实PTY和一次Composer发送，主调用与标题调用各已settled。原UI title、Host TaskIndex completed、实际Session语义在两次读取一致后，00:31:25.267+08取baseline；00:31:29.965+08完成cold后快照。

| 事实层 | 冷前与冷后证据 |
| --- | --- |
| 原UI | 同`task-item-*`与`data-session-id`，标题“原生企业资产联动完成”、企业用户甲、同model ID、reasoning none，原prompt和answer均显示。cold后确实通过原历史task点击打开 |
| 原持久化 | task/session同ID`sess_bf2a7a8e-2d58-49cf-be21-552e540181db`；两消息ID/role/text/finish等原字段、part IDs、模型选择、build/plan=false、标题及workspace/path语义完全相等，摘要均`1f35abc5…` |
| 初始真实执行 | 原production spawn facts、内核映射和CLI工作cwd、真实PTY cwd/TTY，以及原supplier system中的working directory，均指向本case的`packaged-workspace` |

UI的workspace字段实际是`packaged-workspace · main`展示标签，**不是绝对路径**。绝对路径由原CLI/PTY/supplier与持久化交叉证明。

本次Session库实际在本case私有HOME的`.zcode/cli/db/db.sqlite`，由已验证项目CLI PID79261的内核FD、birth和cwd绑定；不能仅凭`ZCODE_STORAGE_DIR`推测最终路径。Host索引另在`.uwork/v2/tasks-index.sqlite`。读取前先发生原UI同任务展示，再以内建`DatabaseSync(readOnly:true)`执行固定SELECT；没有new生产Db/Repo、迁移、租约、业务写入或手动恢复运行时。只比较持久语义，不要求lastViewedAt、连接lease、进程PID等运行态不变。

模型权威来自用户消息modelSelection、固定runtime/model_selection entry、原Composer配置锚点及初始真实supplier/后台模型归属。assistant低层字段若为空，不补造运行时模型getter；本例不是再次执行模型。`newCliIfSpawned=[]`只表示可选命令前缀分支没给出收据，**不能证明未spawn CLI**，更不能宣称cold后的新CLI执行/cwd已被该空数组验证。

## 停止方法与进程代次

原`stopNative`向自有进程组发送SIGTERM；不是UI菜单退出。原Main79057实际exitCode0、signalCode null、killObserved false，未触发原10秒后的KILL fallback；旧Main/Host/CLI/PTY先全部关闭才重启。controller始终79043，同profile新Main79682，身份仍登录且未重新bootstrap。

之后原seat拒绝与原UI logout检查继续执行；最终注销态cold Main79867不复活企业身份/候选。最终logout等待排除全部旧Main PID，避免误匹配历史launched事件。这里是三代Main，不能把后面的注销态冷启当作新增登录态恢复场景。

## 无推理重放与账务隔离

| 观测 | cold前→后 |
| --- | --- |
| 原Node server实际POST `/v1/chat/completions`入站 | 4→4（含初始用户乙2次） |
| supplier调用数/请求数 | 4→4，4个原请求摘要条目逐项相同，允许原相同body产生重复摘要 |
| 当前operator | 2 settled、44 Credit、24 input/20 output tokens，2 succeeded Trace、2已落结果gateway key；全部原行/ID/摘要保持 |
| 另一department member | 同样2 settled/44/24+20，原所有行保持，没有当前用户费用串入 |
| 配置与权限定义 | 当前身份、发布配置摘要/版本、policy、同tenant model定义、订阅和限额均保持；没有把合法credential刷新/lastSeen当计费变化 |

原`packagedRuntimeProof`冷后逐字段等于原delivered。原DB没有Trace到request_key的外键，不声称一条Trace与一条请求具有虚构精确关联；按真实actor/model/application、集合与tokens核对。仅supplier/账本不增不足排除同key缓存重放，所以另有真正raw request入站计数。后续原seat拒绝发送属于下一原基线步骤，不能把其合法被拒POST误算成cold重放。

## 收口与范围

原exec13859自然返回0，fixture返回0、cleanup errors=[]。25个已知PID、3个BH daemon共28个PID当前全部不存在，4个本case端口关闭，三BH root均私有0700；残留惰性socket节点拒绝连接，不声称文件已删除。原协议关联已恢复、系统剪贴板未使用且保持不变。31源保持冻结，没有触碰原常驻后端PID92288、个人浏览器或启动VM。

原8项业务、Root21与peer37均已覆盖本切片。后续模型supportsTools切换与真实UI刷新是独立场景；成员disabled→active旧session/重新认证、Windows仍另列，不能由本例升级为全平台或Mac全部功能通过。Linux客户端按用户最新范围不再新增；外部MCP、网盘及受拒企微浏览器不涉及。
