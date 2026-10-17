# 自有配置控制面的 Native 联动验收规格

本轮使用同一次正式 CLI → stage → Desktop 构建后的产物。先完成接口、源代码和管理页浏览器验证，再启动独占 Native；旧产物的通过记录保留，不能抵作新协议验收。

## 所有者与测试边界

```text
独占管理页 Chrome → 同源 HTTPS 静态代理 → 真实 createApp / 独占 SQLite
                                              ↑
正式 Native Renderer → 原窗口 Host / 私有身份 → 已发布配置
                                              ↓
                                原 runtime-preferences → CLI turn
                                              ↓
                               原模型准入 → 本机受控供应商
```

管理页使用 `owned-admin-artifacts.json` 所列正式构建字节。夹具仅把这些静态文件复制到独占根，逐个校验 SHA；所有 `/api/` 与 `/v1/` 请求原样转发到实际后台，保留 Origin、Cookie、鉴权和正文，不伪造业务响应。主 `admin/dist` 不更新，主 3000/PID 37266 不重启。浏览器只信任本次独占证书的 SPKI，不关闭全局证书验证。

Native 沿用公开配置和全部 out 的独占不可变快照、真实 appPath/isPackaged、加密身份存储及原受控模型服务。登录初始化使用本地测试账号和真实 HTTP session，不声称企业微信 OAuth 验收。管理页登录资料仅在临时根以 0600 保存，供真实 DOM 登录使用；不写入 evidence 或 stdout，结束删除。

夹具选项 `UWORK_NATIVE_CLIENT_EXPERIENCE=enabled` 仅启用上述测试静态快照、临时浏览器登录资料及状态取证命令；不传给产品，不新增产品配置来源。此模式仍使用原创建配置、草稿、发布、限额与账务接口。只增加测试预算，避免夹具限额先耗尽掩盖功能结果。

## 验收顺序

1. 核对正式产物和管理页快照 SHA、进程/端口归属以及主实例基线。保存草稿后 Native 仍读已发布值；实际管理页发布后，经客户端现有重新读取动作生效。
2. 在 Native 实际显示并选择已发布推荐、自动化/错峰模板；检查 prompt、cron 和描述按合同投影。模板只填充原表单，创建/执行仍走原准入。未安装或失效的 pluginStableId 只保留普通 prompt，不触发安装。
3. 插件排序只作用于实际已有目录条目，缺项保持原序。帮助关闭时旧菜单、quick pick 和反馈 store 入口均不提交旧工单。外部帮助的 URL 决策、OS 打开及浏览器到达分别记录，未执行的层次不算通过。
4. 上下文 false/true/false 分别触发真正的新 turn，检查本机供应商实际收到的 system context；整 turn 快照不因中途发布而变化。WorkflowActor、customPrompt、subagent 仍不获得 Desktop 段。实际发出的请求与已结算、取消/uncertain 分开统计。
5. 独占配置网络暂不可用、身份/端点变化、窗口或 child 更换，以及冷重启，检查清旧派生值和迟到结果围栏。Main 双窗口和 trace epoch 必须另有实际进程证据；聚焦测试不能代替 Native 多窗口验收。
6. 新 Native 请求中旧 `/api/client/configs` 与 `/api/client/scenes` 应为零；保留此前 404 RED。反馈/附件不得因关闭或外部模式而请求旧后台，不自动向外部帮助 URL 上传上下文。
7. 关闭独占 Native、Chrome、BH 和服务，实际核对所有已知 PID、端口与临时根；重新验证主 9 表和主静态资产未变。真实企微、外部 MCP、网盘及先前自动安全审查拒绝的远端探测不执行。

协议、权限、身份或私有数据范围不允许通过宽松解析、测试专用业务路径或后台直接写库来实现验收。源码、聚焦测试、受控 HTTP、实际 UI、OS 外链和外部服务分别报告。
