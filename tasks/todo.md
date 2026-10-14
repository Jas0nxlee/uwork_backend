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
- [x] T12c Agent 模型工具调用与隔离 Runtime 闭环（SDK、自有计量端口、真实 Docker、取消/撤权/双场景崩溃恢复、管理 UI）
- [x] T12d Agent 受控 MCP 连接器工具接入与远端副作用不确定性处理（白名单、版本冻结、schema 校验、计量循环、取消/断线/超时、SIGKILL 恢复）
- [ ] T13 完整 UWork Host 资产与策略应用
- [x] T13a 本地 Host 非交互执行准入：私有身份/issuer、当前订阅渠道策略、Hook/审批后重查、原生进程/逐跳 HTTP 闸门及跨源码真实 HTTP/进程验证
- [ ] T13b 企业资产安全安装/更新/撤销并接入已有 Runtime 所有者
- [x] T13b1 后端资产版本/校验和准入、订阅/IP 下载入口及可移植技能包路径合同（不代替 Host 安装/加载）
- [x] T13b2 独立受管资产缓存适配器：排他暂存/原子发布、完整校验/安全撤销、并发/真实 SIGKILL 恢复、实际 HTTP 下载至既有 SkillPort 验证（自动 Host 同步/逐次加载授权尚未接线）
- [ ] T13b3 装配 Host 自动资产同步、运行时逐次加载授权，以及专家/Playbook/指令/受控 MCP 的现有所有者接入
- [ ] T13c 已发布菜单/新会话/风险/分享/个人/助理配置的 Host 与 UI 应用
- [ ] T13d 附加远程工作区执行策略、三平台安装与完整集成验收
- [ ] T14 逐页面/表单能力台账与缺口审计

- [ ] 完整资产/菜单/安全策略接入实际 UWork Host 所有者与三平台安装验收
- [ ] 每个真实企业企微 callback、真实供应商生成/计量、生产 TLS/外部网盘/支付/生产沙箱部署
- [ ] 生产目标主机部署和远端 CI 结果（本机 Docker 验证已通过）
