# 原队列停止、刷新暂停与恢复

本轮使用独立未打包Main/Host/共享UI/CLI及真实后台、本机受控供应商。v25原Stop→暂停队列→刷新仍暂停→原Resume→C执行及归档删除尾段通过；随后强化实际stream输入及CLI用户顺序直接断言，使用新v26重新验收，最终结果以该轮文件为准。

在A在途、C已排队时，原Stop取消A后显示暂停和恢复控件。两次后台快照（含一次页面刷新）均为3次supplier调用，C没有进入供应商；A从reserved变uncertain，amount等于同id停止前的reserved。点击原Resume后，C才执行，另一成员原两笔账本全行保持。

v25实际A保守预留52426Credit，取消后uncertain金额仍52426；C和标题各22Credit settled。该合同不将中断视作免费，不把保守预留当作供应商已确认账单。后端原 `Entitlements.uncertain` 是计量所有者，UI和测试均不改写金额。

核验范围：实际stream last user必须A/C且只有两条，CLI用户消息也必须A/C；总modelCalls从2到5（含另一成员初始化2），本人一笔uncertain和两笔settled。归档/删除取消/确认/reload保留原4条CLI消息及parts，新增计费为0。未修改产品TypeScript行为，测试只新增只读reserved数值投影及原UI消费者。

[规格](prepublish-queue-pause-spec-2026-10-21.md)、[v25原完整结果](../evidence/client-native-prepublish-v25-20261021/result.json)、[v25独立账务和清理复核](../evidence/client-native-prepublish-v25-20261021/independent-final-verification.json)。[v26最终完整结果](../evidence/client-native-prepublish-v26-20261021/result.json)、[v26 CLI输入顺序](../evidence/client-native-prepublish-v26-20261021/queue-executed-inputs.json)、[v26独立核验](../evidence/client-native-prepublish-v26-20261021/independent-final-verification.json)均通过，包含直接A/C顺序断言、本人2笔settled/44Credit及原A uncertain预留保持；4端口、fixture根及BH daemon/socket/根全部关闭。

复跑：新profile下 `PREPUBLISH_QUEUE_PAUSE=1 python3 scripts/tests/prepublish-ui-probe.py client-native-prepublish-v数字-20261021`。原240秒预算、严格目标守卫、真实传输取消与清理均保持。外部MCP、网盘、发布安装包及原受拒页面/远端综合探针未参与。
