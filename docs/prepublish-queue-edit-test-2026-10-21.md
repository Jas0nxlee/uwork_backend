# 队列撤回编辑、草稿冲突、拖拽排序真实联动

2026-10-21，未打包Main/Host/共享UI/CLI、真实后台HTTP/SQLite及本机受控供应商。最终 `client-native-prepublish-v24-20261021` 六项检查通过，供应商请求、CLI持久历史、账务及资源清理相互核对。

## 原始交互与结果

1. 原Composer发送A并由供应商暂挂；B入队后原按钮删除；C入队。本人只有A预留，另一成员原两笔结算保持。
2. 输入未发送草稿，点C的原编辑按钮，原冲突提示出现，草稿/C队列保持；请求和账本零增量。清空草稿再点编辑，原命令ACK后队列项消失，原Composer恢复C，改为D再入队。
3. 原Composer追加E；用原drag handle物理拖拽E到D前，原队列投影变成E/D；reload后仍为E/D，A在原CLI继续等待，供应商/账本零增量。
4. 释放A后，实际stream主请求的last user依次A/E/D，CLI三条用户消息也严格同序。原B/C及未发送草稿没有进入供应商请求。
5. 当前成员4笔settled/88 Credit（含标题sidecar），另一成员两笔基线全行保持；总modelCalls从2到6。后续原归档/删除取消/确认/reload尾段通过，6条CLI消息和parts摘要保持，未额外调用模型或计费。

[最终结果](../evidence/client-native-prepublish-v24-20261021/result.json)、[实际CLI顺序](../evidence/client-native-prepublish-v24-20261021/queue-executed-inputs.json)、[释放后请求与账本](../evidence/client-native-prepublish-v24-20261021/drained-queue-proof.json)、[独立资源/来源复核](../evidence/client-native-prepublish-v24-20261021/independent-final-verification.json)。供应商为本机受控测试服务，不等同付费模型质量或供应商最终账单。

只通过browser-harness原生CDP鼠标/键盘和只读DOM操作，不写React/store，不替换业务响应。CLI是队列/执行权威；测试证据不是仅依赖乐观DOM顺序。

## 设施失败与修复

- v21在fixture ready前超过原60秒，未进UI；2进程/3端口已关闭，自有根无FD后删除，原失败保留。原生成目录有1146个数字后缀重复图标；正常源码bundle重建后重复0。v22新snapshot验证6660文件/约139MB，copy423ms、total704ms；该前后证据不证明重复文件是唯一超时原因。
- v22已通过编辑撤回/重排前的原四项真实链路。
- v23在预期B入队时停止了A，原log明确为renderer `stop`、`source: button`；尚未进入排序。旧驱动没有输入回读和每个鼠标帧的目标复核，而原发送/停止控件共用位置。已增加精确草稿回读，并在press/release前复核原目标仍在同一坐标；目标变化即失败，不重试输入或误点新按钮。旧日志不足以唯一解释按钮为何改变，不将此称产品Stop缺陷。
- v24加上上述目标守卫、原冲突通知断言、实际主请求与CLI顺序及88Credit严格断言，完整通过；原240秒预算保持。

## 修复回归与清理

原FirstRun异常吞掉固定原因码的问题已修复，3项新测试RED→GREEN，当前原13项Node24回归通过；另以暂存内容和HEAD原测试独立验证，避免混入其他未提交改动。测试脚本Python AST及改动diff检查通过；正常Desktop源码bundle构建通过。未改产品TypeScript行为，本轮没有重跑此前309项后端单测来增加计数。

最终原Main自然exit0，fixture exit0、errors空。独立核4个自有TCP端口拒连、fixture根移除、browser-harness daemon退出/socket关闭；v22/v23/v24共3个自有BH临时根已清理。正常3000后台不在测试根内。

原始策略拒绝调查见[原始证据报告](prepublish-policy-investigation-2026-10-21.md)。这两条本地队列消费者已通过，真实企微OAuth及远端综合探针仍没有成功验收；不以本轮结果宣称全部功能覆盖。

复跑：`PREPUBLISH_QUEUE_EDIT=1 PREPUBLISH_QUEUE_REORDER=1 python3 scripts/tests/prepublish-ui-probe.py client-native-prepublish-v数字-20261021`，使用新profile。`PREPUBLISH_QUEUE_EDIT=1` 可独立运行编辑切片。
