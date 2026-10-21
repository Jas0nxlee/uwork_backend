# macOS 原包第二入口与外部工作区确认

状态：v7 fresh v5 已实际完成下列有限 Native 四项（原sheet25.414秒、第三URI、取消、确认），完整记录见同名test报告；v6及v7 v1/v3/v4历史失败保留。Linux或纯设施测试不代替本次Mac原入口证据。

## 范围与所有者

使用当轮 Root 独核 manifest 冻结的正常签名应用；当前为 `client-macos-package-v7-manifest-20261020.json`。不读写既有 producer out/cache，不解包改写 asar，不更改原 Main/helper。通过原 `loadOwnedPackagedRuntime` 做 manifest 路径、四核心 SHA 与严格 codesign 校验，另外保留 manifest 的原 pty SHA。

每轮使用全新 `client-native-macos-confirmation-<fresh>` profile、原 backend fixture/隔离身份和独立 CDP/BH。Main/Host 仍由原包启动；根内中文空格目录只属于本轮，不使用用户文件。supplier 与 ledger 以本轮完成引导后的基线比较，整个确认过程要求零增量；不创建模型任务。

原 packaged Main 会调用 `setAsDefaultProtocolClient`，所以仅使用 exact binary 仍不能假定全局关联不变。启动前必须由既有 `native-os-state-guard --protocol-only` 在进程内保存原 scheme handler；其原 guard 只回滚本预览包造成的关联变化，不覆盖期间第三应用选择，并使用独有 pasteboard、不读写系统剪贴板。若原 handler 不存在或不能证明可恢复，则停止；不额外注册/改默认 handler。这里不声称验收全局 URL scheme 分发。

## 最小真实入口

首选原 `Contents/MacOS/UWork Preview` 作为真实第二 OS 进程，继承**同一测试 fixture 内生成的 private nativeEnvironment**，argv 为 `zcode://workspace/open?path=<encodeURIComponent(ownedPath)>`。原 Electron 单实例锁/additionalData/`second-instance` 路径负责交付，不发业务 RPC，不用 handler 转发，不恢复或记录真实凭据。

不用 `open -a` 的默认复用语义赌 argv 是否被传递，也不用不限定 app 的 `open zcode://…`。如之后单列 `open-url`，只能在 Root 另行核定 exact owned app 及协议状态恢复边界后测试；此轮真实 second-instance 足以验证原 ACK/NSAlert 合同。

现有 fixture 的 `openWorkspace` 是可信 `--open-workspace` 入口，不能拿它冒充外部 URI 的安全确认。它只可用于建立自有 baseline project。独立派生 fixture 新增有限 URI launcher：只接受本轮固定候选目录和一个常量未知 URI；spawn 原 executable，记录每个子进程自然退出/原 Main PID/birth，十秒期限只杀本轮副实例且判失败，不能杀原 Main 求绿。原共享 fixture 保持不变。

## 原生对话框与断言

所有确认/取消只允许复用 `macos-ax-driver.py`，从 `AXUIElementCreateApplication(exactMainPid)` 枚举，限定本轮窗口/NSAlert sheet/frame、原文案与自有目录内容。动作前重验 Main 的原 executable 映射、进程 birth、唯一原按钮和相同 frame，再对该元素 `AXPress`；不得发送全局键鼠、系统级 blind click 或操作个人 Chrome。若 AX 无权限、出现系统同意流程或无法唯一定位，保存有限失败并停止，不弹出权限请求。

原 v7 真实投影发现 `AXSheets=[]`，但窗口 `AXChildren` 中存在真正的 `AXSheet`。设施必须从 exact owned PID 的窗口及 sheet 属性引用，按既有12层/400节点上限收集子树，发现原生容器并按同一 AX ref 去重；每个候选容器另行收集自己的子树再核文案/目标/按钮，禁止将整个标准窗口中其他 sheet 的文字或按钮拼成一个允许候选。标准窗口自身仍不是原生确认候选，唯一候选及全部动作 guard 不变。首次及最后一次未匹配投影最多保留两树，失败也须清理。纯设施用例先在旧枚举行为取得2RED/2GREEN，再验证子 sheet 发现、属性/子树去重、各候选隔离及旧顶层原生对话框合同；这些不计作产品 Native 通过。

1. 原引导后用可信实际第二入口建立 owned baseline project，保存实际 workspace path/identity、原 Main PID/birth、窗口和 supplier/ledger 基线。
2. 真实外部 URI 第二进程进入原 NSAlert；它应自然 exit 0，原 Main 不换代。对话框保持至少 25 秒。第八秒再发常量未知 URI 第三进程，它须在确认未决期间自然 exit 0。等待中持续记录同一 Main、没有额外 Main/Host、原项目未改变、模型/账本零增量。
3. 仅 exact 原“取消”按钮 AXPress。原 Main 仍同一，原 project/path/identity 保持，无候选目录投递。
4. 再发同一自有中文空格目标 URI，待原 dialog 重新出现，AXPress 原“打开文件夹”。确认后才观察原 UI/持久选择切到目标；源 URI/真实窗口/同 Main/账本无增量均绑定记录。不通过业务 RPC 代替打开。
5. 走原 fixture shutdown，证明原 Main/Host/owned child/端口/BH/tunnel全部关闭；原协议 handler 未改变或由 guard 恢复。保留原失败、原始 OS 关联恢复结果，不改写为全平台通过。

## 准备产物与尚待运行

`scripts/tests/macos-confirmation-prepare.mjs` 核原 manifest/codesign，记录受控源 SHA，并以三个唯一精确边界派生原 fixture：有限 URI op、私有同环境 launcher、close 前释放本轮副实例。源 fixture 字节核验不变；不启动 app/后端/guard/AX/BH。`macos-confirmation-probe.py` 默认只校验准备状态；执行必须显式 `--run --reviewed-plan-sha256 <exact-plan-hash>`，且先经 Root 独审/独占 Mac 窗口调度。全部新增源/driver SHA 和 compiled fixture SHA 都绑定计划，漂移拒绝运行。

有限 launcher 的永久 guard 自检为 `scripts/fixtures/native-macos-secondary-uri.test.mjs`：拒绝任意 role/重复 role、异步校验前保留一次性 role、拒绝失效 Main/非自有目录、固定第三未知 URI，不接收任意 URL/可执行命令。初始缺模块 RED 与最终 3/3 GREEN 分别保留在 `evidence/client-macos-confirmation-fixture-red-20261020.log`、`client-macos-confirmation-fixture-green-20261020.log`，只是测试设施合同，不是产品 RED 或 Native 验收。

本规格有限四项已由正常v7原包实际通过，证据为 `evidence/client-native-macos-confirmation-wire-v7-v5-20261020/result.json`。无父窗口冷启动、系统全局scheme分发和其他平台当前wire包不在本次通过范围。没有改共享 fixture、原 Main/helper 或产品。
