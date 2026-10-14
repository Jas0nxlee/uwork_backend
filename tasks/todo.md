# 实施任务

- [x] T01 identity / directory / access-control 持久化与安全测试
- [x] T02 credential-vault / entitlements / model-gateway 调用与扣量
- [x] T03 ai-assets 版本、分类、范围、审核与分发
- [x] T04 client-policy 草稿发布与服务端执行入口
- [x] T05 agent-runtime 模型执行、取消、自动化及评测
- [x] T06 telemetry 日志、Trace、指标、导出、留存接口
- [x] T07 external-integrations 能力声明与网盘适配合同
- [x] T08 admin-web 管理流程与浏览器验证
- [x] T09 uwork-client 后端 SDK、身份/模型/用量服务适配与合同验证
- [x] T10 最终构建、运行、交付文档与验收台账（外部与项目级缺口如实保留）

项目级待办（本地后端构建不替代这些验收）：

- [x] T11 专用 Docker 实例、实际镜像构建、容器业务流程和重启持久化验证
- [x] T12a 真正隔离的 Docker Runtime 生命周期、执行、取消、限额、崩溃恢复及管理 UI
- [x] T12b 跨命名空间租约、写入 fencing、迁移前独占与只读在线备份
- [x] T12b2 模型工具协议 JSON/SSE 往返、输入上界计量与成功后分派
- [ ] T12c Agent 模型工具调用与隔离 Runtime 闭环
- [ ] T13 完整 UWork Host 资产与策略应用
- [ ] T14 逐页面/表单能力台账与缺口审计

- [ ] 完整资产/菜单/安全策略接入实际 UWork Host 所有者与三平台安装验收
- [ ] 每个真实企业企微 callback、真实供应商生成/计量、生产 TLS/外部网盘/支付/生产沙箱部署
- [ ] 生产目标主机部署和远端 CI 结果（本机 Docker 验证已通过）
