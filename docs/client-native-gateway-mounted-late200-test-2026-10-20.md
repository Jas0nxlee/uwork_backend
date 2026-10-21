# 同挂载 Native Gateway：授权退休后旧 HTTP200 不回灌

Linux 原已安装新包的 v2 真实联测通过，5 项检查、9 个原界面动作、12.571 秒。原 Main/Host/Renderer/包内服务均未改写；透明代理只暂停一次原后端的真实响应，没有修改 headers/body 或注入 React/RPC 业务状态。

原 FirstRun 与身份恢复后，通过原身份菜单“企业网关”打开面板。原刷新产生 month/requests 真实200并被暂停；测试控制端使用该测试会话调用原后端 logout，返回204。保持设置页不导航，点击原“近7天”，新 entitlement 请求实收401，Gateway 原 admission 退休受保护投影。随后放行原 month200，实际 `deliveryStarted=true/downstreamFinished=true/upstreamAborted=false`，旧账号、端点、额度、模型及用量没有回显。

整个阶段 Gateway 面板的真实 DOM `backendNodeId` 保持 **52→52**，原 CDP session 不变；释放后六次独立 DOM 观察均通过，刷新控件不再 busy。供应商、账本和 Trace 从基线到最终均为0。最终截图已实际查看：显示“企业会话已过期，请重新登录”，端点未设置、暂无生效套餐/用量，旧账号与模型卡已清除。

本项是**后端会话吊销后，同挂载原生 Gateway 面板对成功晚到旧 HTTP200 的拒绝链**，不冒称本地 EnterpriseIdentity owner 已退出、A→B热切，或旧 View DTO 已越过 Host 后由 React 单层丢弃。真实 Identity owner 换代按当前架构会 abort 原 fetch，之后只能记 abort/drop；这条同挂载自然过期边界仍另验。

产物为实际 apt 安装镜像 `uwork-linux-desktop-installed:20261020-v4-async`，固定 image ID `sha256:7615e2f3dca262a77a0936d8bdc776019764d11504962ca18d6cf6e4103b3cf3`；app.asar SHA256 `4f716c13f57315ab5992a6ba1b831ee2665dc6ab2db8e0eda0d3e65ddbac5034`，与 root 当前原包相同。普通UID1000、只读镜像、独立HOME/SQLite/internal网络；初始应用沿旧fixture的 `--no-sandbox`，没有添加 outer seccomp 例外，不以本项声称 Chromium sandbox。

v1 原失败保留：原页面已完成初始化与账号/额度基线，首次新增控制状态请求因测试代码误用 `app.db.get`（实际是 `app.services.db`）抛 TypeError，原 async HTTP callback 未捕获导致测试后端退出。不是首次 CDP 端口未就绪，也不是产品缺陷。通过真实 `createApp` 的独立临时库合同复现旧地址 TypeError，并验证正确地址计数0；只修新测试脚本，补上清洗凭据的控制路由错误记录，再由全新 v2 profile 复测通过。v1 容器/网络/端口关闭，BH仅有socket关闭证明，未补造其daemon优雅退出。

v2 原后端 shutdown、容器 exit0，容器/internal网络均不存在；自己的隧道退出、两host端口拒连、BH记录daemon不存在且socket关闭、后台最终快照一致。工作目录/镜像/证据保留，不声明整个根已删除，也不启停 VM 或主服务。

可复跑入口：`scripts/tests/linux-desktop/gateway-mounted-probe.py --name <新client-linux-gateway-mounted-名字> --image <固定安装镜像tag> --expected-asar-sha256 <已核包SHA>`；新增 prepare 仅在 esbuild 测试边界扩展原fixture，逐SHA记录共享源不变及独立bundle。共享 `backend.mjs`、`probe.py`、hold夹具及产品源码均未修改。只能在主任务分配的唯一 GUI 时段运行。

主要证据为 `evidence/client-linux-gateway-mounted-v2-20261020/{result,preparation,backend-final-proof,gateway-final-state,harness-cleanup}.json` 与 `final-ui.png`；v1 原日志/结果另留。`evidence/client-gateway-fixture-counter-contract-20261020.json` 是实际API接口错误的定向验证；不计为 Native 业务检查。新增脚本 ESLint、Node语法、Python编译与文档格式通过，原 hold stream 合同7项另行复核；没有为测试设施变更重建产品。

真实企微浏览器的安全拒绝没有重试，外部 MCP/网盘不参与。本切片不关闭全部目标、真实身份过期、Read内核等待撤权、跨平台或生产验收。
