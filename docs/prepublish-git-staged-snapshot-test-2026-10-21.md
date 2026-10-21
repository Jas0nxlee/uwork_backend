# 同一文件的原暂存快照提交

[v60](../evidence/client-native-prepublish-v60-20261021/result.json)独立6原动作通过。私有仓库HEAD为A，staged.txt暂存B后工作文件再改C，另有未暂存文件和新文件。原状态面板→Git弹窗→不包括未暂存→原手写消息→原提交，实际HEAD仅新增一个staged.txt=B的commit；当前工作文件仍为C，index与新HEAD B一致。所有工作文件hash和初始working diff逐字保持，其他两文件未被提交/清理。

原renderer reload后真实HEAD/count/index/worktree/完整请求/账本/任务索引保持。未运行此前AI生成/取消/提交剩余文件路径；当前成员只有必要的普通任务+自然标题前置2笔settled/44Credit，生成次数0，另一成员两行完整账本保持。此结果验证了原stagedOnly在同一文件两个版本下确实使用暂存快照，不从只提交不同文件的结果外推。

[独立复核](../evidence/prepublish-continuation-20261021/git-staged-snapshot-final-verification.json)重新计算C文件hash、检查HEAD B与index/working diff，并核对全部自有Main66826/Host/CLI/fixture PID不存在、4端口拒连、私有根移除、cleanup.errors空、fixtureExit0、browser-harness关闭，原finally AST不变。新执行源码/hash保留，当前11条DOM读表达式预检通过；无产品代码变化或新增构建，不重复旧套件。

证据：[初始A/B/C状态](../evidence/client-native-prepublish-v60-20261021/git-initial-repo.json)、[原提交B且保留C](../evidence/client-native-prepublish-v60-20261021/git-staged-committed-repo.json)、[刷新最终快照](../evidence/client-native-prepublish-v60-20261021/git-snapshot-reloaded-repo.json)。整体目标active，后续继续未覆盖原消费者，外部MCP/网盘、远程/企微未验证路径和发布后多系统客户端不参与。
