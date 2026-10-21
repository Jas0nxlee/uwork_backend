# 当前wire/reload源 Linux 原包生产与真实复测记录

状态：**1a8匹配PTY新AppImage的v8真实完整原链11项及新增严格UI fit均通过，52.867秒自然exit0并资源闭合。历史v1中断、v3原生Error未知原因、v5/v6/v7设施失败全部保留；不外推其他格式、FUSE、物理Linux或所有平台。**

## 正常输入和生产

Root授予唯一共享out/targetassets owner后，原Node24/Pnpm干净production/preview/linux-arm64环境执行 `build:no-runtime-assets` 和原 `electron-builder --linux --arm64 --dir --publish never`，两命令均0。新输出位于非FileProvider的 `~/Library/Caches/uwork-backend/client-linux-desktop-package-wire-20261020/linux-arm64-unpacked`。没有运行Agent/Server构建，源CLI dist和staged linux-arm64 Agent前后均cdf。七项wire/reload/Main/confirmation/config源SHA前后不变，源commit为 `1bd1ec7b`，正常Linux九项fuse逐值与旧Clock包相同，没有flip或patch。

记录：`evidence/client-linux-wire-host-package-20261020/result.json`，硬输入manifest `evidence/client-linux-wire-desktop-package-manifest-20261020.json`。新asar为 `b253482dd49894f956f19a62aceecc02406dc1c68391ac76e999cc02710a9a15`，Agent仍 `cdf781ecf004b9639157fae25e6e96e558b95faefaee7aab09488d5dc650ecac`。这里只是生产成功，不是运行验收。

共享out/targetassets随后明确释放；再获唯一VM窗口，原 `prepare-native-packaging.py`复制最新tracked配置（含220 RPM模板）到freshcontext，沿旧已存在v10工具链加新project层，执行原 `native-package.sh AppImage` 单target，2560m/cpu1、正常压缩、publish never，49.2秒自然0。输入archive48ae，原产物187524261字节，SHA `338a4f2894ce2a7f9b6d9d033592640a9d3947bc16ee757540d1f15d839a2906`。旧原包/旧缓存未覆盖，没有global prune或重复四格式历史测试。

`evidence/client-linux-wire-appimage-production-20261020/result.json`保存实际命令和imageID，`validation-result.json`保存实际AppImage runtime纯extract后五核心文件逐字SHA一致、普通other读/执行及每层父目录遍历、原3.16.0/preview元数据断言。此纯extract不是FUSE/GUI验收，也不称四格式20项重新通过。freshconsumer `uwork-linux-desktop-appimage:20261020-wire-v1` / imageID `d0d6b70a004d598320f1e8665814d8180f82113ba9a14570feafee4ad6a7f7d6`仅覆入原新AppImage，mode755。

## v1设施中断及资源闭合

原执行source/manifest硬SHA在production目录 `gui-source-bindings.json`。独立wrapper只硬绑定新AppImage并在原Bridge attach后回读实际提取的五核心，调用未修改原probe完整业务/协议链。其原source快照按该硬SHA保留在 `evidence/client-linux-desktop-wire-appimage-v1-20261020/reviewed-wire-probe.py`。

第一次只读sha preflight容器输出了正确338a摘要，但Docker metadata曾显示running而原PID已不存在；该观察记录于production目录 `sha-preflight-stale-state.json`，不定为已知Docker根因。处理这个精确owned sha容器的rm句柄自然返回0后，旧wrapper已进入原GUI。agent随后错误地把自有controller29996当作仍在preflight阶段发送TERM，原controller退出143。这是agent设施操作中断，不是产品自行退出、OOM或本轮自然终态。没有原driver `result.json`落盘，不能重建其内存中的断言facts或写PASS。

被动原证据显示已执行到cancel等待中的第三未知URI：cancel/parallel退出收据均0，confirm未发；原supplier/proof为2请求/2笔settled44Credit，自有PTY文件存在。`live-extracted-core-files.json`证明实际启动新asar/cdf等五核心，不能因此外推整条File/reload/PTY/25s链已通过。cgroup memory.events全0，peak2321133568/current1710481408，未见OOM信号。

中断后先保存proof，原control POST `/shutdown`明确返回closingtrue，原容器随后自然exit0。只删除该profile原容器与原network，两者均absent；volume本未创建也absent。原BH daemon30653通过创建时间、原target的已记录80字符投影、稳定PIDbirth及精确Unixsocket绑定后，复用原HarnessBridge.kill关闭，daemon/socket均无；profile SSH进程已不存在，已知CDP端口51271拒连。另一个动态host controlport在TERM前未持久化，明确不补造四端口数值或四端口验收记录。完整收据为该v1目录 `interrupted-owned-resource-close.json`，另含manual-harness-ownership/harness-cleanup/cgroup原投影；没有重启Docker/VM或全局杀进程。

## 真实resize观察与fresh v2门禁

v1原日志两次出现 `terminal.resize FAIL`，原native错误为 `Usage: pty.resize(fd, cols, rows, xPixel, yPixel)`。PTY输入文件存在只证明输入链，不能代表尺寸resize成功。Root已接手核原node-pty JS调用与真实prebuild ABI，后续修复需加入实际 `stty` 尺寸正例；本agent未修改产品或依赖以掩盖该错误。

为防阶段误判，独立wrapper改为明确互斥三个phase。默认仅校验plan；prepare只读image inspect/源SHA并写freshplan，不启容器；preflight必须exact Root plan SHA，运行具名30秒实际readonlyhash，要求自然0且容器absent，写receipt后本进程退出；GUI run须另显式exact Root SHA与成功preflight receipt。原sharedprobe的实际hash仍执行，只给该精确只读argv加owned name/timeout/失败owned-close，不返回缓存或mock。记录ports/BH/tunnel归属先落盘，被动保存cgroup first/latest，原业务/安全断言和清理仍保持。

永久8项纯门禁测试与py_compile/defaultprepared均0，日志 `evidence/client-linux-wire-preflight-pure-green-20261020.log`；这些没有Docker/socket/GUI。fresh v2 plan `data/sandbox-verification/client-linux-desktop-wire-appimage-v2-20261020-preparation/preparation.json`，SHA `06fd5507f6e7b7294901d441ccbd3afadb7dfa018386c30f0b4fc123fba29e6e`，仍硬绑定修复前b253/338a原包，**尚未preflight或GUI**。VM短窗口已明确交Root做只读ABI核，必须按其修复/新原包调度再继续，不能拿当前plan冒称resize已修。

## 匹配PTY修复后的新包与当前prepared边界

Root提交Desktop匹配修复 `1a8f24cb0421a253b4ce720f059c9e800cf6d68d` 后，正常 `build:no-runtime-assets` 与原builder Linux arm64 dir均自然0，未重建Agent/Server。新hostdir输入11文件按生产当时字节保留在 `evidence/client-linux-pty-wire-host-package-20261020/source-inputs`，共享构建依赖随后释放给Server修复owner。正常AppImage context的413个tracked输入来自不可变 `git archive 1a8f24cb`，不是后续live工作树；同原26.8.1 packager源码证实prepackaged分支跳过beforePack，未手改base vendor。原单target正常压缩自然0。

新manifest为 `evidence/client-linux-pty-wire-desktop-package-manifest-20261020.json`；实际asar `eced6754bd2f7f03e6e34ab0be45ff75ee413fa12bbb087af922aa6adf7eb2d6`，ASAR内node-pty JS为1.1.0且公开resize发送3参数，实际native为匹配1.1的 `c192e560428e778842fdbbe72f14032824b03373ed49ad3efcdbcf9eb249b75b`，Agent仍cdf。实际新AppImage SHA `6db2908c285012dfb37dce3336d09df1d28e73f1a06629c85d8100f58389d78a`，原提取后的五核心、公共读执行权限、原metadata均通过。生产与校验收据在 `evidence/client-linux-pty-wire-appimage-production-20261020/`。新consumer仅覆入该AppImage，`uwork-linux-desktop-appimage:20261020-pty-wire-v1`，image ID `sha256:5e0f9b9876f145b764ba851704802aebad407e643f9a18a51d270d81fb5fb0be`。这些仍不代表实际GUI尺寸验收。

本轮独立driver保留原完整业务/25秒协议链，另外以原xterm输入 `stty size`、原shell/tty/cwd与exact owned X window实际改变尺寸并恢复，计划证明真实fit；原协议仅单anchor追加无业务语义的raw `&wireLabel=中文`，强制测试原version-wire分支，原path/xdg-open/确认/第三URI保持。原shared probe/backend/protocol/entry未修改。

matching v1 plan因peer发现Docker inspect任意错误被当作absence而撤回，保留10项纯测试修复证据；matching v2因真实Docker返回小写 `error: no such object: <owned-name>` 被误拒而撤回。两个plan均未preflight/GUI，其exact源快照与superseded-not-run收据保留。后者真实只读回执在 `evidence/client-linux-pty-wire-lowercase-inspect-actual-20261020.json`；旧source新例1RED→最小修复后11/11GREEN，仅规范化recognized error前缀大小写，owned-name仍逐字一致，wrong-name/附加消息/daemon不可达均拒绝，未知不会写absence。fit/derive六项纯测试、六源码compile与实际defaultprepared均0。

首次完成freeze的matching v3 plan为 `data/sandbox-verification/client-linux-desktop-pty-wire-appimage-v3-20261020-preparation/preparation.json`，SHA `337166b851d4334a601884511985b9a0b86d8643263ccba7a965d4494630c6fb`；13个live设施/manifest源冻结。当时仍未执行；后续按独立Root-reviewed preflight自然终态和单独GUI阶段运行，实际结果如下。不把纯测试、提取或已完成的内核PTY对照当作UI fit/完整联动通过。

## matching v3真实运行失败与定向诊断准备

Root分别批准预检和GUI，v3原readonly sha256sum预检自然0，返回实际6db摘要，具名容器自然消失；原文 `preflight.json` 与事后exact-name inspect留在v3 preparation目录。随后原完整GUI自然exit1/78.451秒，原result只完成三个具名检查：原renderer、身份/工作区onboarding恢复、原Host文件预览。File preview后的原`Page.reload`路径中browser-harness调用35秒超时，独立容器内CDP HTTP也exit28/3秒无响应；当时原Main56仍在ps中，真实X窗口6291459标题Error、类型DIALOG、状态MODAL/SKIP_TASKBAR。没有采到该窗口正文或截图，不能把超时推成Main退出，也不能从Error标题推根因。

原 `container.log` 和私有Main filelog均保留；后者53915字节/261行、SHA `bee5ed8943b576bf3b63a054dbd4684e8a2e2301aa756f61d1a93af6f6d44fb7`，第215行确认原reload后重新挂载既有Host，没有uncaught/unhandled/fatal/exception正文，私有crash目录无文件。cgroup首尾OOM事件0、peak1841651712，仅属本例观察。未到达原reload恢复断言、PTY输入/实际UI fit、模型/账本/撤权或raw-wire25秒协议；supplier/账本都是0。原result与extended-result均保持FAILED。

原control shutdown确认后容器自然exit0；精确自有container/network/volume的实际inspect消息均明确不存在。两个已记录host端口63549/63550均errno61拒连、原SSH48623不存在、原BH私有root的PID文件/Unixsocket监听均无且连接拒绝。原proof前后完全一致；controller未被TERM，没有重启或全局清理。证据在 `evidence/client-linux-desktop-pty-wire-appimage-v3-20261020/`，包括 `owner-failed-case-verdict.json`、`closed-resource-exact-inspect.json`、`retained-filelog-verdict.json` 和Root独立失败闭合核验。

为取得实际Error正文，只准备同image/同1a8原包的一次被动诊断，详情 `docs/client-linux-native-error-diagnostic-plan-2026-10-20.md`。原reload之后首次原异常才触发exactMainPID/exe/starttime及唯一同PID Error MODAL/DIALOG XID的几何截图，前后连续核归属，不点击/dismiss/按键/gdb，不恢复CDP或跳过reload。原成功对象/异常identity在诊断超时或保存失败下保持。十项纯设施合同（含编译实际wrapper.raw_cdp的时序/identity）+原11预检/6fit共27GREEN，没有Docker/X/GUI；当时fresh v5 plan SHA `efd78be806af7b4ad59f89394de2bea9ee8ea619b7bda0e3db7ac988f1ca6fd4`，15sources，仅prepared未preflight/GUI。v4内部初次prepare在补实际wrapper合同后撤回，未运行且15源快照留存。

## v5真实fit恢复失败及稳定测量准备

v5随后获两阶段独立Go，预检自然0/absence，GUI自然exit1/22.272秒。原四项检查通过至reload恢复身份/工作区及文件复读，旧Error模态/CDP超时本轮未出现，故被动observer未触发、没有原生Error截图；不因此消除v3未知Error边界。

本轮原Host148实际映射C192 native，same shell286、tty `/dev/pts/0`、cwd `/work/project`不变，真实`stty`由9x71变为8x108，原log的terminal.resize均OK；但新增fit在恢复最初viewport宽462时失败。实际初始/变化DOM宽462/364，原生window1200x800→1020x720→1200x800，失败UI图中恢复后的终端横跨约914px。不能用本次部分真实尺寸变化代替完整fit恢复验收；模型/账本/协议仍未到，supplier与账本0。原container shutdown后自然0，三类exact资源name均不存在，host52635/52636拒连、SSH52591不存在、BH52613不存在且socket无监听；其旧pid文本保留为证据。原result/extended均FAILED，路径 `evidence/client-linux-desktop-pty-wire-appimage-v5-20261020/`。

原TerminalSession先以默认font13 fit、再在真实create异步返回后应用profile字体并scheduleFit，另有ResizeObserver/rAF。旧fit设施只采单次DOM基线；实际封存旧算法在受控先462后924的DOM与同shell输出上真实复现恢复假失败，连续漂移DOM仍会开始native resize，纯合同2RED/2GREEN。该设施RED不是对v5产品根因的证明；原日志仅有resize成功耗时，没有每次cols/rows参数。

最小设施修复保留35秒总budget、每阶段8秒、原窗口动作和所有业务断言：先连续稳定public DOM/font/DPR/container/animation状态0.6秒，再两次原xterm唯一文件stty一致才锁before/after/restored；不复用可能陈旧的同名输出。最终完整viewport签名、rows/cols/PID/TTY/cwd与原生几何均须严格恢复。实际新fit黑盒合同4GREEN，包含连续漂移不resize、异shell拒绝、仅宽恢复但DPR未恢复仍失败；总31纯测试与9源码compile/defaultprepared均0。fresh v6 plan SHA `187334df93d450084d3a52b23878311a38ad63d1369c44e90018dd0239d8cbf3`，16sources，同原包/consumer和被动Errorobserver，freeze时仅prepared；后续实际结果如下。

## v6/v7真实边界与v8可见性合同

v6经独立Go自然exit1/20.252秒，原四项检查含reload复读均通过。连续稳定基线记录了viewport462/container506、stty9x71；原窗口变窄后viewport先364再702、container746、stty8x108；原生窗口恢复1200x800后viewport稳定884/container926、stty9x136。字体/DPR/窗口innerWidth恢复、同shell286/TTY/cwd始终一致，但完整viewport与stty严格恢复失败。这个新观测排除了用“单个初始瞬态”概括全部失败；v6继续FAILED。

原1a8生产合同逐字核准：`WorkspaceShellLayout.tsx`在window resize idle300ms后，conversation宽低于480即自动收起右pane，没有变宽自动重开分支；`useAppPanels`保存collapsed owner偏好。故跨阈值窗口resize会改变内部pane状态，原生window几何恢复不能代表原pane布局恢复。随后经批准仅为fit设置一致布局：原File/reload验收后，真实鼠标点击唯一原`side-pane-toggle`收起按钮，再原UI回焦终端；不销毁tab、不改React/RPC、最终strict仍保留。

v7实际按钮点击已生效，失败UI截图显示文件预览已收起、终端全宽；但设施用预览内层rect宽须为0来判断关闭，8秒未满足而自然FAILED/21.753秒，未开始native resize。原`AnimatedSidePanePanel`注释明确关闭仍保留Browser Guest/tab，使用`lockedContentStyle`保持内层宽，并通过唯一`data-workspace-side-frame`的`aria-hidden`标记显隐。这是可见性观测合同错误，不能把其FAIL归成产品关闭失败或把旧result改绿。

v6/v7原容器均shutdown后自然0，exact三Docker资源name明确不存在；v6端口56157/56158、SSH54791/BH54866，以及v7端口59255/59256、SSH58913/BH58997均已闭合，完整原文在各case `owner-failed-case-verdict.json`。所有旧计划与实际执行源SHA快照保留。

fresh v8只修可见性设施：关闭必须是唯一fresh-hit-tested原展开按钮，以及exact唯一side-frame `aria-hidden=true`；false/unknown/multiple均拒绝。预览内层rect仅作为诊断，不再把保留宽度当成可见pane。新增Node VM直接运行实际JS表达式；封存v7真实表达式在保留413.8宽的隐藏pane/隐藏旧按钮场景RED，新表达式及实际fit共7合同GREEN，总34纯/9源码compile/defaultprepared均0。原35/8预算、两次同shell稳定测量、完整strict恢复和全部业务/25秒协议不变。

当前v8 plan SHA `a939ddc225155f810d22c3c9fdb99658bad8f99cdff2c8b78cfffb6f1a96c3fc`，16sources，同原1a8包/consumer。按Root授权自主执行的named readonly预检自然0/actual6db/owned absence，receipt在其preparation目录。该时点尚未GUI；随后获独立Go，实际最终结果如下。

## v8最终真实结果与关闭范围

Root审完冻结16源和实际JS投影合同后另行批准一次GUI。原controller自然exit0、52.867秒；`evidence/client-linux-desktop-pty-wire-appimage-v8-20261020/result.json`原11项全部PASS，`extended-result.json`也PASS。实际原AppImage6db/asar eced/JS1.1/C192/cdf与封存1a8来源一致，五核心在运行目录逐字回读；没有把后来Server源HEAD标成该包来源。

原File preview、reload身份/工作区恢复和文件复读通过；原UI关闭已验预览pane、回焦终端后，实际fit在8.033秒内完成。原Main56后代Host150真实映射C192；同shell287、`/dev/pts/0`、cwd `/work/project`保持，真实`stty`为9x136→8x108→9x136，原生窗口1200x800→1020x720→1200x800，完整viewport签名、client/container/font/DPR状态和五字段shell proof严格恢复相等。原终端隐藏/重开仍保留同一活PTY。展开label+exact frameHidden=true的实际关闭证据同时记录了保留的previewWidth416，支持按原可见性合同测量，没有销毁隐藏实例。

正常包内CLI205通过原生产spawn参数+实际exe/cwd归属，backend/Main/Host/Agent/PTY共12个实际进程身份均UID/GID1000。原受控模型2次supplier请求、2笔settled账44Credit；撤席位后的原发送被拒，supplier/账本不增。随后原系统xdg-open入口与GTK确认实际通过：raw附加`&wireLabel=中文`的原URI输入，取消卡持25.105秒、8秒后的第三未知URI自然0、期间仅原Main56存活；取消保project，确认切到`protocol space 测试`，两次主URI launcher也自然0，最终模型/账本保持原2/2/44。此处实际观察到的是raw Unicode系统URI输入及原用户可见结果；version-wire分支按冻结factory规则和该输入推导，未抓取生产C++ additionalData序列化payload，不把推导冒充传输抓包。

原control shutdown确认后容器自然exit0，proof与最终后台proof完全一致。owner再次实际inspect三个精确container/network/volume name，均是明确不存在消息；host62640/62641均errno61拒连、原SSH61816/BH61866不存在，原BH socket无监听且拒连，旧pid文本仅作证据保留。`owner-verdict.json`包含精确关闭原文、16源前后稳定和范围。没有自动开始下一case，没有TERM controller或全局清理；已明确释放本轮GUI/VM。

Root随后逐证独核20项全部true，独立结论为 `evidence/client-linux-desktop-pty-wire-appimage-v8-20261020/root-independent-verdict.json`。其范围覆盖原11项与extended结果、实际AppImage/image与五核心、原Main后代C192映射、同shell真实136→108→136与完整viewport/原生几何严格恢复、原UI关闭保留DOM、2笔settled44及撤权/协议零增量、全部已记录进程UID/GID1000、25.105秒确认/唯一Main/并行ACK、raw Unicode实际派生输入及自然shutdown；又独立核实当前tunnel不存在、两个allocated host端口拒连、exact container不存在、原BH root无open files。此20项是对本例证据的独立审计，不增加为20个新的GUI业务场景。Root之后正常停止本轮VM并恢复原Stopped状态；本agent未另启VM或GUI。

本次关闭的是这一冻结1a8 AppImage在自有LinuxVM中普通UID、extract-and-run的具名完整链和真实UI fit。它不代替真实FUSE、物理Linux、最新四格式安装复测、Windows/macOS或sandbox正例；原fixture使用原nosandbox启动参数。v3原生Error/CDP超时没有在后续轮次复现，正文和原因仍未知，不能因为v8成功就宣称其已定位修复。真实企微浏览器、remote provider runtime、外部MCP和网盘排除不变。
