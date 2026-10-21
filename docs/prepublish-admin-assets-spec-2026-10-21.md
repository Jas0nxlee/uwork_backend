# 原技能资产页面审核/发布/更新与客户端下载

独立assets模式，只共享合成账号和基础后台。原新建表单创建skill V1，scope all=true；原发布按钮在审核前必须409 REVIEW_REQUIRED且无资源变更，客户端不可见。原审核V1后仍不可见，原发布V1后客户端目录/下载提供V1文件与原checksum。

原编辑表单写V2内容产生未审核version2，客户端继续下载已发布V1，version1字节/批准状态不变；原审核version2后仍不改变发布指针，原发布version2后目录/download为V2，checksum校验一致且不同于V1。旧version=1下载请求应409 ASSET_VERSION_CHANGED。最后原停用确认使客户端目录排除资产、下载403 ASSET_DENIED，reload仍停用；保留两版真实不可变历史。

通过原browser-harness Input/只读DOM操作原页面，不注入store或响应，不靠直接API发布代替UI按钮；API只用于客户端消费与只读验证。模型供应商和ledger全程0，无外部MCP/网盘、企微或远端探针。
