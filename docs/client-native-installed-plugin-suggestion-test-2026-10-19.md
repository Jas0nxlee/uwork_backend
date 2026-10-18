# Native 已安装插件推荐卡联测

2026-10-19。G04j 两阶段真实 Native 联测通过：已发布推荐卡为当前已安装、启用的插件生成一个 mention 与固定 prompt；经原 User 设置禁用后，再点同卡得到纯 prompt、mention 为 0。本轮无发送、无新增模型或计费，也没有发现新的产品缺陷。

## 原界面与后台结果

先通过原 Settings→Plugin→添加来源 Dialog 输入本轮已核对的 loopback URL，再经原插件商店安装自有包。包只有 manifest 和一份文本 Skill，不包含 Hook/MCP/脚本，未执行 Skill 正文。安装记录从原商店 installed strip 和同 ID 的原 User 管理行双重读回，enabled=true；未从另一 HOME 复制安装记录。

安装后经原管理入口、原插件侧栏清除商店返回来源，再用原 Back 回同 workspace 空草稿。该设置准备与后续两阶段业务分列，不把既有插件生命周期验收重算一遍。

| 业务阶段                 | 实际原界面结果                                               | 实际测试源 HTTP            |
| ------------------------ | ------------------------------------------------------------ | -------------------------- |
| 原已发布卡点击一次       | prompt 精确匹配，当前插件 mention=1、ID 匹配                 | 点击前后完整 status 相等   |
| 原设置关闭同一 User 插件 | pending 结束，User scope、有效开关 off；原 Back 后设置页卸载 | 设置动作与卡片点击分开归因 |
| 原同卡再次点击一次       | 同 workspace 新草稿，原 prompt 精确匹配，mention=0           | 点击前后完整 status 相等   |

两阶段共八个业务点击，没有业务重试。安装期间测试源仅收到一次 metadata GET 与一次 ZIP GET；两个卡片点击前后均保持该计数，未触发安装、市场刷新或恢复启用。最终 console error 和 script exception 均为 0。

初始化为 2 次受控模型请求、2 笔账本、2 条 Trace、24 input/20 output Token、44 Credit。最终模型次数、账本/Trace 的完整 ID 集合、Token 和 Credit 均相同；Native 本轮所有增量为 0。

## 来源与测试层修正

运行 HEAD 为 `545e8c76c7d983039deca1dcb2307127b09cd544`，正常构建来源仍为 `cd0127ad1af132978715d2631c09e9895d4c9e72`。客户端 7,332 个 tracked 来源、完整 6,631 个 Desktop 文件与 CLI/stage `03adc56b…` 绑定原正常产物；本轮没有改产品或夹具 Source，没有重复构建。总来源锁为 7,407 项：客户端 7,332、Root 69、公开依赖 6。

先行规格为 [G04j 合同](client-native-installed-plugin-suggestion-spec-2026-10-19.md)。六项固定动作/owner/CDP/计数合同、四项真实 loopback/命令行包服务合同通过。独审另发现 BH 退出判断把查询异常当作已退出，R2 已改为仅 `rc1 + stdout空 + stderr空` 视为消失；实际反例 RED→1/1 GREEN。原 v1 只准备、没有运行业务，seal 保留；R2 没有重跑不相关测试或放宽业务断言。

本项使用正常 email API 和生产加密 store 恢复受控企业成员，不重做 G04h 空身份登录。原推荐卡在点击时调用同 Native Host/CLI 的 workspace catalog，原 Composer 消费结构化 mention；没有注入 React/store、业务 RPC 或身份。测试仅验证本轮 installedOnly 绑定与禁用后的新选择，不声称既有 session 热禁用、同挂载组件迟到结果或任意插件兼容性。

## 收尾与验收边界

Main 与工作区副实例原退出 code0；BH 和包服务原工具均 exit0，43 个登记异步 helper 工具均 exit0。同步 handoff 返回固定拒绝，保留其不确定性，未据此宣称资源已闭合，也未继续读私有根排查原因。

本项 Common 默认 close 会递归删除根，因此始终未调用 close/EOF/INT/TERM。Root 独立复核 Common 的 PID/PPID/birth/cwd、三监听及本轮数据库的内核 FD 元数据，再核直属 esbuild helper；仅精确 SIGKILL Common，helper 随管道关闭自行退出。Common 原工具实际 exit1。Root 核对六个已知 PID 不存在、五个 TCP 端口拒连、BH socket 连接关闭；handoff 后未 read/stat 根或查询未知 FD holder，创建为 0700 的私有根保留，不推断零写者。

主后台 PID42125 未重启、部署、管理员登录或模型调用；2026-10-18 22:53:27.844 UTC 的 health、首页及 JS/CSS 均 200，九张业务表和四个部署资源哈希不变。

本轮[公开 manifest](../evidence/client-native-installed-plugin-suggestion-20261019/manifest.json)为 98 个文件、49,432 字节，SHA `62705f050a6ab64da7d4926332ec387d9eb612d74390fff510cf999ed3827967`；Root 全部逐 SHA 核对，独立复核八份业务 journal 与实际 UI 收据。实际 UI、前后计量、每卡 HTTP 与资源独核在 `evidence/client-installed-plugin-suggestion-root-review-20261019/` 的 `business-independent.json`、`owned-resources-independent.json`、`final-public-independent.json` 和 `main-after-g04j.json`。原 electron 日志、原始 experience 快照、R/BH 私有数据不纳入公开 seal。

真实企微、外部 MCP、网盘继续排除；官方市场、任意插件代码、OS 选择器/剪贴板/默认外链、签名安装与 Windows/Linux 目标按各自边界保留。整体 U02–U05 及 T13 不由本项单独关闭。
