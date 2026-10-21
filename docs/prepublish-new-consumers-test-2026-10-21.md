# 新增原页面消费者联动验收

2026-10-21，本轮按用户要求，只补尚无真实UI证据的独立消费者。未打包共享UI/Main/Host/CLI及原管理页面、原Fastify/SQLite/worker均实际运行；供应商是本机受控HTTP服务。未以受控供应商代证外部模型质量或真实供应商账单。企微OAuth和远程路径不作为这些本地测试的前置。

## 四类新增链路

| 消费者                             | 实际结果                                                                                                                                                                                                                                                                                                           | 具名证据                                                                                                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 队列原“立即发送”抢占               | A在途，X/Y排队，点Y立即发送；实际stream次序A→Y→X，CLI原用户历史同序，各一次。Y抢占后X自动继续，未进入手动暂停；reload历史/parts摘要和请求/账本保持。A原52424Credit预留等额uncertain，其余3笔settled/66Credit，另一成员全行保持。                                                                                   | [v27结果](../evidence/client-native-prepublish-v27-20261021/result.json)、[独立复核](../evidence/client-native-prepublish-v27-20261021/independent-verification.json) |
| 原管理端执行/详情/取消/操作日志    | 原企业智能体执行表单两次POST /runs202；原worker一次成功、一次在途，由原行取消POST200停止。原详情显示解密输入/输出或cancelled/CANCELLED，刷新终态保持；供应商连接实际关闭。操作日志原搜索runtime后3行与DB的两个enqueue/一个cancel一致。成功14Credit settled；取消502Credit原预留等额uncertain；只有两次供应商调用。 | [v3结果](../evidence/admin-run-ui-v3-20261021/result.json)                                                                                                            |
| 原页面创建数据集→发起评测→查看评分 | 原JSON表单写2个exact样本，原评测表单发起评测；原worker执行两次并产出2/2、passRate1。原表格/详情及reload显示一致，每个样本只收到一次供应商请求，2笔settled/28Credit；原SQLite样本和报告字段保持密文，原GET正确解密。                                                                                                | [v4结果](../evidence/admin-run-ui-v4-20261021/result.json)                                                                                                            |
| 原评测取消按钮联动两个子任务       | 独立cancel模式使2个样本请求都实际在途，再点原评测行取消；报告cancelled、两个子run均cancelled/CANCELLED、两个供应商连接都关闭。两笔各按原502/503Credit预留记uncertain，原日志2次runtime.cancel和1次evaluation.cancel一致；reload不生成评分、不新增请求。                                                            | [v5结果](../evidence/admin-run-ui-v5-20261021/result.json)                                                                                                            |

四类按消费者计数，不把引导/登录前置、重复状态观察或重跑数量相加。本轮未重复旧编辑、拖拽排序、停止恢复、归档删除尾段或旧309项后端全量用例。普通retryTurn在当前ConversationRowView明确不渲染普通重试入口，未虚构一个UI按钮来计覆盖。

所有操作经browser-harness原生鼠标/键盘；浏览器JS只读DOM，没有fetch替换、React/store写入或测试产品RPC。管理端controller准备仅通过真实HTTP建立合成模型/已发布智能体，UI POST和controller HTTP有不同来源记录。原定时worker推进执行/评测，未调用测试drain/tick。独立管理用例完全使用临时SQLite、随机Key和合成账号，不读取主.env/主库。

## 故障保留和设施修正

管理端v1已通过原执行、结果及取消页面，但整体失败：新驱动错把取消HTTP预期写为204；原src/runtime.ts合同是200/{ok:true}。按源码和实际请求改正测试预期，未改产品合同。新增TS脚本的profile可能undefined类型问题以显式入口断言修复。

v2在新操作日志消费者的过滤行断言失败；驱动没有等待新视图标题就复用通用搜索框，存在导航时序风险。加入新视图/导航就绪、输入精确回读，并被动记录实际audit查询参数和action。v3实际请求q=runtime、返回3条正确运行审计；旧v2没有捕获q，不能唯一断言其当时根因，更不能把该设施失败称产品缺陷。两轮失败及资源清理原样保留。

独立send-now复核起初假定模型正文必须是裸Y，触发额外验证断言；源码formatIncomingMessage表明抢占项采用原user_steer/system-reminder呈现。已用原纯formatter对实际完整Y载荷逐字核验，CLI仍保存裸用户文本，A/Y/X次序不变。[呈现层复核](../evidence/client-native-prepublish-v27-20261021/presentation-verification.json)。没有为这个错误假设重跑已经通过的UI。

本轮未发现这四类链路的新产品业务缺陷；已修正上述测试设施假设和准备条件。

## 门禁与资源

新增TS脚本通过仓库严格typecheck与定向ESLint；新增Python脚本AST检查、改动diff及自有文档/TS格式通过。代码评审按正确性、可读性、架构、安全、性能核对：业务仍由原UI/Runtime/Gateway/Vault/worker所有者处理；没有新依赖或公开接口，没有修改产品权限/超时/结算规则；测试等待及资源清理有界。类型检查用于验证新增脚本，不作为重复功能覆盖。

v27正常fixture/Main退出，4个独立TCP端口拒连、fixture与BH根移除；另一成员账本全行保持。管理端各轮Chrome/BH的原PID和birth核验均已退出、CDP关闭，backend/provider关闭且临时根删除。[独立收尾](../evidence/prepublish-continuation-20261021/admin-new-consumers-independent.json)。测试进程终态已核，不以发送信号代替关闭证明。

复跑新消费者：

- 队列立即发送：`python3 scripts/tests/prepublish-send-now-probe.py client-native-prepublish-v数字-20261021`。
- 管理端运行与日志：Node24下 `node --import tsx scripts/tests/admin-run-ui.ts admin-run-ui-v数字-20261021`。
- 页面评测成功：同命令加 `UWORK_ADMIN_UI_CASE=evaluation`。
- 页面评测聚合取消：同命令加 `UWORK_ADMIN_UI_CASE=evaluation-cancel`。

每次都必须使用不存在的新profile。当前目标仍不能据这四类通过宣称全部功能覆盖；这里只关闭上述原可达消费者的真实联动缺口。
