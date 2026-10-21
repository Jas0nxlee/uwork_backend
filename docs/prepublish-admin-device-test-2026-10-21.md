# 原终端凭据签发与真实消费

v35完整通过。原企业页签发凭据、原TTL输入1小时、原结果提供token/id/expiresAt；只读提取到本case私有0700根的0600独占文件，token未进入浏览器执行日志/最终证据。原列表reload只显示hash id、创建和到期时间；撤销后原列表空，均不再次展示明文。

数据库实际kind=device、scopes=[execute]、tenant/user与原交互身份一致，到期与创建时间相差1小时。实际终端Bearer获取配置/模型目录成功，完成一次真实模型请求：受控供应商1次、settled14Credit。使用该凭据访问管理模型列表、终端凭据GET/POST/DELETE均403 DEVICE_SCOPE；拒绝后原凭据行保持。

当前原页面没有撤销按钮，因此owner原交互会话通过真实DELETE撤销是后台消费者验证，未伪称UI撤销。旧终端再次completion401 SESSION_EXPIRED，供应商/账本无新增，原cookie交互会话行逐字保持。真实审计create/revoke各1。全程不接真实员工/主库/外部集成。

共享夹具删除了重复构造9个相同ports字段的样板，各handler仍收到同一原app/api/run/control等引用；两个特殊应答gate参数保持原所有者。增加新签发token的内存日志脱敏值，不保存到额外持久配置。原失败预算/状态/业务断言均未放宽，旧通过场景未重跑。

类型、目标Lint、Python AST通过；自有浏览器/后端/供应商端口/私有根和token文件已关闭清除。源码没有因本case改变。

- [v35结果](../evidence/admin-run-ui-v35-20261021/result.json)
- [原签发页面收据](../evidence/admin-run-ui-v35-20261021/browser-issue-original-device.log)
- [最终类型](../evidence/prepublish-continuation-20261021/admin-device-console-final-typecheck.log) / [最终Lint](../evidence/prepublish-continuation-20261021/admin-device-console-final-lint.log)

用新profile、Node24执行`UWORK_ADMIN_UI_CASE=device node --import tsx scripts/tests/admin-run-ui.ts admin-run-ui-v数字-20261021`。此处没有补造原页面撤销入口，未宣称全部项目覆盖。
