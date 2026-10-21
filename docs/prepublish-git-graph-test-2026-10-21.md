# 原Git图谱、分页与提交详情

本批只补此前无具名原页面证据的Git Graph。原项目Composer分支菜单→图谱，原Main/Host Git service读取真实私有仓库；真实身份/配置后端与SQLite仍参与。没有发业务RPC代UI、注入React state、发送聊天或调用模型；不重复旧分支创建/切换/提交路径。

| 场景              | 实际结果                                                                                                                                                                                                                                                                                                               |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v65真实56提交图   | 私有仓库52线性提交、feature两提交、main fork与no-ff merge，共56个可见commit。另有一个仅内部checkpoint ref可达的独立commit，实际Git --all共57。原首批50条的subject/short hash顺序与真实可见refs/topo/date顺序相同，SVG51 circles、多个泳道和有效path；HEAD/main/feature/owned-release标签准确。                         |
| v65原详情与分页   | 点击原merge行显示真实完整hash/中文subject/Unicode author/两个短parent，独立核对日期为实际author epoch的本地格式；再次点击收起。原wheel触发加载剩余6条，56条完整顺序准确、无重复、SVG57 circles、内部独立commit未混入。点击原root行显示对应详情且无父提交，回顶原刷新恢复首50条、超页旧详情消失。关闭和原reload不复活。 |
| v66独立无提交仓库 | 原图谱显示“暂无提交／当前仓库还没有提交历史”，无图形或加载错误；原刷新完成后仍空，原关闭/reload保持，没有创建HEAD或提交。该case未注入内部引用，raw internalRefsExcluded=false表示未执行该项，不是排除失败。                                                                                                            |

两例Graph RPC实际各3次（初始、分页、刷新）和2次（初始、刷新），按直接Host日志排除Main转发副本后计数。当前成员模型调用/ledger新增均0，初始另一成员2笔完整账本逐字段保持；refs/branch/状态/三文件内容在初始、关闭前及最终完全相同。56提交与内部ref是测试前置，只证明读取消费者，不声称产品创建checkpoint或merge功能已验证。

本批无产品代码变动，无需重跑已通过类型/构建/大套件；原正常源码缓存5087输入/6669产物在运行时逐hash校验，未生成或测试发行安装包。Python AST及11个实际DOM读表达式编译通过，原finally AST保持。v65执行源在v66的空态刷新完成条件补强之前已冻结，双方各有独立执行源/hash，没有把后改驱动冒充旧执行代码。图谱详情是元数据视图，不将它当文件diff审阅验收。

[独立最终复核](../evidence/prepublish-continuation-20261021/git-graph-final-verification.json)另读真实Git元数据清单、原页面50/56行、merge/root详情、原始请求/完整账本、所有repo快照和直接Host RPC日志；[日期独核](../evidence/prepublish-continuation-20261021/git-graph-date-verification.json)把实际epoch按zh-CN标准格式与原详情正文比对。所有自有Main2635/3727及Host/CLI/fixture PID不存在，4端口拒连、私有运行根移除、fixtureExit0、cleanup.errors空、browser-harness daemon/socket关闭。

- [v65原结果](../evidence/client-native-prepublish-v65-20261021/result.json) / [实际56提交清单](../evidence/client-native-prepublish-v65-20261021/graph-expected-commits.json) / [原分页最终列表](../evidence/client-native-prepublish-v65-20261021/graph-paged-ui.json)
- [原merge详情](../evidence/client-native-prepublish-v65-20261021/graph-detail-merge.json) / [原root详情](../evidence/client-native-prepublish-v65-20261021/graph-detail-root.json) / [原刷新首50条](../evidence/client-native-prepublish-v65-20261021/graph-refreshed-ui.json)
- [v66空态结果](../evidence/client-native-prepublish-v66-20261021/result.json) / [原空态页面](../evidence/client-native-prepublish-v66-20261021/graph-empty-ui.json)

整体目标active；下一项原GitPane的文件diff、暂存/取消暂存/还原等消费者需独立补证。企微OAuth/远程不阻挡其他本地源码联动；外部MCP、网盘及发布后多系统客户端继续排除。
