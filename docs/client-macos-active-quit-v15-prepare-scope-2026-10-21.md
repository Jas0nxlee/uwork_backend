# Mac 原活动 Quit：v15 / fresh v7 准备边界

复用原 `client-macos-active-quit-consistency-scope-2026-10-21.md` 的菜单、确认、权限与账务规则。本次只准备，不启动 App/后台/AX。候选仅正常 ARM64 v15、commit `500914dfe27f96d9db74381c6828244390413281`、严格 manifest `3cbde851c06c5975b1620e8443942dcf648fed4fe111b4f71b4efdb3ec90d93c`。旧 v4 的54源、计划及此前 FAILED保持不变，不把旧包改名成v15。

当前原 CoreGraphics 三个 typed 字段仅证明 onConsole/loginDone 为true，screenLocked缺失/null。它既不证明仍锁屏，也不证明已解锁/可前置；原 exact PID/birth/executable 与 Accessibility guard必须在fresh运行验证。原AXFrontmost单次set、同5秒期限只读回读及原菜单Quit→Cancel→Quit→Allow全保留。任何原守卫失败就停止，不使用NSRunningApplication、全局按键、后台app.quit/RPC、改DOM、绕权限或模拟确认。

新入口只纯调用原active-Quit derive，替换旧v12 loader为严格v15，并复用已review的packagedMain-only块读取实际signed ASAR Main，避免复制无关开发out。原1c副实例/stdio ignore/10秒、renderer30、供应商hold45秒、两次菜单及正数会话确认、产品9秒Host退出屏障均不改。后端仍真实隔离，原current2/44暖基线→同任务主请求1条真实在途reservation；取消两次只读样本不变；允许后同一条uncertain/amount=reserved、tokens0/0、CANCELLED Trace，旧current和other完整行不变。测试方不得先发TERM/KILL帮助原Quit通过。

仅新variant修两处测试设施前提：原完整Clock命名空间未注入后段日志摘要使用的hashlib，新namespace显式绑定；原v4局部时间检查没有统一实际Fixture/Bridge/onboarding/OSguard阻塞接口，本次复用已实际验证的MemoryCaseBudget180/160/20，原case_deadline绑定同一case_end，每个quit_budget_left同时服从该phase budget。raw subprocess/select、Fixture/Bridge/OSguard实际回调前后按剩余clamp，finally只切到原总期限的20秒收尾；不另起计时器，不延原局部门槛。任何本地或全局余量不足即失败，最终passed前再次核work期限。不能倒称旧v4已有此全局保证。

纯合同必须执行真实namespace/后段hash路径、旧未clamp慢返回与新clamp拒绝、实际原Fixture构造env和两层Popen重定向、新完整派生编译以及原AX10与原held/accounting tests；import及default prepare绝不加载实际AX或启动后台。冻结所有实际依赖、当前3key安全事实、原54与v15产品76pin、包管理器锁；Root/peer exactSHA通过后才允许一次真实执行。这里没有预先声称前台条件满足或活动Quit验收通过。

## v5 未运行 No-Go 与独立收尾修正

v5 的206源/计划/编译产物已按exactSHA完整归档，未启动App。fresh peer实际执行旧finally AST确认：case180耗尽时，预算绑定的原child.wait抛AssertionError，旧finally仅捕获TimeoutExpired，因而跳过OSguard恢复和result。不能把此前prepare/pure通过称作收尾已满足。

v6只在新variant把actual run唯一外层finally换成纯`native-safe-cleanup.py`的原owned资源收口：先尝试原Swift OSguard.close；余量耗尽则只关闭该原Popen stdin，原Swift文件末尾EOF会调用finish，此处只记attempt/unverified，不冒称restored。census/stopNative/BH/fixture每步独立捕获含budget错误，不让首错跳过后继；结果在无条件finally尝试落盘。无法写入磁盘时仅保失败类型和有界stderr，不保证物理文件成功或覆盖原业务错误。所有恢复/关闭失败和未知process/port都导致FAILED，不把未知当closed。原单一180/160/20期限不变，不添等待窗口或业务动作；新helper可供同一原Native控制器的另一个新夹具复用，旧M/54/76pin均不变。

真实派生finally AST的纯合同覆盖：work160留20时先restore并正常收口；case180耗尽时EOF尝试、后继清理不被跳过且失败result存在；census/stop首错仍执行BH/fixture并落失败。全部process、socket和持久库行为在此合同为受控fake，不查询真实个人进程，不启动App。

## v6 真实菜单收据与 fresh v7 仅失败位置诊断

v6 已实际完成真实held main的5项前置；Main 97942的AXFrontmost原本true、无需激活，原菜单“退出 UWork 联动验证”AXPress返回0。随后cancel helper内空AssertionError，未留正常cancel收据；没有足够traceback/候选树判定具体assert或是否已有AXPress后检查失败。不能再归类为旧foreground限制，也不接受Cancel/Allow成功。最后finally的stopNative/Host cleanup与uncertain账目不能充作原Allow证据。原209源/计划/编译产物/实际FAILED已完整保存。

v7只在实际外层失败catch原failure赋值之后，记录最多32个traceback帧的项目相对文件名、函数名、行号，以及异常类型；不读取/序列化locals、参数、环境、source line或异常正文，项目外路径显示固定label。独立0600/O_EXCL文件上限16KiB；无法记录只保unavailable元数据和有界异常类型，外层隔离observer错误，原业务失败、cleanup/result不被替换。实际catch AST抛受控错误验证诊断落盘，实际safe finally仍执行；observer写入故障也不能跳过结果。before-catch整个业务AST与v6逐项相等，原AX/menu/cancel/阈值完全不变。Root/peer审exact新计划后才可一次fresh执行，不重试旧case、不新增激活或绕过守卫。
