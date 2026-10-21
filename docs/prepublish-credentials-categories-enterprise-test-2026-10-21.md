# 凭据、分类与企业信息原页面联动

本轮只补未覆盖的原管理页面操作，使用仓库admin发布前构建、独立自有Chrome、真实Fastify HTTP/SQLite/worker及受控HTTP供应商。全部数据随机私有，未读取真实.env凭据，未访问外部MCP、网盘、企微OAuth或受拒远程路径。没有重跑已经通过的全套测试。

## 新增覆盖

- **v22凭据**：原密码表单创建→原轮换→撤销取消→撤销确认→原轮换恢复→详情与reload。真实模型调用的供应商鉴权阶段依次initial/rotated/restored，修订1/2/3；撤销后模型目录隐藏，调用409 CREDENTIAL_UNAVAILABLE，未到供应商且无额外计费。3笔settled各14，共42。模型绑定为控制器静态前置，不计为模型绑定UI覆盖。详情只含公开元数据，原种子凭据和模型引用保持。
- **v23分类**：原表单创建、重复409、被当前草稿引用时删除409、被当前发布版本引用时删除409、解除引用并发布后取消/确认删除及reload。分类审计create/delete各1；资产与版本逐行保持，无模型调用或计费。历史非当前发布版本的引用不阻止删除，此处按原合同验证。
- **v24→v25企业**：原企业表单改名/联系人、顶部组织标签、reload、角色权限、7天留存、立即清理。角色5种与权限合同一致，当前用户/成员行保持，联系人和留存互相保留。本case只有近期记录，清理计数全0且近期审计逐行保留；不宣称覆盖老数据删除。

## 实际修复

v24真实失败：PATCH200，企业信息区和GET me均为`Owned enterprise revised`，顶部选中项仍为`Owned run UI`。原App持有的身份视图只在登录/切组织时刷新，Settings局部load未同步元数据。

现由Settings的当前有效读取代向原App发布企业id/name，App仅在当前tenant id匹配时更新tenant和对应organizations名称，保留user、role和其他运行字段。旧读取和卸载读取仍由原generation保护；未新增身份存储或会话签发。v25原页面同一步无reload即三处名称一致，随后完整新增企业流程通过。

3条新单元测试覆盖同步与输入不可变、其他tenant/未登录忽略、幂等及菜单独立陈旧修复；RED缺模块，GREEN3/3。原页面v24产品RED和v25GREEN为主要复现证据。首次严格类型门禁另发现新测试4处已知fixture数组下标未收窄；补齐下标存在断言后，最终typecheck与3条逻辑测试均通过，原失败日志保留。

## 门禁和证据

Node24：最终typecheck、lint、build均exit0，三份Python驱动AST检查通过；只跑本次新增3条逻辑测试，没有重复已有全量通过集。源码审阅确认显示元数据更新受当前tenant限定、无权限字段覆盖、无原凭据输出。3个新场景及RED均已关闭自有浏览器和HTTP端口、移除私有根。

- [凭据原始结果](../evidence/admin-run-ui-v22-20261021/result.json)
- [分类原始结果](../evidence/admin-run-ui-v23-20261021/result.json)
- [企业改名RED](../evidence/admin-run-ui-v24-20261021/result.json)
- [企业GREEN](../evidence/admin-run-ui-v25-20261021/result.json)
- [新增逻辑测试](../evidence/prepublish-continuation-20261021/admin-enterprise-unit-final.log)
- [类型](../evidence/prepublish-continuation-20261021/admin-telemetry-typecheck.log) / [Lint](../evidence/prepublish-continuation-20261021/admin-new-cases-lint.log) / [构建](../evidence/prepublish-continuation-20261021/admin-enterprise-build.log)

复跑使用新`admin-run-ui-v数字-20261021`目录，以Node24执行`UWORK_ADMIN_UI_CASE=credentials|categories|enterprise node --import tsx scripts/tests/admin-run-ui.ts <profile>`。这些新增通过不等于整个项目全覆盖，剩余共享源码联动继续开放。
