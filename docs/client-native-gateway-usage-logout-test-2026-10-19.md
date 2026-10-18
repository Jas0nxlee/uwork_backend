# Native 用量请求在途时退出登录

2026-10-19。G09b 本机真实 Native 联测通过：原用量刷新收到真实后台 200 后暂挂，原 Back 卸载设置页，再经原身份菜单退出；原 Host 取消请求，重开匿名企业用量面板后旧资料、套餐、用量和额度均未回显。本轮没有发现新的产品缺陷，修正的是测试夹具的已关闭流判断和菜单投影资格。

## 实际结果

| 原路径               | 观察结果                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 已登录 Gateway 基线  | 原账号、套餐、用量和有效额度卡可见，状态 ready、非 busy                                                                                           |
| 原 RefreshUsage 一次 | Input 为 `1792362295495–1792362296517`；原 GET 从 `1792362296526` 开始，真实 200 于 `1792362296527` 暂挂；oneShot=1、matched=1，无重复            |
| 原 Back              | 设置页与 Gateway 面板均卸载，原工作区可交互，身份入口存在                                                                                         |
| 原退出一次           | Input 为 `1792362311194–1792362312229`；同一响应于 `1792362312228` downstream close/upstream abort，处在该 Input 区间内；后台 logout 新增一次 204 |
| release 原响应一次   | `deliveryStarted=false`、`downstreamFinished=false`，真实结果为 abort/drop，没有重放或晚到成功                                                    |
| 匿名原设置入口重开   | 原 Settings→用量→企业页显示「未登录企业账号」；账号、套餐、用量、有效额度及刷新控件均不存在                                                       |

请求开始到关闭为 15,702ms，关闭发生在退出 Input 内，早于原 20s 请求截止。pending 及退出前安全收据均已落盘，且早于退出 Input。三项 UI 结论分别绑定实际观察收据，没有把空 Settings 当成新面板成功。

初始化为 2 次受控模型请求、2 笔账本、2 条 Trace、44 Credit。Native 本轮完成后四项均未变化：增量全部为 0。后台 logout 总数由初始化后的 1 增至 2；只认本轮增量。console error 和 script exception 均为 0。

## 来源、修正与验证

运行 HEAD 为 `59caa05988c33b7215c75df5279aeeea21f90b99`；正常构建来源为 `cd0127ad1af132978715d2631c09e9895d4c9e72`。Root 在运行前逐项复核全部 7,332 个 tracked 客户端来源、6,631 个 Desktop 文件及 CLI/stage `03adc56b…`，和正常构建一致。本轮仅增加测试夹具、规格与证据，没有修改客户端产品源码，也没有为文档/夹具变更重复构建。

薄门只暂停唯一 exact GET 的真实 200 response，不解析、改写或保存其 headers/body，不创建身份 owner。7 项真实 Node stream 夹具合同通过；已关闭响应被误标 pending 的夹具 RED 保留。独审另发现原 modal 菜单打开会 aria-hide 背景身份按钮，驱动已把退出资格改为原菜单动作 journal 与当前可见退出项，保留开菜单前身份检查；两项小合同通过。二者均不是产品失败。

使用已有受控 email API 与生产加密 store 建立本轮已登录基线，未重做 G04h 空身份登录。实际取消由原 EnterpriseIdentity/Gateway authority 完成。原 Back 会卸载面板，因此本项证明 Host/HTTP 取消与重开后的投影退休，不声称同一个挂载面板接收晚到成功；G09a 组件交付合同另存。

## 资源与边界

Main 原退出 code0、副实例 code0/null、BH 原工具 exit0，28 个 helper 工具均 exit0。Common 原 close 超过 20s 未终态，业务 PASS 与该清理失败分列。Root 再核 PID/PPID/birth/cwd 和零监听，识别同一 Common 的本轮 esbuild 直属 helper 后，仅精确 SIGKILL Common；helper 随父管道关闭自行退出，没有对其发信号。Common 原工具最终 exit1。

Root 独核五个已知 PID 不存在、四个 TCP 端口拒连及 BH socket 连接关闭。独占私有根从创建起为 0700并保留；handoff 后没有 read/stat 根或查询未知 FD holder，不把已知进程/端口关闭推成零写者。原 electron 日志和原始 experience 快照不纳入公开 seal。

主后台 PID42125 未重启、部署、管理员登录或模型调用。2026-10-18 22:29:46.034 UTC 只读核验 health、首页和 JS/CSS 均 200，九张业务表与四个部署资源哈希不变。

公开依据：本轮 `evidence/client-native-gateway-usage-logout-20261019/` 的 `result.json`、`gate-*.json`、三项 `ui-*-checked.json` 及原工具终态；[manifest](../evidence/client-native-gateway-usage-logout-20261019/manifest.json) 为 94 个公开文件，SHA `70de70eeb90b5c5e2e589ad80b8e43b635c413b62f79f1b6841d2a7665dfd4a6`，Root 全部逐 SHA 核对，并独立复核三项实际 UI 收据。Root 独核在 `evidence/client-post-w02-coverage-audit-20261019/` 的 `g09-business-independent.json`、`g09-owned-resources-independent.json`、`g09-final-public-independent.json` 和 `main-after-g09.json`。规格为 [G09b 合同](client-native-gateway-usage-logout-spec-2026-10-19.md)。

真实企微、外部 MCP、网盘继续排除；外部模型账单、签名安装及三平台目标不由本项替代。G04j 已安装插件推荐卡的原 UI 绑定仍待执行，U02–U05 不据此关闭。
