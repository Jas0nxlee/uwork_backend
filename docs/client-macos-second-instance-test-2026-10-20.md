# macOS 原生外部工作区确认与第二入口

状态：**新 v7 正常原包的有限 Native 切片4/4 PASS：中文空格 baseline、原 NSAlert 25.414秒与第三并发URI、取消、确认切目录，计量无增量且资源闭合**。旧 v6 与 v7 v1/v3/v4 失败分别保留；v2未运行。这里只关闭下文具名 Mac 二实例切片，不外推全部平台、全局 scheme 或冷启动。

原 fixture 自然 exit0，cleanup errors 为空、服务器关闭、BH daemon/socket 关闭、所有已知 PID 消失、四端口拒连、原 protocol-only guard 恢复协议关联且未使用系统剪贴板，14.387 秒。没有进行 AXPress/URI launcher，计量保持 fixture 自身 baseline 两调用/其他成员44Credit、本人成员0账本。

## 冻结输入与准备验证

- 正常原 Mac v6：asar `cda1511098c4768c7b0a5cea9f36aa344f7ab43319bdee254a8f8fa78d8253ea`，Agent `cdf781ecf004b9639157fae25e6e96e558b95faefaee7aab09488d5dc650ecac`；原 manifest `evidence/client-macos-package-v6-manifest-20261020.json`。正常 producer 与原 `loadOwnedPackagedRuntime` 严格 codesign/核心 SHA 验证通过，没有修改 app/cache/out。
- 本轮计划：`data/sandbox-verification/client-native-macos-confirmation-prepared-v3-20261020/preparation.json`；SHA256 `cf078ecbd6321d82e41442db02584ee4ab1bda114c23854186843c4934d0149f`。计划绑定全部新增源/driver、受控原 helper 与 compiled fixture SHA，源漂移拒绝执行。
- `macos-confirmation-prepare.mjs` 对共享 fixture 只读取并在派生完成后逐字节核验未变；只新增有限 URI op、原同环境进程 launcher、close 前 owned 子进程释放。业务实现、原 Main/helper 不改。
- 独立 launcher 合同初始缺模块 RED 与最终 3/3 GREEN 已保存。只证明 role/目录/Main 归属、重复调用、固定 URI 等测试设施 guard，不是产品缺陷 RED 或 OS 通过。
- Python 编译、Node 语法和默认 `prepare-only` 校验通过；这几个步骤都没有运行 app/后端/原生 guard/AX/BH。

## 尚待实际运行的最小验收

1. 原 signed app、原 fixture 身份及自有 `project 基线` 的真实 CLI 第二入口就绪；只读 UI 与原 setting active workspace 一致。
2. exact executable argv 的外部 URI 触发真正 `second-instance` 和原 NSAlert。第二进程自然 exit0，对话框保持至少25秒；第八秒常量未知 URI 第三进程也自然 exit0，始终原 Main 同 PID/birth。
3. exact owned PID/原 sheet/frame 的“取消” AXPress 后保持 baseline project，模型 supplier 与 ledger 无新增。
4. 再次原 URI → exact 原“打开文件夹” AXPress，才切到本轮 `确认 中文 空格` 目录；原 Main 不换代、计量无新增。
5. 原 shutdown、有限副进程/完整 owned 子树/PID、四端口、BH 与原 protocol-only guard 关闭。原 handler 不变或仅回滚本预览包影响；不操作系统剪贴板、全局键鼠、个人 Chrome 或企微。

执行须等待主联动明确资源释放，并使用 Root 已审计划的 exact hash。若已有 handler 无法保存/恢复、AX权限不足、不能唯一绑定原 dialog、Main 换代或 launcher timeout，保存真实失败并停止；不改默认 handler、mock 响应或通过业务 RPC 求绿。

## 本轮失败与离线定位

原 Main98507 在 20:10:00.386 记录 Chromium `process_singleton_posix.cc:779` 的 `additional_data_size exceeds payload length`。原 fixture 的 `openWorkspace` 使用 exact 原 executable、`[--open-workspace, ownedPath]` 和同一个 `nativeEnvironment()` 工厂；派生 URI helper 尚未调用。副实例在原十秒边界内未自然完成被判失败，未延长等待或更换入口求绿。原运行未保存该 baseline 副实例的完整事件，不能补造其 exit/signal/argv 观测。

当前原包 Framework Info.plist 与实际 Node 模式均是 Electron41.10.7。官方该 tag 固定 Chromium146.0.7680.216，原 parser 仍采用 NUL 分段和 `TRIM_WHITESPACE`，再按声明长度校验 additionalData。官方 [Electron #52025 修复说明](https://github.com/electron/electron/pull/52025) 指出此分段 trim 会破坏 V8 字节流；变更为保留 whitespace。原 tag/patch/Chromium 文本与 SHA 保留在 `evidence/client-macos-singleton-source-20261020`。

Root 允许后，只读原 RunAsNode fuse 确认 ENABLE49，未翻转 fuse；exact 原 exe 的现有 Node 模式运行真实生产 `createDeepLinkSingleInstanceData` 和实际 runtime V8 serialize，没有导入 Electron app、启动 GUI、注册协议或申请单实例锁。其 Electron41.10.7/Node24.18.0/V8 14.6.202.34-electron.0 纯合同结果：失败路径的 additionalData 声明232字节，按锁定的原 native framing 算法重放后只剩231字节；ASCII、中文无空格、已编码 URI 的对照完整。官方 KEEP 对照保留全部232字节，见 `electron-runtime-contract-red.log`。这是同 runtime 真实序列化与原 native 算法重放，**不是再次直接运行 C++ singleton parser 的证据**。

Root 已授权最小无状态兼容修复：原 `desktopDeepLinkUrl` 工厂保留两个字段，安全可打印ASCII保留逻辑原值并无损重新分配OneByte，维持旧receiver的正常space/percent入口；非ASCII、NUL/控制和wire命名空间冲突值才用版本前缀与percent编码。原提取器仅对已知版本解码一次，兼容旧raw对象，坏/未知编码拒绝后仍按原argv fallback与安全确认处理。没有删除additionalData、关闭单实例、升级整个Electron、改签名包或将可信入口冒作URI正例。

新永久wire测试在旧源码取得4RED/3GREEN；Root新增旧receiver ASCII兼容约束又取得2RED，peer发现内容为ASCII但V8保留SlicedTwoByte表示，再以wide slice/全角空白trim取得2RED。上述历史日志不改写。最终14项使用真实生产工厂→V8 serialize→原native framing replay→V8 deserialize→原extractor闭环；wire14+原dispatch6+fallback2共22/22，外部确认19+原ready10+fallbackintegration1共30/30通过、0skip。组合fixture额外使用中文query，确保不是ASCII直通而是真正wire URI仍等待原确认；取消0stat/0IPC，UNC在原确认前拒绝，NUL在原确认后仍不stat/不IPC，未扩张NUL时序声明。

同一原Electron41.10.7 Node模式的只读旧source snapshot控制显示较长实际路径的wide slice/Unicode外壳trim各238→237字节RED；新OneByte工厂各131→131、故障中文空格wire173→173，六对照均GREEN。不同V8可能把较短wide slice压回OneByte，所以不把一个短字符串代表所有内部表示。这些仍是V8/native算法重放，不是新包C++ singleton/NSAlert已验。

局部原oxfmt/format-check和架构前后检查0新违规。Root首轮广type/architecture通过但lint如实失败：原confirmation组合文件因新增断言超过400有效行。已把共用编译/VM/fixture真拆至同目录 `.fixture.mjs`（177行），测试文件297行，保留19项与全部原断言，未加disable/改阈值。Root统一对最后小改复核type/lint/architecture，不并发重复。代码冻结后等待最终peer、Root提交和正常Mac新producer；不重建cdf/Server、不覆盖缓存v6。Linux具名通过不外推到本次NSAlert；25秒确认、取消/确认、第三并发URI、macOS无父窗口冷启动和系统全局scheme分发仍未完成。

## v7 正常产包与第一次真实复测

Root 最终 typecheck/lint/architecture 均0（114 warnings/0 errors），并提交 wire 五文件为 `1bd1ec7b`。正常 v7 producer 沿原 `build:no-runtime-assets` 与 electron-builder `--mac --arm64 --dir --publish never` 产出，未重建 Agent/Server，原严格 codesign0；五个 runtime 文件均已核 SHA，原九项 fuse 与缓存 v6 相同、v6 五文件未变。记录见 `evidence/client-macos-wire-package-v7-20261020/result.json`、`immutable-input-verdict.json` 和 `evidence/client-macos-package-v7-manifest-20261020.json`。新 asar `2937a7ad223a9867e4bcf699e4074a39bad0ddcaa607bc296e3ff950f982a2e9`，Agent 保持 `cdf781ecf004b9639157fae25e6e96e558b95faefaee7aab09488d5dc650ecac`。

Root 独核 fresh plan SHA `1be623be2a02d630bf110ff062005cc1c2fa29f68702efa6a20e0a4707232dcf` 后授权独占 Mac GUI。`evidence/client-native-macos-confirmation-wire-v7-v1-20261020/result.json` 如实保留 21.207 秒 FAILED：原 Main10971、原真实 CLI 第二入口已把 `project 基线` 打开，原 UI 与持久化 activeWorkspace 一致，未再次出现旧 `additional_data_size exceeds payload length`。随后 exact 原 exe 接收外部 URI 的 cancel 副进程11129自然 exit0、无 signal/timeout，原 Main 仍归属；原 driver 在10秒内没有匹配到符合全部约束的原生 sheet，所以未执行 AXPress、25秒等待、第三 URI 或确认切目录。

当前结果不能区分“原生确认没有出现”与“确认存在但 AX 投影不符合 driver 的既有匹配条件”：原 driver 只保存匹配成功的 AX 信息，未保存未匹配树；Main 的 `showMessageBox` 开始时也没有日志。这是明确证据缺口，不据此修改产品或放宽原按钮/目录/PID/frame guard。后续仅考虑一次有界 owned AX 只读诊断，仍须新 fresh plan 的 Root 独审；旧失败不可覆盖。

v7 失败后原 fixture exit0、已知 owned PID 全不存在、四端口拒连、BH socket/daemon 关闭、原 protocol handler 恢复、系统剪贴板不变、cleanupErrors 为空。模型计量从 baseline 到 final 均为 supplier 两调用、其他成员两笔44Credit、本人成员0账本。此只证明本轮无增量和资源闭环，未把未执行的原生确认步骤计入通过。

## v3 有界 AX 诊断与设施纠正

v2 准备计划未运行，先撤回，改为 first+latest 两槽诊断的 v3（SHA `366b8e4eed7ecf4f421dad844b1cbeffd86458e65afef23e39fc623845290125`）经 Root 与 peer 双审后运行。`evidence/client-native-macos-confirmation-wire-v7-v3-20261020/result.json` 保留17.762秒 FAILED，原 baseline 再次成功，URI 副进程13345自然 exit0，无超时。原 Main13209 的原 `AXSheets` 属性返回空，但最新16.501秒投影在 `AXStandardWindow` 的 depth1 `AXChildren` 明确发现真正 `AXSheet`，frame为 `(626,280,260,305)`，有完整原中文问题、自有中文空格目标和两枚 enabled/AXPress 原按钮。原 driver 仅枚举属性或把顶层窗口作候选，因而漏掉该子 sheet；这是测试设施缺口，不能归为产品 NSAlert 未出现。

Root 认可后仅对独立 driver 的候选发现做 TDD：原相同行为提取至纯函数，四设施用例先2RED/2GREEN（子 sheet 未发现、重复引用未去重），再最小修复到4/4。每个原生候选另行 bounded collect，不能用标准窗口树混合不同 sheet 的目标与按钮；原唯一匹配/PID/birth/exe/frame/按钮/AXPress/清理合同不变。日志为 `evidence/client-macos-confirmation-candidates-{red,green}-20261020.log`。v3原执行源已按其plan SHA保存为该目录 `reviewed-probe-source.py`，便于后续区分诊断设施与产品变更。

v3原fixture0，全部owned PID消失、四端口拒连、BH关闭、协议恢复、clipboard unchanged、cleanup[]，计量不变。Root 对14项原证据的独立复核记录在同目录 `root-diagnostic-verdict.json`。25秒/第三URI/取消/确认尚未执行。下一轮只使用同一immutable v7原包和新的fresh plan，待Root/peer独审后运行；不改产品包或放宽安全确认。

## v4 原生候选已匹配，进程 census 设施仍需纠正

v4 经 Root/peer 独审后执行，原子 sheet 已匹配，URI cancel 副进程15922自然exit0/Main15798仍原代；但进入 hold 的第一次 census 即失败，原结果9.162秒 FAILED，未完成25秒、第三URI或AXPress。该旧 census 使用 `lsof -t <executable>` 的全部文件打开者，再凭 `ps` 中不含 `--type=` 或 CLI 路径认作 Main；它没有持久化候选 PID/分类，所以不能证明此次有真实第二 Main。

只读原源码及 macOS lsof 合同确认：前述查询包含仅打开可执行文件的普通读取者，并不限于可执行映射；原 Main/Host/renderer 还会设置 `process.title`，不能按 `ps` 字符串恢复角色。已保留 v4 byte-exact `reviewed-probe-source.py`（SHA `4635afaceb1fa51e1d5d3dfdfc5eda818e6ea57e67f54a0dac39b05024c094f0`）。离线取其真实 closure AST，用实际运行中的自有 Python 映射与自有 Node 只读打开同一文件，旧 census 确实把 reader 混入并 RED；按每候选原 `lsof -a -p PID -d txt -Fn` 精确路径核映射后仅保留 Python 本身、reader 自然关闭，GREEN。见 `client-macos-confirmation-census-real-mapped-red-20261020.log` / `...real-green-20261020.log`；这是设施合同，不据此给 v4 缺失的候选身份补造根因。

新 census 保留全部 opener 的 PID/PPID/birth/command/txt 原投影及排除理由到 first+latest 两槽；额外真实 exact txt 映射始终 unresolved 并失败，不按 title 或父子关系自动豁免。纯设施永久用例补实际只读 FD/lsof、未知映射不能被伪 CLI title 排除、exact path 与空投影边界，原候选四例加三例共7/7。初始离线合同脚本 import 路径及 Python launcher 与实际 app binary 不一致的设施失败另留日志，修正的是诊断输入，没有改 product 或 OS 时钟。v4 所有资源已关闭、计量不变；下一 fresh 运行仍须 Root/peer 核计划。

## v5 最终原 Native 验收

Root/peer 双审 fresh plan SHA `144ac07368f3ef28845396f8f64d5d298d91232a3f2910b95b217dae9cd1caa3` 后，原有限 driver 在35.727秒完成4/4 PASS。原始结果与计量在 `evidence/client-native-macos-confirmation-wire-v7-v5-20261020/result.json`，owner逐项独核13项在 `owner-verdict.json`，Root独核22项及实际PID/端口复验在 `root-independent-verdict.json`，全部 opener first/latest投影在 `executable-census.json`。执行使用前文同一正常v7 asar2937/cdf原签名包，产品、原Main/确认队列、共享fixture和fuse均未改变。

原 Main19927 的自有 baseline 中文空格项目由真实可信 CLI 第二入口打开，原 UI 与 setting activeWorkspace 一致。外部 URI 副进程20145自然exit0后，原 `AXSheet` 保持25.414秒；27个实际采样中真exact executable txt映射始终仅原Main19927，原窗口/目标/frame不变、原baseline保持。第8秒发起第三未知 URI 副进程20554，也在确认未决时自然exit0；没有10秒超时或替换Main。

仅对该PID/frame的原“取消”执行AXPress后，UI及持久化仍为 `project 基线`。随后原URI副进程21358自然exit0，再对同样严格匹配的原“打开文件夹”执行AXPress，UI及持久化才切为本轮 `确认 中文 空格`。三个副进程均无signal/timedOut且各自记录原Main仍归属。计量从baseline到final完全相等：supplier2调用、其他成员2笔44Credit、本人成员0账本，确认链本身无模型增量。

全部文件打开者均有原投影和分类，另PID19969没有exact Main可执行文件的txt映射，因此明确记为 `not-exact-executable-txt`；没有按title豁免真实未知执行者，也不据此反推历史v4未记录的候选。原fixture自然exit0，所有已知owned PID消失、四端口拒连、BHdaemon/socket关闭、原协议关联恢复、系统clipboard unchanged、cleanupErrors为空。Mac GUI窗口已明确释放。

此验收不包含无父窗口冷启动NSAlert、系统全局scheme分发、v7全部前端链重跑、Windows/Linux当前wire原包、受阻企微OAuth或remote provider runtime。Mac v6原完整前端联动仍是独立证据；新Linux正常原包回归另排，不把旧Linux包外推成当前wire修复已验。
