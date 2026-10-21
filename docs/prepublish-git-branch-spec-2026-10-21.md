# 原本地分支与覆盖保护

独立PREPUBLISH_GIT_BRANCH=1从原项目Composer底部分支入口操作，不创建聊天任务或调用模型。私有仓库局部虚构author，无remote；main提交conflict.txt=A/keep.txt，owned-target提交conflict.txt=T及target-only.txt；回main为初始状态。所有分支写操作只经原Input/Host Git service，Git CLI仅作前置和只读证据。

普通case：原创建框空名禁用，invalid branch原提交显示错误且refs/HEAD/文件不变，原取消不变；重新原创建codex/owned-branch，应在当前main HEAD创建并切换，无新commit/文件改动。选择当前分支为no-op；原搜索不存在分支显示空结果且不变，重新搜索owned-target并原选择，HEAD/文件/原label都正确切换到target，reload保持，不重放。

PREPUBLISH_GIT_BRANCH_BLOCKED=1仅补原保护消费者：main下conflict.txt有LOCAL改动，另有unrelated.txt未跟踪；切owned-target应真正由Git拒绝覆盖，原警告仅列conflict.txt且“受影响文件”数量为1，所有文件/HEAD/index/refs不变。原取消不变。重新操作后原“提交并切换”应进入当前main的提交预览（当前全部2项更改），原手写消息确认后先commit当前两文件，再切target；main保留LOCAL/unrelated的commit，target保持原T/target-only、无新commit，worktree clean、无stash。最终reload/完整账本/模型请求不变。

两case当前成员模型/ledger新增均0，另一成员完整两行保持，不把普通对话前置当成必需。原Node/SQLite、未打包Main/Host/UI/CLI、Git仓和原页面真实参与；正常source snapshot逐hash校验，原finally不变，PID/4端口/私有根/BH闭合。外部MCP、网盘、企微/远程和发布后多系统客户端不参与。

PREPUBLISH_GIT_BRANCH_UNTRACKED=1须同时BLOCKED=1，仅运行未跟踪覆盖case：当前main中target-only.txt为LOCAL_UNTRACKED，目标分支同名文件为TARGET_ONLY，另有unrelated未跟踪。警告应使用未跟踪描述、只列target-only.txt/1；原取消保持，确认提交两文件到main后切target，main仍有LOCAL_UNTRACKED/unrelated且conflict.txt为A，target仍为原T/TARGET_ONLY。无模型/账本增量；不重复普通创建或tracked覆盖case。
