# 原Git图谱分页与提交详情

PREPUBLISH_GIT_GRAPH=1独立case，原Composer分支入口→原Git图谱。私有仓库main包含52线性提交，feature两提交、main另一个fork提交及no-ff合并，共56个可见提交，另有一个仅refs/zcode/checkpoints/owned-graph可达的独立内部提交；main/feature/owned-release tag均真实Git引用，无remote。所有元数据通过原Host Git service读取，不写React store、不发业务RPC代UI。

初始页应按原Git可见refs/topo/date顺序显示前50条、完整SVG节点和分支泳道；不可包含内部checkpoint hash或subject。原merge行展开应显示实际subject/full hash/author/date及两个短父hash，标签/HEAD/branch引用准确；再点击收起。通过原mouseWheel滚动触发分页，最终56条顺序正确且无重复，旧root行详情正确（无父提交）。回顶后原刷新恢复首50条/关闭超页旧详情，原关闭/reload不复活，不改变Git refs/HEAD/文件或完整模型/账本。

PREPUBLISH_GIT_GRAPH_EMPTY=1仅补无提交仓库：原图谱显示“暂无提交”和无历史说明，无SVG/提交行/加载错误；原刷新和关闭/reload均保持，未创建HEAD或提交。

两例不创建聊天输入，当前成员模型/ledger新增0，另一个成员完整两行保持。正常未打包Main/Host/UI/CLI、真实身份/配置后端、Git仓/SQLite与原Input参与；Git CLI只用于前置和只读事实，初始56个提交与内部ref不是产品创建功能验收。原finally不变，自有PID/4端口/根/BH独立关闭。外部MCP、网盘、企微/远程和发布后多系统客户端不参与。
