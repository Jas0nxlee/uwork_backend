# 发布前历史编辑、分支和后继模型消费

v33在当前未打包Main/Host/UI/CLI与真实隔离HTTP/SQLite完成13个原界面动作。未执行旧队列、反馈、侧栏或批量删除流程，不跑发布后的系统客户端；引导和父会话初始问答只作为本case必要前置，不重计为新独立覆盖。只调用本机受控供应商，无外部MCP、网盘、企微或受拒远程。

## 实际行为

| 阶段                        | 当前成员settled / Credit | 新供应商请求 | 真实结果                                                                                  |
| --------------------------- | ------------------------ | -----------: | ----------------------------------------------------------------------------------------- |
| 原Composer A及自然标题完成  | 2 / 44                   |            2 | canonical为A和唯一新回复                                                                  |
| 原历史编辑取消              | 2 / 44                   |            0 | CLI session/messages/parts原始摘要不变，完整账本/供应商请求逐字不变                       |
| 原preserve编辑为E并提交     | 3 / 66                   |     1 stream | 同一session；canonical只剩E及新回复；物理旧历史保留，共4条而active2                       |
| 原E回复footer精确Fork       | 3 / 66                   |            0 | 原异步ACK切到不同child，parent_id及task_type=fork正确，继承编辑后语义前缀，ID由原映射重建 |
| child原Composer B           | 4 / 88                   |     1 stream | 真实供应商上下文含E、新回复和B，排除A及旧回复；无额外title                                |
| 原父回看、child回看及reload | 4 / 88                   |            0 | 父仍E；child恢复原历史，未重放模型或修改账本                                              |

完整新请求恰4，含A/E/B三次stream及A的一次自然标题；fixture另一成员的原2笔完整ledger行逐行保持，所有先前账本行都保留原值。生产codecs与canonical active-branch selector读取真实只读SQLite，不用物理历史总行数冒充active分支。child有合法fork notice/timeline及额外空文本assistant结构项，验收精确问答语义和一次性唯一marker，不错误要求物理行数为6；独立复核确认E/B各唯一user和assistant。

没有直接发edit/fork Runtime命令、浏览器fetch或store写入。fork按钮通过正文row id匹配同turn footer；child等待谓词同时排除parent id，未通过控制器代导航child。原Fork可修复父productTurnId anchor，因此父不变按原active语义验证，后继子会话执行后的父语义与fork合法准备完成时逐字保持。

## 失败与实际修复范围

- 初次v27选到既有profile，独占mkdir拒绝，未启动/覆盖原证据；日志保留。
- v30在任何listener/Main启动前，由来源校验拒绝旧owned-admin snapshot（forms.tsx已不同），原退出1。新增正常Vite专用构建器：空env、全22源输入构建前后hash一致、新4静态文件验证、旧manifest备份、原admin/dist逐文件保持；保留原校验，没有直接修改hash求绿。其后夹具原校验接受新快照。
- v31原60秒ready预算耗尽，复制现场Node仍活着且打开重复后缀CMap文件，原30秒退出等待也失败。源Desktop/out有13443文件/6780重复后缀，实际依赖CMap169/重复0。Node随后已退出，独立核对3端口拒连、无开放FD后删除私有根。正常build:no-runtime-assets重新生成6663文件/重复0，未改copy准入、并发或等待预算；不把重复文件武断认定为底层IO停滞唯一原因。
- v32已产生A及标题两次真实请求，但受控供应商的原stream分支仍固定发两段旧文本，新增marker只进output变量、未进入SSE；等待marker失败，原客户端退出0及完整清理通过。仅修本测试供应商的history分支SSE文本，不改产品或断言。v33首次完整新生命周期通过。

上述为构建/测试设施问题，本轮未发现需要修改产品源码的历史编辑/分支缺陷。旧失败status和cleanupError未改写为通过；v30/v31用独立资源收据补充自动回收结果。

## 门禁、资源与证据

正常专用Vite构建、未打包Desktop正常bundle构建exit0；相关MJS eslint/Prettier、Python AST及diff空白检查通过。原旧queue body及finally用AST独立对照确认语义未改；未重跑旧通过业务或全套测试。源生产selector/codecs实际导入及真实DB读取成功。没有client产品源码变更。

v33夹具exit0，Main/Host/CLI经原关闭路径回收；独立核对4端口均ECONNREFUSED、记录的Electron PID已不存在、私有根已删除、原cleanup.errors为空。供应商请求/全部ledger字段/父子canonical由独立读取复核，不仅依赖驱动的passed文案。

- [v33原结果](../evidence/client-native-prepublish-v33-20261021/result.json)
- [独立最终复核](../evidence/prepublish-continuation-20261021/history-edit-fork-final-verification.json)
- [实际完整供应商请求](../evidence/client-native-prepublish-v33-20261021/desktop-traffic.json)
- [编辑后canonical](../evidence/client-native-prepublish-v33-20261021/history-edited-canonical.json) / [child完成canonical](../evidence/client-native-prepublish-v33-20261021/history-child-completed-canonical.json)
- [旧流程AST不变](../evidence/prepublish-continuation-20261021/history-fixture-legacy-ast-verification.json)
- [专用管理端正常构建](../evidence/prepublish-continuation-20261021/history-owned-admin-refresh.log) / [Desktop正常构建](../evidence/prepublish-continuation-20261021/history-desktop-refresh.log) / [重复项对照](../evidence/prepublish-continuation-20261021/history-desktop-refresh-verification.json)
- [v30清理](../evidence/prepublish-continuation-20261021/history-v30-bootstrap-cleanup.json) / [v31清理](../evidence/prepublish-continuation-20261021/history-v31-bootstrap-cleanup.json)
- [Lint](../evidence/prepublish-continuation-20261021/history-fixtures-final-lint.log) / [格式](../evidence/prepublish-continuation-20261021/history-fixtures-final-format.log)

复跑新profile使用`PREPUBLISH_HISTORY=1 python3 scripts/tests/prepublish-ui-probe.py client-native-prepublish-v数字-20261021`。若专用admin来源过期，先运行`node scripts/build-owned-admin.mjs`按正常构建更新，不关闭校验。本case只测preserve编辑，独立文件回滚按钮未由此关闭；目标保持active。
