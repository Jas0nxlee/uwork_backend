# 原工具拒绝、反馈与项目级授权冷恢复

本轮新增3类真实原页面消费者。使用当前未打包Main/Host/UI/CLI、真实隔离HTTP/SQLite、原Read/Write与本机受控供应商；后台文件权限发布和私有Git初始文件仅为前置。原拒绝/输入/确认/项目授权/再次提问全部走原Input，不写规则库或伪造Runtime响应，不重跑旧队列/Fork/文件回滚流程。

| 场景                  | 实际结果                                                                                                                                                                                                                                         | 当前成员计量                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| v39原rejectOnce后恢复 | 原拒绝Write，实际文件保持初始UTF8字节；CLI Write part为error；真实后继模型完整收到原用户拒绝说明（NOT written、STOP/wait）。原reload无重放。后续原问题再次弹审批，allowOnce后才由生产Write写B，证明不是永久拒绝。                                | A4笔88；B新增2，最终6笔132               |
| v40原可选拒绝反馈     | 空反馈焦点使原确认禁用；输入带外层空格、中文引号与内部换行的反馈后原确认。模型收到原buildPermissionDeniedContent(trimmedFeedback)逐字内容，CLI error保留反馈；文件不变、reload零增。                                                             | 4笔88                                    |
| v43原项目匹配授权     | 原allowAlways写入仅Write+精确file_path规则；停止/重启本case Main/Host/CLI，同profile原UI打开项目和原task，规则相同、零推理重放。同文件后续Read/Write免审批；另一个文件仍弹审批，原拒绝后该文件保持，规则没有扩为yolo或全工具授权。reload不重放。 | P4笔88；Q新增3共154；R新增3，最终10笔220 |

“拒绝工具”不代表此前模型调用零计费：Read、Write提议、后继拒绝回复及首个自然标题仍按实际固定usage结算。各profile另一成员2笔完整ledger行保持，所有旧行逐字段保留，均settled，无额外title/uncertain/重复请求。独立解析原供应商请求，stream user顺序分别A/A/A/B/B、F/F/F、P/P/P/Q/Q/Q/R/R/R。

项目规则经生产getProjectPermission只读读取，project_id从原session取得，冷前/冷后/跨路径拒绝/最终reload的JSON完全相同：allow仅一项toolName=Write、ruleContent为受控第一个文件绝对路径。旧workspace Agent PID92993退出code0之后，新workspace Agent PID93187才启动，最后也code0退出；不是只刷新Renderer冒充CLI冷恢复。原Main两代PID92825/93138均由launch事件记录并与直接捕获日志一致。

## 失败与处理

v41/v42整体failed，未改写为通过。两轮已实际执行P及规则落盘/冷恢复，Q后继场景因本机供应商断言不符合原Read合同而停：v41要求每次Read返回正文，但生产返回精确file_unchanged收据；v42修正此合同后，Q实际免审批写B成功，又在Q最终回执错误地检查写前A字节。当前严格区分Read时点与Write后时点，并要求真实P Write参数/成功结果、实际A/B文件字节共同成立，保留所有权限/模型次数/计费断言。没有修改产品、模拟Read成功或降低期望。

v43完整通过，旧失败后的Main/CLI/端口/私有根也已核对关闭。目标ESLint首次发现供应商一个未用初始常量，删除该无效变量后最终0错误，无规则关闭，未为此重复已通过UI流程。此前已通过v39/v40均保留执行源码摘要；v40共用文件从v39已冻结且在v40执行时未变的副本保留，未用后续新增项目分支冒充原执行源码。

## 资源与门禁

本轮未改client产品源码，无需重复此前全套类型/回归；目标MJS ESLint/Prettier、Node语法、3份Python AST通过，旧finally AST不变。复用正常构建后逐项校验的缓存（5087源输入/6663产物），没有新安装包或发布。无外部MCP/网盘/企微/远程调用。

PID核对补强：desktop-state.pid是fixture Node，native-runtime-info.pid可能被原openWorkspace副实例覆盖，不能当Primary Main。当前控制器保存launch事件的nativePids，独立复核从只连接Primary stdout的electron.log提取Main身份，并另核fixture、metadata emitter和workspace CLI；旧报告的兼容信息只作为额外观察。实际Primary/旧新CLI均不存在，4端口均拒连、cleanup.errors空、fixtureExit0、运行私有根删除；两套冷启browser-harness也沿原关闭路径回收。10个近期profile的PID/端口/根另有补充核对，未重跑业务。

- [独立最终请求/计量/规则/进程复核](../evidence/prepublish-continuation-20261021/permission-consumers-final-verification.json)
- [v39完整流程](../evidence/client-native-prepublish-v39-20261021/result.json) / [v40多行反馈](../evidence/client-native-prepublish-v40-20261021/result.json) / [v43冷恢复与范围](../evidence/client-native-prepublish-v43-20261021/result.json)
- [v43规则](../evidence/client-native-prepublish-v43-20261021/project-reloaded-rule.json) / [完整原始请求](../evidence/client-native-prepublish-v43-20261021/desktop-traffic.json)
- [v41失败](../evidence/client-native-prepublish-v41-20261021/result.json) / [v42失败](../evidence/client-native-prepublish-v42-20261021/result.json)
- [Primary PID补充审计](../evidence/prepublish-continuation-20261021/native-process-identity-audit-v2.json) / [finally保持](../evidence/prepublish-continuation-20261021/permission-legacy-cleanup-ast-verification.json)
- [最终Lint](../evidence/prepublish-continuation-20261021/permission-all-fixture-final-lint.log) / [格式](../evidence/prepublish-continuation-20261021/permission-all-fixture-format.log)

新profile以PREPUBLISH_PERMISSION_DENY=1运行拒绝/恢复；再加PREPUBLISH_PERMISSION_FEEDBACK=1仅运行反馈分支，不跑B。项目范围冷恢复用PREPUBLISH_PERMISSION_PROJECT=1独立运行。共同入口scripts/tests/prepublish-ui-probe.py，按正常owned-desktop构建输出设置UWORK_NATIVE_OUT_MANIFEST。审批消费者已新增完成，整体目标仍active。
