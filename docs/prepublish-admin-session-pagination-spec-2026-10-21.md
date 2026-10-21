# 原运行会话列表/搜索/分页

独立sessions模式，真实HTTP/worker创建27个自有会话，每个一次真实受控供应商请求和settled14Credit；这是分页数据准备，不作为27种功能。原会话页面应显示总数27/首25行，原下一页2行，原上一页25行，两页集合与实际SQLite会话ID/agent/user/run_count完整对应。原详情展示准确session与run_count。原搜索精确sessionId只1行，原不存在查询为空；原清除查询后reload恢复27/25行。

所有原UI读取都必须不新增run/模型/ledger，原27笔完整行保持，浏览器只发GET且实际page=2和q精确匹配；复用原Collection分页/搜索/详情消费者，不用直接UI/store写状态。无外部服务或发布包。
