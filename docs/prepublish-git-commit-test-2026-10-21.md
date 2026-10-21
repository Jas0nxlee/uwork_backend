# 原Git生成消息、取消与实际提交

本批新增共享UI GitActionMenu→Host Git service/CLI→真实Git仓库及HTTP模型的消费者。所有仓库、文件与虚构author均在本case私有根，Git配置只写该仓局部user.name/user.email/commit.gpgsign，无remote、push或用户全局配置写入。原Input是唯一业务操作路径，Git CLI只读验证生产结果。普通原会话及自然标题为状态面板入口前置，计量单独说明。

| 具名边界                  | 实际结果                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v58仅已暂存生成与取消阶段 | 原状态面板展开→Git弹窗关闭“包含未暂存”→原生成按钮。真实模型prompt只含staged.txt/B，排除unstaged.txt/C和new.txt/D，原textarea显示合法中文Conventional Commit。生成和原Esc取消后HEAD/count/index/working diff及三文件hash完全不变。当前成员前置2笔加生成1笔，共3笔settled/66Credit；helper不新增用户任务。                                                                    |
| v59只补实际提交阶段       | 不重复v58生成/取消，直接原手写消息+stagedOnly提交。实际第一条commit仅staged.txt=B，另外两文件仍未暂存；原弹窗重新生成只含剩余两文件C/D、排除已提交B的prompt，然后原提交经stagePaths/commit写入两文件。实际只新增2条指定消息commit，三文件字节准确、repo clean。最终reload HEAD/文件/完整请求/账本/任务索引不变。本人前置2笔加生成1笔，共3笔66Credit，另一成员完整两行保持。 |

v58整体result仍为failed：生成/取消具名阶段已经通过，但后续设施检查误将data-disabled属性存在当禁用，尚未点击提交。当前依赖cmdk源码明确输出data-disabled=Boolean(disabled)，false同样形成属性；应按字符串不等于true检查，已修设施且v59原提交成功。原失败与代码副本保留，不改写为整体通过，也没把设施问题当产品缺陷。

其他失败也保留：v56在空工作区找GitActionMenu失败，源码原入口属于会话状态面板，改为先经原Composer建立真实会话、展开状态；v57的DOM投影把HTMLElement当ok值返回，CDP报Object reference chain is too long，改为显式布尔值。新增预检执行实际DOM读取表达式，旧v57代码RED、修复后GREEN，当前11条表达式均有界布尔投影。计量等待收据使用唯一名字，原wx文件防覆盖保持。

本批没有产品代码变化，未重复此前全套类型或测试；目标MJS ESLint/Prettier、Node语法、Python AST/DOM预检和原finally AST保持均通过。正常源码构建冻结的5087输入/6669产物仍由运行时逐项hash校验，没有发布安装包。

[独立最终复核](../evidence/prepublish-continuation-20261021/git-commit-final-verification.json)解析了实际供应商prompt、真实repo快照/commit内容、完整ledger/任务索引与进程日志。v56–v59全部Main/Host/CLI/fixture PID不存在、4自有端口拒连、私有运行根移除、cleanup.errors为空、fixtureExit0、browser-harness daemon/socket关闭。各轮执行源与hash保留。

- [v58生成/取消具名通过及整体设施失败](../evidence/client-native-prepublish-v58-20261021/result.json) / [生成后原仓库快照](../evidence/client-native-prepublish-v58-20261021/git-generated-repo.json)
- [v59缺失提交阶段通过](../evidence/client-native-prepublish-v59-20261021/result.json) / [仅已暂存commit](../evidence/client-native-prepublish-v59-20261021/git-staged-committed-repo.json) / [最终真实commit及文件](../evidence/client-native-prepublish-v59-20261021/git-reloaded-repo.json)
- [投影旧代码RED](../evidence/prepublish-continuation-20261021/git-dom-projection-preflight-red.log) / [修复GREEN](../evidence/prepublish-continuation-20261021/git-dom-projection-preflight-green.log) / [cmdk实际属性合同](../evidence/prepublish-continuation-20261021/git-cmdk-disabled-contract.txt)

同一文件在暂存后再次改动的边界另由[v60报告](prepublish-git-staged-snapshot-test-2026-10-21.md)验证，不从不同文件scope通过推断。整体目标active，后续继续原本地分支创建/切换等缺失消费者；外部MCP/网盘、企微OAuth/远程未验证路径和发布后多系统客户端不参与。
