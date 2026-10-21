# 原观测页面CSV下载

独立export模式，仅补下载未覆盖能力。受控真实HTTP生成2笔completion及configuration.applied/asset.installed各1终端事件，原页面查询后点击原“导出”链接，浏览器Cookie认证、CSV响应及磁盘成品均实际参与。下载只允许写入本case私有控制根下独立目录。

用量/追踪按真实model id分别2行；终端事件按configuration.applied只1行；操作日志按vault.create只1行；另做不存在模型查询的用量导出仅表头0行。固定原合同列、实际行字段和过滤条件一致；不得将原API请求代替原链接点击或以fixture预期生成CSV。导出审计usage2/trace1/client-events1/audit1，rows分别2/0/2/1/1；ledger/trace/event逐行不变，供应商仅2次，无下载后计费。

不读取真实员工或主库数据，不外发消息/接外部集成。只记录CSV字节数/摘要/列名/行数，私有文件结束删除。
