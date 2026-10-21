# 原企业信息页面与当前组织标签一致性

独立enterprise模式。原修改企业信息表单更名并填写合成联系人后，原企业信息区与header“当前组织”选中项应立即显示同一新企业名称；组织id、当前user名称/role/会话事实不得被企业名称事件覆盖。后台GET tenant及me也应返回新名称。reload保持。

原“角色权限”按钮应展示真实5种角色与成员execute合同；原“设置留存”表单设7天后，页面/原API/tenant.settings一致且contact保留。原“立即清理”对本case只有近期记录时应返回结构化0清理并保留全部近期审计，增加一条原purge审计；不宣称验证了7天前数据的实际自然到期删除。

需要修复时，企业metadata只能由当前Settings读取代发布给原App身份视图所有者，按当前tenant id限定更新tenant/organizations显示标签，保留user/role及额外会话字段；不引入第二身份存储、不重新签发会话或扩大权限。原input和HTTP，私有数据；supplier/ledger0，无外部集成。
