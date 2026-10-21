# 原Git文件审阅与来源隔离

PREPUBLISH_GIT_REVIEW=1仅补当前实际支持的GitPane读消费者。原命令中心先选“操作”范围，再用“添加审查标签”打开原面板，无聊天前置。私有仓库HEAD两提交、owned-base为本地追踪分支（无remote/网络）；branch.txt提交态从BASE到COMMIT。review.txt的HEAD A/index B/worktree C三版本，index另有纯rename-old→rename-new，worktree另有删除文件、二进制变化、新增未跟踪文件。

原未暂存来源应列4文件，展开review显示B/C而不显示A，删除显示真实旧内容，新文件显示真实新内容，binary显示二进制不可预览提示。原已暂存来源列review和rename两项，review显示A/B而不显示C；纯重命名原页面应显示similarity/rename元信息，不应被当作新文件全部新增，原服务before/after应与实际旧/新路径的相同内容一致。原全部分支更改只含branch.txt，展示BASE/COMMIT；原上一轮来源只证明当前明示空态，不把未接v4数据的骨架当已实现快照。原刷新/回未暂存/原reload不改HEAD/refs/index/任何文件或完整模型/账本。

输入只走原快捷键/命令项/来源菜单/文件行，DOM（包含open Shadow DOM）只读渲染内容。独立只读canonical reader调用原createGitService.getDiff并核对实际Git各版本字节，不写index或用返回值代替UI。当前成员模型/ledger新增0，另一成员完整两行保持。正常源码产物逐hash校验，原finally及所有自有资源闭合不变，外部MCP/网盘/企微/远程和发布后多系统客户端不测。

能力边界：当前GitPane没有独立stage/unstage/discard控件，useGitActions只是无UI消费者的旧占位模块，不伪造直接API调用验收这些入口；真实stage/commit已在提交/分支保护消费者验证。本例是实际文件diff而不是GitGraph元数据详情。
