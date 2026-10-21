# Server 原更新前后的持久状态与原 WebSocket 客户端

v9独立切片6项真实检查已经通过，root另行读取并核实。后续v10补HTTP结构化收据时发现真实启动时钟回拨缺陷，现已按[独立修复报告](client-sqlite-startup-clock-test-2026-10-20.md)修复、正常重建并在v11原Server加受控进程回拨复测7项通过；v10原始RED不被覆盖。本文件原v9仍是历史具名范围，不代表整个项目目标完成。只使用既有公开Core RPC、原Server CLI update和原客户端`connectViaWebSocket`，不新增接口、不直写业务SQLite，不修改两个既有update共享测试脚本。

## 运行前置的合法修正

先前v1缺provider、v2缺显式reasoning、v3错误要求best-effort Agent标题立即等于TaskIndex标题，均保留原失败，不是更新缺陷。v4/v5/v6曾把legacy `plan`当成canonical权限mode；原`shared/execution-state.ts`明确将其解释为`build + planEnabled:true`，legacy snapshot仅展示`getMode()`，故改用原canonical `edit`强断言，不由该字段宣称验证planEnabled。

v7已实际经过原update并观察旧WS自然1001/`Server shutting down`/wasClean，新Core读取session为not-active；原合同要求先Task.resumeTask，v8补齐该入口后返回not-found。只读诊断自有CLI库没有session行，原runtime源码明确普通空Task直到首输入/外部活动等才真正持久化，不能把未落盘会话说成更新丢数据。TaskIndex本身的行与会话store持久化不是同一事实。

因此本轮在执行前明确改用原公开`Session.createSession(importedHistory)`导入两条标注的自有测试history/title：原产品`persistImportedSessionHistory`负责先落session/messages后resume，源码明确该导入不执行模型。这是实际可恢复会话的合法前置，不是测试直写业务DB；不据此覆盖普通Prompt创建、运行任务或force更新。所有历史失败和已取得证据继续保留。

## 已核实的原接口与方案

- 原Core通过`createLocalServices(standalone-server)`注册File、Setting、Task/Session服务，loopback `/ws`提供既有`SocketProtocol/ChannelClient`。
- File没有通用`writeTextFile`接口。使用原`createScratchWorkspace`创建自己的工作区，原`writeWorkspaceFileSearchIgnore`保存带唯一marker的`.zcodeignore`，再以原`readTextFile/readWorkspaceFileSearchIgnore`回读；不伪造不存在的写接口。
- 原Setting.update/get写读非默认locale与terminal配置，捕获限定字段，不保存身份凭据。
- 原Session.createSession以导入格式写两条明确测试消息/title，原Task.renameTask/listTasks与Session.readSession回读同一ID、标题、canonical edit及model/reasoning。模型可用性前置通过原ProviderSettings公开API配置仅loopback自有provider与静态model；任何实际chat请求计数并失败，不静默模拟推理成功。更新与restart之后只用原Task.resumeTask恢复原ID，不再创建替代session、不补写mode/model。
- 测试进程只通过原`connectViaWebSocket`连接和重连；Node22原生WebSocket提供浏览器兼容transport，不替换原客户端RPC实现。原客户端没有自动重连功能，此切片不冒称UI自动重连或原Retry按钮。

原CLI通过本地受控HTTP安装未修改的旧真实发行包，在旧Core上种以上状态；保持该WS未关闭。随后由原CLI下载/校验/切换到不同SHA的新真实发行包。记录旧WS自己的onClose code/reason/wasClean，不主动关旧WS来制造断开；新Core ready后，以同一原客户端入口新连并回读全部状态，再原restart后复读并原stop收尾。

两真实归档manifest版本均3.16.0，属于同版本不同构建替换，不能声称跨发行版本数据库迁移。数据只在本轮独立HOME/server root，发布catalog是隔离容器loopback原HTTP；没有正式远端发布或真实身份。限单个network-none、1GiB Node容器，无GUI或重压缩，输入/归档只读；执行窗口已经root允许，未触碰主服务/主库。

## 已取得的验收证据

1. 两原归档SHA、原安装指针及Core PID/HTTP版本实际换代。
2. 旧Core原RPC创建目录、文件、设置、task/session并即时读回；没有测试代码直接写业务文件或SQLite来种数据。
3. 更新时旧WS自然断开，原onClose事件和关闭时间相对于update记录；关闭后旧代理请求拒绝，不无限挂起。
4. 新Core原客户端新连，所有seed原字段不丢失，读取同一task/sessionID；随后原restart再次保持。
5. 原stop、Agent/Core/Supervisor等已知PID、监听端口/control socket与具名容器/卷全部关闭；工作证据目录保留说明明确。

本文件后续只以真实结果更新，失败保留。真实企微OAuth受阻页面不重试；外部MCP与网盘继续排除。整体目标仍未完成。v10并非SQL语句失败，而是原startup严格schema拒绝负elapsed后归类sql_failed；详细原始错误、永久RED及新实际Agent复测见上述独立报告。

## v9 真实结果

权威证据为`evidence/client-server-update-stateful-v9-20261020/{result,controller-result,independent-verdict}.json`，6项业务检查通过、容器exit0。旧原归档SHA为`bfd55ad31626c9fd140cead8be5944f30c3b3eab964887e3b77d6510f9b2e299`，新原归档为`04bc1eae3d40f1fa48b996ca20f97a7ff5a31902e892056726269662c2ee9d01`，两个manifest版本都是3.16.0。

| 原操作/检查         | 实际结果                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 原Core及Agent换代   | 旧Core75/Agent102 → 新Core149/Agent176 → 原restart后Core219/Agent247，确实为不同进程                                                        |
| 原HTTP              | 旧Core `/api/server-info` 200/0.0.0-dev；原update后及restart后200/3.16.0，WS能力true；不是Supervisor版本冒充HTTP版本                        |
| 工作区文件          | 原File API创建目录、写`.zcodeignore`；三阶段原File API读回完整marker/内容逐字一致                                                           |
| 设置/provider/model | 原Setting API设置locale/terminal偏好，三阶段相同；自有provider仍存在，原会话model/ref/reasoning none与edit保持                              |
| 原Task/Session      | 三阶段同一持久ID、TaskIndex与Session标题相同；新Core及restart仅原Task.resumeTask恢复原ID，没有重建会话、补写mode/model或手改DB              |
| 两条导入历史        | 原createSession(importedHistory)实际写入，三阶段所有消息字段/ID/正文完全一致；assistant条明确为导入测试夹具，不是模型生成结果               |
| 原连接生命周期      | 旧连接在原update开始后自然code1001、`Server shutting down`、wasClean=true；更新后与restart后新连的原SDK连接也在原restart/stop中自然同样关闭 |
| 旧代理              | 关闭后原Setting代理立即返回`ChannelClient is disposed`，未因等待超时冒充拒绝                                                                |
| 空闲更新约束        | 原status.runningTaskCount=0，旧WS保持连接，未先手动关WS、未传force求绿；全程实际chat请求0                                                   |
| 收尾                | 原stop；8个已知PID、5监听端口和control socket关闭，业务/提取具名容器和原bootstrap卷均不存在                                                 |

测试文件为`server-update-stateful-probe.mjs`与`run-server-update-stateful.py`两个独立入口；未修改共享`run-server-update.py`或`server-update-probe.mjs`、产品源码或原归档。旧CLI已有归档属主缺陷，所以安装/更新使用正常修复包的bootstrap原CLI；完成新包切换后，restart/stop走安装前缀的原稳定launcher，与已有原update生命周期测试边界相同。

v9的`independent-verdict.json`独立14项通过：三阶段状态/两消息、model/reasoning、原关闭事件/旧代理拒绝、idle无force、同ID原resume不覆写状态、零chat、Core与Agent进程换代、收尾及执行源快照SHA。`probe-source-at-run.mjs`保留实际执行逻辑，之后当前测试文件仅作格式整理。

v1–v8的失败继续保留；v6因本地参数替换守卫未应用而仍跑旧plan断言，是设施重复，不新增产品反例。v7、v8的read/resume失败分别对应未active与普通空Task尚未实际持久化，不能写成数据被update删除。只读旧库查询仅辅助定位前置事实，最终通过的所有seed/回读均经原公开API。

数据输入、归档与自有work根保留用于追溯，0700目录没有声称删除。没有用户主服务/主库、真实身份、GUI、付费模型、外部MCP/网盘或被安全策略拒绝的企微浏览器操作。此结果不关闭普通Prompt首发、忙任务/force更新、跨发行版本、OS注册服务、UI自动重连、其他操作系统或正式远端发布。
