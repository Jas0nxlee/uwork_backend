# Mac x64：原10秒副实例固定阶段诊断

2026-10-21 fresh v6实际结果为FAILED：原openWorkspace副实例未在原10秒期限内自然退出，被原夹具SIGKILL。此次已取得主/副PID出生与x64映射、原开始/退出事件及完整四阶段；不是profile前置或新诊断handler失败。清理成功不覆盖原命令失败，也没有产品修复结论。

- [原result](../evidence/client-native-packaged-macos-clock-x64-startup-v6-20261021/result.json)
- [主file target诊断就绪收据](../evidence/client-native-packaged-macos-clock-x64-startup-v6-20261021/primary-readiness.json)
- [资源独核](../evidence/client-native-packaged-macos-clock-x64-startup-v6-20261021/owned-independent-closure.json)
- [冻结计划](../data/sandbox-verification/client-native-packaged-macos-clock-x64-startup-v6-20261021/preparation.json)
- [诊断范围](client-macos-x64-secondary-diagnostic-scope-2026-10-21.md)

## 固定边界

同一正常v9 x64原包与d0a四阶段日志，manifest SHA `767ad9e77e3c8afb755d31d041c61d6baa5543e11545b2e0090c0e9a87494468`，未重建App、CDF或改变fuses。profile `client-native-packaged-macos-clock-x64-startup-v6-20261021`、plan SHA `533848cd31a7ea210a42bcc5f28cdf2305a9e7432f51a5156e99b5ba0c284bac`，40源冻结。

普通primary，无inspect/CPU采样/BH/业务UI。primary显式private user-data-dir与原env同root，未碰个人默认profile。仅为诊断将主file target前置最多等60秒，旧30秒helper/输入未改；此处不算原30秒验收。case120秒、全部工作deadline-20秒，副实例前至少剩20秒；原1c函数、10000ms定时器、2秒回收、stdio ignore、argv/cwd/环境与primary检查均逐字保持，原命令只执行一次。未点架构下载提示或工作区确认。

## 实际时间轴

主PID11205，birth `Wed Oct 21 02:33:45 2026`，真实x64 executable映射。原file target于诊断16.047秒取得，35次有限观察、唯一owned page/WS endpoint；每个HTTP动作前后（包括失败）核原Main出生、映射与127监听，没有连接或操作页面。

副PID11683，birth `Wed Oct 21 02:34:01 2026`，真实x64映射。同一原启动/退出event pair绑定primary11205和secondary11683。

| 原私有日志时间 | PID/阶段                      | 原字段                              |
| -------------- | ----------------------------- | ----------------------------------- |
| 02:33:51.661   | primary lock-request-start    | —                                   |
| 02:33:51.688   | primary lock-request-return   | acquired=true，elapsed11.180542ms   |
| 02:34:08.941   | secondary lock-request-start  | —                                   |
| 02:34:09.314   | secondary lock-request-return | acquired=false，elapsed347.897417ms |
| 02:34:09.346   | secondary-quit-start          | —                                   |
| 02:34:09.366   | secondary-quit-return         | elapsed3.752625ms                   |

之后原exit event为`code:null, signal:SIGKILL, timedOut:true, primaryStillExists:true`。原command保留`ProbeError: openWorkspace rejected: Owned workspace secondary failed`；observer没有替换它，工作线程已关闭。primary事后birth/映射仍相同。

可以明确：该次副实例在期限内到达锁API，原调用返回false；app.quit调用和返回也被真实记录。不能把这些字段当作业务ACK、原workspace已经切换或OS进程已经退出。birth仅秒级，不能由它精确算出quit之后剩余毫秒；冷加载与退出屏障的具体占用仍需单独原日志/源码分析。CPU v5的不同暂停/采样运行不能直接解释本次失败，更不足以据此修改产品退出行为、改app.exit或延长10秒。

## 账务与关闭

原raw inference POST与supplier始终2，为乙初始化两笔settled/44 Credit；当前甲operator保持0。current/other ledger、Trace、gateway完整行与请求摘要序列全部不变，没有业务prompt或新计费。

controller exit1表示命令失败；fixture自然exit0、cleanup errors为空。case实际31.290043秒，8个known PID与4个TCP端口独立确认关闭，OS协议恢复、clipboard未使用，40源SHA前后稳定，私有root保留。正常后台PID92288和VM未触碰；没有自动重试或继续下一case。

原7项业务仍未执行，本例也不把16.047秒的独立target前置写成原30秒完整流程已过。后续最小定位应围绕未持锁secondary的quit/ready/退出屏障，以同一原包和原期限证据验证；目前仍无足够因果证据宣布产品修复方案。
