# access-control

目标：租户隔离、RBAC、成员/部门范围查询。后端裁决。
实现：src/access.ts；owner/admin/operator/auditor/member 基础角色；每次请求读取成员状态；管理能力与执行准入分别检查。
验收：普通成员拒绝管理写入，审计员只读，跨租户 ID 不可读取；默认不可见不能由 allow 扩大。
命令：npm test；npm run build。策略函数独立，测试真值表。
边界：禁止 UI 自行决定权限、以用户提交的 tenantId 代替鉴权组织。
