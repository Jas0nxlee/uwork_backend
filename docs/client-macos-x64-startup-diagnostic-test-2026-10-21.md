# Mac x64：正确profile后的启动诊断

2026-10-21单次原流程结果为FAILED：原30秒owned file-renderer就绪检查超时，0项业务检查、0个UI动作。没有运行到workspace副实例，不能据此关闭或归因历史10秒二实例超时；也不代表Mac x64联动已通过。本例没有重试、延长期限、采样或修改产品。

- [原result](../evidence/client-native-packaged-macos-clock-x64-startup-v2-20261021/result.json)
- [原运行时与就绪收据](../evidence/client-native-packaged-macos-clock-x64-startup-v2-20261021/x64-runtime-facts.json)
- [主实例固定阶段只读投影](../evidence/client-native-packaged-macos-clock-x64-startup-v2-20261021/readonly-primary-phase-observation.json)
- [独立资源收口](../evidence/client-native-packaged-macos-clock-x64-startup-v2-20261021/owned-independent-closure.json)
- [准确冻结计划](../data/sandbox-verification/client-native-packaged-macos-clock-x64-startup-v2-20261021/preparation.json)

## 本例只修正测试前置

旧startup-v1因不满足原clock profile前缀而在GUI前被拒，其历史输入保持不变。新profile为`client-native-packaged-macos-clock-x64-startup-v2-20261021`，plan SHA `9d98f603acdc080da44b41bd8d234805a65f92e26418764443ce25c76c73dae5`，26源冻结。

新增版本化薄入口只做四项：旧fixture一处profile regex、新parser一处PROFILE regex、旧probe两处fixture/parser路径。原源可完整逆替还原；原reader字段/私有文件归属守卫、observer失败不覆盖原command结果、原workspace函数1c、stdio ignore、10秒副实例期限和原7项断言均保持。准备时实际执行了原clock AST、新Node模块和新parser守卫正例及旧bad-prefix负例；defaultprepared与完整派生Python/ESM检查通过，未以仅检查wrapper语法代替。

继续使用同一正常v9 x64原包：source `d0a5f374`，manifest SHA `767ad9e77e3c8afb755d31d041c61d6baa5543e11545b2e0090c0e9a87494468`，原strict loader、8项资源、11个x64 native及严格签名均未改变。可选Swift helper仍真实缺失，不创建替代物或修改原fallback。本例为Apple Silicon上的Rosetta兼容运行，不是物理Intel Mac验收。

## 实际事实与未证原因

原Main PID97529的birth收据为`2026-10-21 01:48:36`，内核映射对应唯一冻结v9 x64 executable，Mach-O x86_64头核对通过。就绪守卫共93次观察；首样本0.105s监听尚不归该Main，末样本30.042s监听归属Main，但HTTP读取为TimeoutError、没有取得可选中的原file target。没有建立BH，后续CLI映射、PTY和原7项业务均未执行。

只读原私有Main文件得到该PID两个允许字段事件：

| 原日志时间   | 事件                | 原字段                                      |
| ------------ | ------------------- | ------------------------------------------- |
| 01:48:58.102 | lock-request-start  | 无payload                                   |
| 01:48:58.142 | lock-request-return | acquired=true，elapsedMs=19.904333000000406 |

该记录证明主实例此次取得锁，不能解释renderer为何未在30秒内就绪。birth为秒级记录，与首stage相差约22秒只作为时间轴事实；不把沉默、缺行、HTTP超时或该差值推成Rosetta、ACK、quit、网络、CPU或产品死锁根因。没有secondary-started/exit pair，因为原流程在attach前已经失败；不能伪造secondary阶段或声称10秒问题已复现。

私有原日志5084B、mode0644，位于本case私有祖先目录；只投影固定事件/phase/acquired/finite elapsed和时间，不复制原正文或把原文件说成0600。

## 关闭与剩余边界

controller原句柄exit1表示业务FAILED，fixture自然exit0、cleanup errors为空，不能把清理成功改成业务通过。6个known PID和4个TCP端口再次独立确认关闭；BH未启动，无待关闭的本caseBH daemon。原协议关联恢复、clipboard未使用，26源SHA不变，私有数据根保留。原Bob2笔/44 Credit初始化单列，本人0；本例没有发送业务prompt。正常后台PID92288、VM及其他用户应用未触碰。

下一步须根据保留证据单独批准最小诊断或修复；本报告没有授权后续GUI或更改预算。Windows计划仅离线归档、尚无授权Windows入口，与本例失败相互独立。
