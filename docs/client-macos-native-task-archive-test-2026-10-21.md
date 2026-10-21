# macOS ARM64 同任务归档、恢复与 reload 验收

实际结果 **8/8 PASS，27.075033 秒，fixture exit=0，cleanup errors=[]**。使用正常 ARM v15、产品提交 `500914dfe27f96d9db74381c6828244390413281`，冻结 plan `f1d0e1bd5b2bf1317608cda0b248ff32aa8d047cc0e4fe5491f262c0d6de7ce0` /180 源。Root 单次执行，本次 peer 仅只读复核，没有启动 App、发送模型请求或更改冻结输入。

[实际结果](../evidence/client-native-packaged-macos-clock-arm64-task-archive-v1-20261021/result.json)、[Root 独审](../evidence/client-native-packaged-macos-clock-arm64-task-archive-v1-20261021/root-independent-verdict.json)、[peer 独审](../evidence/client-native-packaged-macos-clock-arm64-task-archive-v1-20261021/peer-actual-verdict.json)与[可复现只读检查](../evidence/client-native-packaged-macos-clock-arm64-task-archive-v1-20261021/peer-actual-readonly-check.py)保留。

原 warm 五项后，唯一目标为 `sess_d3665bb8-fa67-4f36-8fce-76f8fc541d6d`。沿原 `task-archive-ID` 首击确认态、再击归档；归档视图只以唯一标题及完整 workspace 定位原行，原打开后实际 pane sessionId 再绑定同一 ID，随后点击原取消归档按钮，关闭归档视图、reload 并原行重开。没有新增产品 test-id、注入 DOM 属性或直接调用归档 service。

| 原实际阶段 | tasks-index archived | UI 与身份事实 |
| --- | ---: | --- |
| baseline | 0 | 正常行 1，原 task/session 已完成 |
| confirming | 0 | 原行确认标志为同 ID；尚未归档 |
| archived | 1 | 正常行消失，活动区转 draft |
| opened | 1 | 归档行 1；原打开后仍为同 session、原用户/助手正文 |
| restored | 0 | 归档行消失，仍显示同一会话 |
| reloaded | 0 | reload 后原正常行恢复并重开同 ID |

六份原固定 SELECT 收据的完整稳定语义相等，SHA256 为 `fc70ff0e47da7129f817b6d3357a02197aa7da2a7003490e5f9ddcbb25d4e94b`，包含 task-index 身份/model/mode、CLI session、全部原 message/part 和两项 runtime entries。原 CLI PID 94415、birth 与工作目录的前后 DB FD 绑定一致；私有 CLI DB 为本 case 的 `data/.zcode/cli/db/db.sqlite`，workspace 为本 case 的 `packaged-workspace`。持久 provider=`glm`、mode=`build`、model=`ucas/36e6fcaf4cd831d08e588a7bbeb7db01`、thought=`none` 保持原值；未将旧 provider 字段重解释为模型切换。

归档 owner 是原 Host tasks-index；CLI `session.time_archived` 六阶段及最终均为 null。这里验证的是 Host 归档标志和同一 CLI 历史保留，不声称 CLI 有独立归档镜像。只读最终数据库再次核对原 message/part/entry 逐字段保持、session/model/cwd 未替换、tasks-index archived=0/deleted=0。

两份保留的完整 raw `modelRequests` 逐项相等：另一成员 seed 两次，原 warm main/title 两次，合计仍为 **4**。六阶段的 full raw digest、supplier/原入口 raw inference POST 计数均保持 4。每阶段及最终双 actor 完整账务投影相等，当前成员 **2 settled/44 credits/24 input+20 output**，另一成员同为 **2/44/24+20**；最终只读 raw ledger、Trace、gateway rows 也吻合，无新增或旧行改写。无新增 security 配置或 enabled policy override，未为归档开启额外 filesystem 权限。

原 seat 拒绝、logout 和同 controller/profile 冷启动尾段保留。必须区分时点：reloaded 收据仍为原两条 user/assistant；其后原 seat 负例正常新增了一条拒绝输入和一条带 error 的 assistant，最终 Host `task_status=error`，不是归档流程失败或历史被改写。新行创建时间晚于 reloaded 收据，模型 raw 与账务仍零增；最终不宣称整个会话永远只有两条消息。

18 个 known PID 与另外两个 BH daemon 当前均 absent，原清理确认 4 个 TCP 端口关闭。两个 0700 BH 目录中的 `bu.sock` inode 可保留，当前 `lsof` 无 holder，原 daemon/socket 关闭收据均成立；不把关闭接口写成删除路径。OS protocol 已恢复、系统剪贴板未使用。180 源逐 SHA 稳定，复核后的 v15 strict loader、资源、签名、ASAR header 和原 fuse wire 通过。

本结果仅覆盖 macOS ARM64 的自有临时任务生命周期；没有单条/批量删除验收，不扩 Windows、Linux、远端 workspace、外部 MCP 或网络盘，也不证明其它 Memory 读取入口的权限安全。
