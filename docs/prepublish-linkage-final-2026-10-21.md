# 编译发布前联动补缺与最终核对

本轮新增六类管理页面消费者，修复Git重命名审阅，并再次运行真实企微API和Vite管理页面。当前菜单25页、配置11标签已对照具名结果；这不是全部产品分支或字段组合的穷举声明。**整体仍不能标为全部覆盖**：真实企微成员OAuth/客户端领取受此前自动操作URL策略拒绝限制；managed远程权限及移动/云能力还存在缺实现或受拒运行边界。没有要求用户手工测试，没有绕过拒绝。

范围为仓库`clients/uwork`共享UI、未打包Main/Host/CLI及实际Fastify HTTP/SQLite。外部MCP、网盘、发布后的多系统客户端排除，未生成安装包、推送或发布。受控模型供应商为真实本机HTTP服务，不代表外部模型质量或供应商账单。

## 新增真实结果

| 消费者                  | 原页面与实际后端结果                                                                                                                                                               | 具名证据                                                 |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 调整订阅                | 两席位减至一席位409且原状态不变；0Credit实际402/零新增，1000Credit恢复；过期402，续期再次成功；订阅月账期、reload席位2/分配2/已用28一致                                            | [v41](../evidence/admin-run-ui-v41-20261021/result.json) |
| 客户端安全              | 原专用表单创建低/高优先级策略，配置及权限预览整条取最高策略，不错误合并低策略权限；停用/启用/取消删除/确认删除/reload正确；拒绝零新增，两允许共28Credit                            | [v43](../evidence/admin-run-ui-v43-20261021/result.json) |
| 智能体版本              | 原新建、未发布拒绝、发布V1/执行、编辑V2未发布仍执行V1、发布V2/执行、停用后拒绝；原worker/supplier实际版本1/1/2，3笔settled/42Credit，其他资源保持                                  | [v44](../evidence/admin-run-ui-v44-20261021/result.json) |
| 配置草稿与冲突          | 保存A不发布；未保存B后发布只交付A；保存C后放弃恢复A；D与正式HTTP写者E冲突409，编辑器保留D而不覆盖E；原重新加载/发布E/reload正确，history仅A/E，ETag仅随发布变化，零模型账务        | [v47](../evidence/admin-run-ui-v47-20261021/result.json) |
| 企微配置与两处绑定入口  | 合成企业原配置应用成功/改CorpId拒绝；Settings绑定A及重复绑定幂等；成员行B占用A的身份409且双方保持，B绑定独立ID后reload/原表单预填保持；角色/席位/来源/用户/凭据不改，零模型账务    | [v49](../evidence/admin-run-ui-v49-20261021/result.json) |
| 会话列表/分页/搜索/详情 | 27个实际HTTP/worker会话作准备；第一页25/下一页2/返回25的ID和agent/user/run_count准确；精确搜索、详情、空态、清除/reload通过，全部UI读取零新增。准备27笔378Credit单列，不计27种功能 | [v52](../evidence/admin-run-ui-v52-20261021/result.json) |

绑定例使用独立合成身份，不修改真实身份、不合并账号、不计为真实SSO。六例均使用原UI写入、正式HTTP/数据库与原worker，没有改store、替换业务响应、SQL伪造业务状态或手动tick。

## Git重命名实际缺陷与修复

v73原页面确认：暂存列表纯重命名显示`+0/-0`，展开却收到`new file mode`，把全文件当作新增。原`GitCliRepo.getDiff`仅以新路径限制diff，读取HEAD也只找新路径，丢失旧路径。

修复保持GitCliRepo唯一读取所有者，复用parseNumstat从同来源有界rename记录取得旧路径；patch限定旧/新路径，内容读对应版本。未暂存比较只用其自己的rename关系。新增读取禁用外部diff/textconv，保留超时和输出上限，不写Git状态。

真实私有Git回归有效RED为3失败/2通过，修复后5/5：纯重命名、带修改/制表符中文路径、暂存重命名后工作副本再改、分支比较、二进制与删除降级。最终当前源码[原UI v77](../evidence/client-native-prepublish-v77-20261021/result.json)覆盖未暂存B/C、已暂存A/B、删除/新增/二进制、纯重命名、分支BASE/COMMIT和上一轮明确空态；刷新及reload后原命令重开正确，HEAD/refs/index/文件及双方完整ledger保持，模型新增0。

纯重命名无内容hunk，原UI显示similarity/rename元信息符合既有预览合同；不要求展示未修改正文。临时Review面板reload后从原命令中心重开，不虚构面板持久化要求。正常未打包构建5087输入/6672产物逐项hash验证，没有测试发布包。

## 真实企微本轮实测

[当前API v9](../evidence/client-real-wecom-readonly-v9-20261020/result.json)实际执行日2026-10-21：目录成功，1部门、10有效成员，应用API成功。日期后缀沿用原脚本约束。原结果中agent/get.redirect_domain与本机PUBLIC_URL不匹配保持原样；它与授权登录回调域属于不同配置，不以此推断OAuth成功或失败。

[Vite源码原管理页 v8](../evidence/real-wecom-admin-v8-20261021/result.json)六阶段通过：Cookie登录、组织往返、两次真实同步、实际目录、退出刷新。同步使用一致性副本，主库身份摘要保持，角色席位保留、Secret未泄漏；浏览器/前端/后端与副本均收口。

真实成员OAuth/客户端领取仍没有成功证据。此前Computer Use原调用`cua.getApp('Google Chrome')`明确拒绝当前URL自动操作，未返回准确完整URL；拒绝前页面host为企微登录域。本轮没有换工具/URL变体绕过，也没有把本地管理员、受控IdP或通讯录成功代称真实成员登录。[原始拒绝定位](../evidence/prepublish-policy-investigation-20261021/wecom-native-browser.json)。

## 最终门禁与资源

- 当前服务层全部456测试通过、0失败/跳过，已包含新5项，不相加为461。
- 客户端默认严格typecheck（含Main）、独立新测试严格检查通过；Lint114条既有警告/0错误，架构0违例，正常源码构建通过。
- 后端及新增TS脚本严格typecheck、目标TS/MJS ESLint、8个Python驱动AST、12个Git DOM表达式预检、目标格式与diff检查通过。
- [源码清单及资源核对](../evidence/prepublish-linkage-audit-v1-20261021/result.json)逐项匹配25页/11标签和23份具名结果。6个新增管理例、真实企微例、Native例均关闭自有浏览器/服务/临时根；Native4端口拒连、原Primary PID不存在。13份原失败收据保留，失败后的清理亦通过。

早期失败除v73产品缺陷外，是驱动对删除fallback、Radix pointerdown、AX角色、纯rename显示/面板持久化、原生select、图标aria-label、动态fetchedAt、准确报错文案、SQLite行原型、会话标题和ID次序的错误假设。均保留原失败，按当前合同修正后完整复测；没有跳过断言、降低产品门禁。新测试单独严格检查首次未加载TS6配置/Node类型，按当前编译器显式配置后通过，不计产品缺陷。

## 常用后端恢复

收尾时3000无监听且原server进程不存在，原因未唯一确定，不能归因本轮测试。确认运行/排队任务、评测、自动化、投递、沙箱执行、reserved账本均0后，保存0700/0600一致性备份、integrity=ok，按原Node24源码入口恢复，未改.env或人员配置。

[恢复核验](../evidence/prepublish-continuation-20261021/main-recovery-after.json)：PID48269持有原SQLite lease；health/首页/2静态资源均200，10类身份/资源/凭据/配置/版本/ledger/计划/run摘要与备份相同。正常启动有schema/lease等生命周期写入，不称全库零写；常用服务保留运行。

## 仍然开放

真实企微成员OAuth受此前URL自动操作策略拒绝限制。managed远程执行authority、手机配对/云助理须区分当前缺实现和受拒综合运行边界，不由目录或布尔配置算通过。外部MCP、网盘与发布后多系统客户端是明确排除项。

本轮新增消费者均已完成，未再发现这些链路的未修产品缺陷；上述边界仍缺真实成功证据，因此整体任务不标“全部覆盖完成”。未要求用户操作，也未合并、推送或发布代码。
