# 原订阅与限量页面到Gateway计量准入

独立limits模式，以本fixture已分配席位的owner作为member限量对象，不重跑组织创建或其他场景。原“设置限量”表单写0，真实completion402 QUOTA_EXCEEDED且provider/ledger0；同原表单更新1000后调用成功14Credit。再把限量设为已消费14，下一请求应402且原ledger逐行保持，原“移除”后调用恢复再14。

原Settings页面reload后显示已使用28、member限量行空；原subscription/model资源不改，浏览器3次PUT /limits与1次DELETE、原3 update/1 delete审计匹配。只通过原Input/只读DOM和真实HTTP，数据库只读核验，无直接写业务表/虚假账本/浏览器fetch替换；真实请求仅到本机供应商，其他外部边界不参与。
