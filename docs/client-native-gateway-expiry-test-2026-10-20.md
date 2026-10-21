# Native 原身份自然到期与 Gateway 请求取消

新 Linux 原已安装包的自然到期切片 v1 真实通过：**6 项检查、10 个原界面动作、65.343 秒**。它与[后台会话吊销后旧200成功晚到](client-native-gateway-mounted-late200-test-2026-10-20.md)分别验收，不能混为同一种交付结果。

隔离后端用原 `issueSession` 的正式 ttl 参数为本轮普通 member 签发60秒不透明 session；原 `/api/auth/me` 返回其真实 expiresAt，原加密 store 保存同值，Native 原 adapter/Identity owner 自行恢复。没有增加 HTTP 登录TTL字段、改数据库到期时间、改时钟或注入 React/RPC；没有第二个身份 owner，也没有调用 logout 替代自然到期。

原 FirstRun→原身份菜单“企业网关”得到账号/额度/用量基线。距原 issuer 到期 **5984ms** 时，经原 RefreshUsage 只发一次 month/requests；真实200暂停。原到期时间为 `1792492375484`，原 owner 计时器失效后，该响应于 **+2ms** 下游关闭并上游 abort，早于20秒网络请求截止：

- 原身份 name 节点消失、signed-out entry 出现；未出现登录页替身。
- 原 store 从 revision1/sessionPresent=true 变为 revision2/sessionPresent=false。控制端只读原 store 的公开元数据，不输出凭据，也不补写 tombstone。
- Gateway 实际保持同 DOM `backendNodeId 54→54`，显示“未登录企业账号”；原账号、端点、额度、用量和模型卡均无回灌，后续六次观察通过。退出路径可广播的源码仍沿原 owner；本组没有第二窗口/Host，**不冒领跨窗口广播接收验收**。
- release 原 held response 后，`phase=aborted`、`releaseRequested=true`、`deliveryStarted=false/downstreamFinished=false`；这是 **abort/drop**，不是成功晚到或重放。
- 原 Back 返回工作区，再打开原模型菜单：原 UCAS provider group=0、UCAS candidate=0；实际截图显示“当前没有可用模型”和仅管理模型入口。
- 供应商调用、账本、Trace及Token/Credit从基线到最终全部为0。

产物与前一个切片相同：`uwork-linux-desktop-installed:20261020-v4-async`，固定 image ID `sha256:7615e2f3dca262a77a0936d8bdc776019764d11504962ca18d6cf6e4103b3cf3`，app.asar SHA256 `4f716c13f57315ab5992a6ba1b831ee2665dc6ab2db8e0eda0d3e65ddbac5034`。UID1000、只读镜像、独立HOME/SQLite/internal网络，沿原fixture初始 `--no-sandbox`，未加outer seccomp例外；本结果不替代sandbox验收。

原 shutdown 容器 exit0；容器/internal网络不存在，自己的隧道退出、两host端口关闭，BH daemon不存在且socket关闭，后台最终proof与关闭前一致。没有启动/停止 VM、修改主服务/主库或系统安装。该模式准备、Node语法、Lint、Python编译通过，没有为新增测试重建产品。

复跑仅在主任务分配的唯一GUI时段，用新名字运行：

```sh
python3 scripts/tests/linux-desktop/gateway-mounted-probe.py \
  --name client-linux-gateway-mounted-expiry-<fresh> --natural-expiry \
  --image uwork-linux-desktop-installed:20261020-v4-async \
  --expected-asar-sha256 4f716c13f57315ab5992a6ba1b831ee2665dc6ab2db8e0eda0d3e65ddbac5034
```

证据为 `evidence/client-linux-gateway-mounted-expiry-v1-20261020/{result,preparation,backend-final-proof,gateway-final-state,harness-cleanup}.json`、`expired-gateway-ui.png` 和 `final-ui.png`，两张截图均已实际查看。真实企微浏览器未重试，外部MCP/网盘不参与；不由此关闭所有测试、Native Read等待读取、其他平台或生产验收。
