# Mac ARM64：同模型工具能力配置往返一致性

2026-10-21实际Native通过8项：保留原Mac clock 7项，增加同一model ID的`supportsTools true→false→true`、原UI手动同步、两次原UI新任务及真实请求/计量核对。Root独核33项、coverage独核48项通过。未更改产品实现、未重建已封存v10，也没有把既有task热迁移列为本例已验。

- [原result](../evidence/client-native-packaged-macos-clock-arm64-capability-v1-20261021/result.json)
- [coverage48项](../evidence/client-native-packaged-macos-clock-arm64-capability-v1-20261021/coverage-independent-verdict.json)
- [Root33项](../evidence/client-native-packaged-macos-clock-arm64-capability-v1-20261021/root-independent-verdict.json)
- [独立资源收口](../evidence/client-native-packaged-macos-clock-arm64-capability-v1-20261021/owned-independent-closure.json)
- 三阶段原收据位于同目录`capability-warm-proof.json`、`capability-tools-off-proof.json`、`capability-tools-on-proof.json`及两份`capability-change-*.json`。

## 固定输入与真实范围

正常ARM64 v10原包/manifest SHA仍为`5f88bd045a31e535215b603933da2d4940fad70f37b7e66aa50b0f6be169c475`，source `d0a5f374`、Agent `cdf781ec…`、9项运行资源/12个ARM64原生文件/严格签名。fresh profile是`client-native-packaged-macos-clock-arm64-capability-v1-20261021`，plan SHA`e922cc824e371005a35b4ecae5c91630234f3f6bd2eaa6718e4cb9ffb1bc9d4a`，34个源冻结；原工作区子进程函数1c/stdio ignore/10秒期限保持。

使用隔离真实后端与受控supplier。当前企业用户甲实际role是operator，用户乙是同tenant另一department的member；两者账务逐行隔离。受控模型contextWindow500000经原Admin输入/回读，原gateway guard和工具定义没有删改，不将此例泛化为所有128k模型适配已通过。

## 同ID配置与原UI同步

唯一model ID `b959709f204b5fd793798bbf2a3699dc`，revision实为1→2→3。每次使用原Admin GET→含revision的完整PUT→GET，严格只改变supportsTools、revision及正常更新时间；其它原resource内容摘要两次均为`fd3414c1…`。没有新建、复制模型或更换名字/凭据/endpoint/定价/scope来求成功。

每次实际点击原`enterprise-identity-sync-gateway`，同时等待三条独立事实：

1. 新的原`GET /v1/models`真实200收据包含同ID的新supports_tools值；false为sequence3，恢复true为sequence4，均越过本次修改前fence。
2. 本case私有`provider_config.json`同ID原rule的`properties.supportsToolCall`分别为false/true；`ucas-gateway.json`的lastSyncedAt前进。
3. 原Main转发的compact Host日志出现新的`UCAS gateway provisioning synced`、reason manual，完成计数0→1→2；未把下拉菜单关闭当成功，也未重复计算Host/转发两份同事件。

然后点击原`enterprise-menu-chat`，确认当前workspace的interactive draft、同model/none reasoning，再由原Composer发送。新task分别为`sess_08a5ea90-73b1-451b-bd65-96ff35fd7c83`与`sess_1cfda876-e52f-4120-a488-58f308ba964b`，均排除此前task ID。

draft UI工作区显示`packaged-workspace`；post-send的`uiTask.workspace`实际为null，因为该字段仅查draft trigger，不把null说成运行态DOM显示了绝对路径。相同绝对workspace由原draft归属和每次真实主请求system的精确working-directory行证明。没有要求换CLI PID，也没有称旧task已热迁移。

## 主请求与标题sidecar分开核验

| 阶段               | 实际supplier主请求index | 主tools / tool_choice | 标题index | actual主请求结果 |
| ------------------ | ----------------------- | --------------------- | --------- | ---------------- |
| 原warm true        | 2                       | 32 / auto             | 3         | 原UI完成，200    |
| false，新task      | 4                       | 两个属性均缺省        | 5         | 原UI完成，200    |
| 恢复true，再新task | 6                       | 32 / auto             | 7         | 原UI完成，200    |

主请求必须stream=true、原system含本case的精确`Primary working directory`、user含本阶段marker、role/shape匹配，且不属于标题system。三次主system均6958B、SHA`d262d88d…`。标题是独立997B system，SHA`d3d0746e…`，stream=false、roles system/user、始终没有tools/tool_choice。

标题也可能包含prompt marker，所以不能挑标题无tools冒称false配置生效。本例强核的是index4主请求两个属性均**不存在**，不只是数组长度0；恢复index6再次出现32工具构成正对照。请求均走同受控upstream model controlled，后台账务model_id始终为同原模型。此例验证传送工具定义的能力开关，未执行真实工具调用。

## 请求、计费与原断言

| 事实                         |   warm | false完成 | 恢复true完成 |
| ---------------------------- | -----: | --------: | -----------: |
| 原Node实际inference POST入站 |      4 |         6 |            8 |
| supplier调用/请求总数        |      4 |         6 |            8 |
| 当前operator settled笔数     |      2 |         4 |            6 |
| 当前Credit                   |     44 |        88 |          132 |
| 当前input/output tokens      |  24/20 |     48/40 |        72/60 |
| 另一member                   | 2笔/44 |  原行不变 |     原行不变 |

总请求数含初始另一member的2次seed。每个新增task准确新增主+标题2次，2条settled ledger、2条succeeded Trace、2个有结果的gateway key，合44 Credit/24 input/20 output；旧行和另一成员全字段保持。ledger与gateway按真实request_key摘要关联；Trace原schema无该FK，只做actor/model/application集合和token核对，不伪造主/标题到Trace的逐请求外键。

原warm阶段2/44断言先独立完成。两个新task各自验证后，delivered才自然更新为6/132，随后原seat拒绝、UI logout和注销态cold-start继续按新已证快照严格零增；没有删除或降低原7项。后面的被拒POST属于原seat步骤，不混入三个能力阶段的4/6/8成功入站。

## 收口与未覆盖范围

exec33619正常返回0，fixture0、cleanup errors=[]。18个已知PID与2个BH daemon共20PID当前全无，4个专用端口关闭；私有0700 BH root的残留socket节点拒绝连接，不声称已删除。协议关联恢复、未用系统剪贴板且内容保持，34源未变。未触碰原常驻后端PID92288、个人浏览器，未启动VM。

本例不是旧task热更新、不是重新认证验收，也不覆盖Windows、真实企微浏览器OAuth、外部MCP或网盘。仍登录task冷恢复由另一独立case验收；成员禁用后重新认证等缺口继续由Root单列，不能因这次8项通过宣称Mac所有功能或全平台全绿。
