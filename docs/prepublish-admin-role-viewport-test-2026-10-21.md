# 原页面角色动态授权与320/768联动

本轮仅新增角色边界和窄视口功能，不重跑凭据/分类/企业/观测/下载等此前全量通过集。原Fastify/SQLite/worker、自有Chrome和仓库admin原页面，控制器仅用真实HTTP准备和调整合成成员；不操作主库、真实员工、外部MCP/网盘、企微或受拒远程。

## 角色：v32通过

- 同一合成admin用原登录表单登录，打开原模型编辑并改名称；owner HTTP降级auditor后，旧页面仍显示admin，但原保存实际403，原弹框显示错误且可取消。原模型逐行保持。
- reload立即显示auditor；模型详情、成员列表可读，Collection无新建/编辑/删除/身份绑定，客户端定制fieldset及内部控件禁用。原企业表单提交403，Vault读取全为403且列表无元数据；企业/密钥行保持。
- 改operator后同一Cookie reload，原分类新建201；操作者审计恰为identity.login一次及asset.category.create一次。
- 改member后同一Cookie reload，原5类导航只显示无管理权限；没有增加任何租户管理HTTP请求。全部角色变更中原session数据库行逐字保持，无重新登录或重签会话。供应商/ledger全0。

原企业设置页对auditor仍展示可打开的修改表单，但后台提交正确拒绝；此处证明实际授权边界，不宣称所有设置入口都已按角色隐藏。

v30/v31在前5个原页面阶段均已通过，失败分别来自审计预期漏计原identity.login、SQLite原生行对象null prototype与普通字面量的strict比较；修正为完整两条审计并显式投影字段，没有修改产品/权限门禁/业务断言。后续GET Vault会在导航/reload的原StrictMode读取多次，验收每次均403，不把重复读取误算成只能1次。原失败保留，v32完整6阶段通过。

## 视口：v33及v34通过

按SPEC-admin-web补此前1440之外的320/768原Web视口；不构建或运行发布后的系统客户端。320宽原登录、导航展开/关闭、创建分类真实201；横向大表滚动后原模型编辑可打开，长表单取消按钮经原滚动可点，无模型PUT。768宽原侧栏导航、删除取消保留记录、确认204及reload为空；分类create/delete审计各1，供应商/账本0。

实测documentWidth分别320/768，无页面额外横向溢出；320对话框left20/right300，大表单top40/bottom760且内部宽278无横向溢出；768对话框left24/right744。4张原截图已人工视觉检查，控件/文字清楚，长模型表单允许内部竖向滚动。

v33的320分类图捕到了侧栏关闭动画中间态；驱动现等待aside.right<=1。v34只重新打开并取消原表单、补稳定截图，未重复已通过的创建/删除/模型编辑流程。两次场景自有资源全部关闭，私有根清除。

## 门禁与证据

最终Node24严格typecheck、目标eslint、2份Python AST及git diff --check通过；无产品变更，不重复旧全套。权限与视口独立结果、截图均可查：

- [v32角色完整结果](../evidence/admin-run-ui-v32-20261021/result.json)
- [v30失败](../evidence/admin-run-ui-v30-20261021/result.json) / [v31失败](../evidence/admin-run-ui-v31-20261021/result.json)
- [v33视口完整结果](../evidence/admin-run-ui-v33-20261021/result.json) / [v34仅稳定补图](../evidence/admin-run-ui-v34-20261021/result.json)
- [320稳定分类表单](../evidence/admin-run-ui-v34-20261021/viewport-320-category-form.png) / [320长模型表单](../evidence/admin-run-ui-v33-20261021/viewport-320-model-form.png)
- [768确认](../evidence/admin-run-ui-v33-20261021/viewport-768-category-confirm.png) / [768 reload空列表](../evidence/admin-run-ui-v33-20261021/viewport-768-empty.png)
- [最终类型](../evidence/prepublish-continuation-20261021/admin-role-viewport-final-typecheck.log) / [最终Lint](../evidence/prepublish-continuation-20261021/admin-role-viewport-final-lint.log)

全新profile运行`UWORK_ADMIN_UI_CASE=roles|viewport node --import tsx scripts/tests/admin-run-ui.ts admin-run-ui-v数字-20261021`；仅稳定补图另加`UWORK_VIEWPORT_CAPTURE_ONLY=1`。本轮没有采集全页面未捕获异常/console事件，因此不据截图/HTTP成功宣称满足SPEC的无控制台错误门禁；该项及原终端凭据签发UI消费者继续补测，整体目标active。
