# 自动操作拒绝原始记录与续测

2026-10-21复核原始会话记录。此前多次以“自动操作策略”概括全部剩余工作，缺少原始调用定位，范围过大；本报告更正该结论。策略错误本身不能通过修改UWork代码解除，也不能由它推断所有其他源码联动不可测。

## 企微页面：Computer Use URL拒绝

2026-10-20 16:54:47（北京时间），实际调用是 `mcp__cua_repl.js`，代码 `let chromeApp = await cua.getApp('Google Chrome');`，目的是检查企微登录涉及的浏览器原生提示。工具原文：

> This session has been stopped because Computer Use is not allowed on the current browser URL. Stop your work and send a final message noting why the session has been ended. Note that Computer Use is not allowed on this URL even if the user navigates to it themselves.

此前browser-harness正在读取 `login.work.weixin.qq.com` 登录页；但CUA拒绝响应没有返回其实际检查的完整URL，不能声称已精确定位到哪个URL参数或OAuth动作。该记录不是企微API返回值，也不是UWork服务拒绝。原始凭据、state、code未复制进诊断。

原记录定位与原文：[提取收据](../evidence/prepublish-policy-investigation-20261021/wecom-native-browser.json)，含原session文件名、行号、tool call ID及记录SHA。原拒绝页面未换工具重试。真实企微目录API、独立副本两次同步、正式管理页面及Vite源码页面的已通过结果仍有效。

## 远程探针：平台回合级cyber_policy

2026-10-17 17:43:16，原session的 `task_complete.error.codex_error_info` 为 `cyber_policy`。原报错首句：

> This content was flagged for possible cybersecurity risk.

最后一个工具调用是轮询 `session_id=94554`。此前启动的命令是Node24运行 `scripts/client-remote-docker-live-smoke.ts` 的RED综合探针，该进程已启动并输出认证日志；脚本范围包含自有Docker远程工作区的个人Provider修改、Git提交、任务与Shell检查。平台在回合完成事件里返回上述分类错误。

因此准确结论是“包含这些操作的综合探针回合被平台中止”；没有原始证据说明某个Provider `apply` RPC单独被拒绝，也没有exec启动前审批拒绝。原始错误没有给出命中特征或具体RPC，不能进一步猜测。提取收据包含完整原错误及最后调用/已启动进程来源：[原始收据](../evidence/prepublish-policy-investigation-20261021/remote-broad-probe.json)。

当前远程目录UI确实先等待initial Provider同步才发布renderer attachment，但这是源码依赖关系，不能反推为历史分类器的精确拒绝原因。本轮没有重跑该综合探针或改写Provider同步屏障。独立的已有File/System普通远程生命周期通过证据也不受此错误否定。

## 已定位的真实设施故障

历史remote-selector v8的实际结果为 `FirstRunUiError: FIRST_RUN_PHASE_FAILED_RAW_DETAILS_WITHHELD`，尚未进入SSH；它不是cyber_policy。其原因被夹具的统一异常改写吞掉，无法从历史数据追溯恢复。

已为原FirstRun夹具保留固定阶段/原准入原因码/异常类别，继续隐藏异常原文；失败后仍停止输入、不重试已claim动作。新3项回归先失败再通过；原13项在Node24下通过。首次原相关测试误用了当前系统Node25，版本断言失败已保留，不能算产品失败。规格见 [FirstRun诊断](native-first-run-diagnostics-spec-2026-10-21.md)。

另一个新队列续测v21在夹具ready前超过原60秒，未启动客户端。实际生成目录含1146个带数字后缀重复图标，正常Desktop源码bundle重建后剩1146个正规图标且重复项0。重复文件是否是唯一超时原因未证明；单文件read/clone/plain复制均通过，不据此声称APFS或产品故障已根治。v21失败保留，2个进程及3端口均已关闭，自有根确认无打开FD后删除。后续使用全新profile与原预算复测。

## 继续执行范围

在原本机未打包共享UI、Main/Host/CLI和真实后台上新增队列撤回编辑及已有草稿冲突场景，实际请求/账务/历史/另一成员隔离共同验收。规格见[队列编辑](prepublish-queue-edit-spec-2026-10-21.md)。这条本地消费者不依赖上述企微页面或远端综合探针。

编译后的多系统客户端、外部MCP和网盘继续按用户范围排除；未实现的云/手机入口保留实现边界，不能用模拟对象计为真实通过。整体覆盖仍以具名真实链路为准。

续测最终结果：v24原队列草稿冲突/撤回编辑/物理拖拽排序/reload/实际A→E→D执行及CLI历史、4笔88Credit和另一成员隔离通过，4端口与自有资源关闭。详见[队列续测报告](prepublish-queue-edit-test-2026-10-21.md)。

继续补测：v26原Stop/暂停队列/reload/Resume及实际A→C/CLI持久顺序通过；取消A为原reserved等额uncertain，C与标题2笔settled/44Credit，另一成员保持。详见[停止恢复报告](prepublish-queue-pause-test-2026-10-21.md)。
