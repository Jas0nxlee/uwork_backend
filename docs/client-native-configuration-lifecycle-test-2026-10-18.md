# Native 配置超时、退出取消与文件引用联测

2026-10-18。本轮在独立后台、真实 Electron Main 和原 CDP target 中通过指定联动：文件预览、添加与移除引用保留非空草稿；已发布商店排序在读取超时后清除，恢复读取后重新生效；正常退出登录关闭在途读取，恢复传输后旧排序没有重新出现。未调用真实企微、外部 MCP、网盘或付费模型。

## 实际操作与结果

| 场景     | 实收结果                                                                                                                                                                                                                                                    |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 文件预览 | 正式第二实例打开自有 Git 工作区，原 Main/target 保持。聚焦实际文件树行并按 Enter，正常预览两行文本。输入文件是夹具建立的 63 字节文本，不将其记为产品创建文件。                                                                                              |
| 文件引用 | 正常右键“添加到聊天”生成唯一 `dropped-file:OWNED_CONTEXT.txt` 引用，原 `NATIVE_CONTEXT_DRAFT_KEEP` 草稿仍在。真实 48 组 ArrowRight 到尾、1 组 Backspace 移除引用，正文保留，允许自然尾空白。文件 SHA、600 权限和非 symlink 状态前后一致。                   |
| 发布排序 | 保存实际公开分类的默认二项顺序 D，通过正常管理 API 发布反向 P，普通刷新后直接 DOM 显示 P。后台插件配置保持 v2，desktop 安全关闭配置创建独占 marker M=1。                                                                                                    |
| 读取超时 | 同页正常刷新后，观察器由 44 条完整记录变为第 45 条 pending，后台新增 configuration 200，UI 仍是 P。随后同页显示 D；45/46 两条记录分别约 9,994/9,996ms 未交付，原 Host TLS 连接已更换。                                                                      |
| 恢复     | 恢复传输并普通刷新，UI 重新显示 P，48–52 新记录完整 sent/M=1，pending 收口为 0，后台 P 没有改变。                                                                                                                                                           |
| 退出取消 | 新读取 53 pending 时 UI 仍为 P。正常身份菜单退出，动作结束在该请求 TLS 入口之后 1,575ms；未交付事件发生在实际退出输入区间内。原 Host 的该 TLS 四元组由存在变为不存在，pending 归零。恢复传输后 63 次观测、31,570ms 内保持 signed-out、商店 D，无旧 P 回灌。 |

引用路径由实际绝对文件行 TID、当前工作区 chip 与唯一同工作区相对 mention ID 联合核对；DOM 没有绝对 mention 路径字段。本轮没有发送聊天，不证明文件正文进入了模型，也不替代文件权限撤销竞态或 builtin Read 验收。

超时结果包含正常 presentation scope 失效，不独立归因于 hook.catch，不声称保持同一 scope。私有期限为源码配置的 10 秒，计时早于服务端 TLS 入口；上述耗时是实际入口至事件记录的时长。观察 31,570ms 不等于独立捕获了某一次 timer RPC。

## 交付、用量与网络证据

11 份阶段快照逐字段比较模型请求和现有快照的账本行，均保持初始化的 2 次本机受控请求、2 笔 settled、合计 44 内部测试 Credit；Native 增量为 0。该数值不是供应商费用对账。

最终观察器 53 条、pending=0、drop=0，未达到 128 上限。其中 50 条完整 sent，另 3 条为原样 `invalid_metadata / replyStatus:null / downstreamFinished:false`，不能写成 HTTP500、完整成功晚到或旧成功响应被 UI 拒绝。现有观察器只投影 desktop，M=1 是同次聚合响应的间接关联；没有直接插件版本或 order hash 的 Native 交付收据。后台 v2/hash 只证明发布事实。resume 的操作顺序有运行记录，不另声称独立取得精确 ack 时间戳。

本轮实际后台 configuration GET 200 为 53 次，旧 `/api/client/configs`、`/api/client/scenes` 均为 0。专用代理 15 个连接包含 5 个实际官方 CDN 四元组和 10 个已知公司目录拒绝，unknown/drop=0；公司 403 横幅保留。Renderer guard 两个 session、allowed=285、blocked=46、无溢出或 fatal；它只覆盖 Electron Session，不是 Host/CLI/OS 全局防火墙。AppSettings 两个代理字段保持 absent/空，自有 CA 路径保持原值。

## 候选、驱动与独立复核

沿用 [b6dcdc 候选](../evidence/client-catalog-custom-ca-root-20261018/artifacts.json)：101 源、6 产物，CLI/staged 为 `09a579b9deafefa4dcb41a05b9714294ff9a5650f3b0e10cc783b6ff6973ea81`。本轮没有修改业务源码、构建或 stage；四个 Desktop 产物未重建。原完整快照复制器实际复制 12,972 文件、242,740,447 字节、10 目录、0 symlink，逐项源/目标 receipt 与此前接受的完整树相同，未按旧清单筛选，也不据缓存耗时作性能结论。

准备 13 项纯测试、companion 7 项纯检查及离线分析器 3 项测试通过，均不作为业务场景数量。当前候选此前的完整类型/Lint/构建门禁结果保留原报告；本轮未重复构建，前后 124 项准备/依赖/源码/产物哈希均相同。两个独立离线复核分别确认 11 份用量快照、P/D 序列、实际退出时刻与未交付记录；Root 另外核对原 Host TLS 四元组消失、文件预览/引用/移除和清理后的真实进程/端口。

首次文件行点击中心位于视口外，保存原失败 PNG/AX/JSON 后另用正常 treeitem Enter 继续通过；不把它记为产品 RED，也没有确认 scroll/过渡是根因。清理表首稿中副实例的近似 birth 也保留原稿并纠正：只确认实际第二实例 exit0 和 PID 已退出，不声称捕获了它的 OS birth。冻结准备稿保留当时“未运行”状态，实际结果由运行证据补充，未回写历史。

## 清理与验收边界

Native 正常 stop、Electron exit0，代理正常 close/exit0 且全部资源为 0；BH 确认 clean shutdown、TCP/UNIX/PID 文件消失后移除专属目录。13 个已知自有 PID、5 个端口均关闭，Root 另行只读检查 PID 和实际拒连确认。

仅本次私有根仍有 8 个外部写 FD，故保留 700 权限。夹具核对原 PID/birth/PPID、DB FD、三个 listener 与无子进程后精准 SIGKILL，PTY 实收 exit1；不声称优雅 fixture close、数据根已删除或完整 desktop-traffic 已写出。未定向查询系统 PID 或向系统进程发信号；外部 FD 仅由本次根的 scoped lsof 取得，也未访问旧保留根。

主后台仍是 PID37266、health200，9 张业务表、原 7 静态资产及独占 admin 的 4 产物/10 源均保持原哈希；外部客户端仓库干净。本轮没有部署主后台或管理页。

证据入口：[本轮运行报告](../evidence/client-native-store-lifecycle-20261018/run-report.md)、[181 工件封存清单](../evidence/client-native-store-lifecycle-20261018/run-manifest.json)、[独立复算](../evidence/client-store-lifecycle-replay-20261018/replay-wQWCY1/analysis.json)、[Root 验收复核](../evidence/client-store-lifecycle-root-20261018/business-acceptance.json)、[Root 实际清理复核](../evidence/client-store-lifecycle-root-20261018/runtime-closure.json)。

分享范围仍待既有产品选择；用户本次选择补配置管理页不等于授权公开分享。手机目前无生产接入 caller，SSH/Docker 的企业执行授权尚未贯通，继续保留 T13d；不能把普通文件连接当企业远端执行验收。系统选择器、剪贴板、OS 外链唤起和三平台安装仍单列；[当前平台边界](../evidence/client-platform-boundary-refresh-20261018/report.md) 与[远端源码审查](../evidence/client-managed-remote-readonly-20261018/review.md) 是各自层次的证据，不是新增远端运行成功。U02/U03/U04/U05 不因本轮指定场景通过而整体关闭。
