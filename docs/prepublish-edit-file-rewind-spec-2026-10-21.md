# 原消息编辑并回滚文件

独立PREPUBLISH_REWIND_FILES=1，只补preserve编辑未覆盖的workspace rewind按钮。当前未打包Main/Host/UI/CLI、真实隔离后端、生产Read/Write与本机受控供应商；不运行旧队列/普通编辑/Fork/批删，不用发行包。

控制器只在新建私有Git工作区准备owned-rewind.txt初始UTF8字节和初始commit，原后台HTTP发布allowFilesystem=true，其他能力保持。原Composer A的实际供应商依次请求Read、Write、普通完成；需要审批时只点击原allowOnce，不能启用全权限。实际文件必须由生产Write改成受控新内容，不由控制器代替工具写入。

原user编辑器写E，先模拟本case外部编辑器将该文件改成第三种内容；原“重置对话并回滚文件”必须显示原冲突预览，文件/active历史/供应商与完整账本保持；取消冲突弹框后，外部编辑器撤销自己的第三方改动回到原Write结果，再点同一原回滚入口。生产事务必须在E的模型请求之前把文件恢复初始字节，随后同session只新增1次模型请求；canonical只含E新问答，物理旧历史保留。reload无重放，文件仍初始内容。

原受控usage每次12/10Token、22Credit；Read/Write/final/title共4笔88，E后5笔110，冲突与reload零增；另一成员完整两笔账本保持。控制器外部编辑/撤销只用于指定自有文件的冲突前置，不能写业务数据库、store或发Runtime业务RPC代UI。生产selector/codecs只读核对，原finally回收全部自有资源。外部MCP/网盘/企微/远程和发布后客户端排除。

冲突恢复的独立补测：PREPUBLISH_REWIND_FALLBACK=1使用同一受控变更前置，只点击冲突弹框“仅重置对话”，外部文件字节必须保持且新问题只执行一次；不重复取消后回滚的已通过分支。PREPUBLISH_FILE_ONLY_REWIND=1另验文件摘要入口，合同见prepublish-file-only-rewind-spec-2026-10-21.md。
