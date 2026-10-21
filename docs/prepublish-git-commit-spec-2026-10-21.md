# 原Git提交与真实消息生成

独立PREPUBLISH_GIT_COMMIT=1使用原GitActionMenu/Host Git service和真实隔离HTTP模型。私有Git仓库只有测试文件与本仓局部虚构author，无remote，不读写用户Git配置。前置baseline提交两文件A；staged.txt改B并暂存，unstaged.txt改C、new.txt新增D未暂存。

原提交弹窗关闭“包括未暂存”后点击生成消息；真实模型prompt只能包含staged.txt/B，不得泄露另外两文件。模型输出合法中文Conventional Commit，原textarea准确显示；原Esc取消后HEAD/index/worktree逐字保持，生成本身不暂存/提交。再原弹窗仅已暂存+原输入手写消息并提交，实际commit只含staged.txt，另外两文件仍未暂存。

第三次原弹窗默认包括未暂存，原生成模型prompt只含仍脏的unstaged.txt/new.txt及C/D、排除已提交staged.txt。原提交将两文件经生产stagePaths+commit提交，HEAD仅新增两条指定消息的commit、三文件最终字节准确且repo clean。原reload不生成额外请求/提交；helper不在原任务侧栏泄露业务任务。当前Git入口属于会话状态面板，先用原Composer普通请求建立一个真实任务（对话与自然标题2笔44Credit）作为必要前置，并展开原状态面板；不以空工作区缺少该入口当产品缺陷。两次生成新增两笔，最终本人4笔settled/88Credit、另一成员完整两行保持；纯手写提交/取消不调用模型，无push路径。

所有业务操作走原Input；只读Git CLI/SQL验证实际状态。没有直接调用Git RPC、替换生成服务或模拟成功。正常源码产物snapshot/hash校验、原finally和自有进程/四端口/私有根/BH闭合保持。外部MCP/网盘/企微/远程/发布后多系统客户端不测。

v58生成/取消具名阶段已通过，不重复该阶段。PREPUBLISH_GIT_COMMIT_ONLY=1从相同真实仓库前置开始，只补手写staged-only提交和剩余两文件生成提交；此例只有一次生成，含普通任务前置最终3笔66Credit。原两阶段证据分开，v58整体failed在设施data-disabled=false识别，不改为整体passed。
