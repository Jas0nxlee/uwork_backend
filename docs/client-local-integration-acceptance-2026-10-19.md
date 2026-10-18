# 本机客户端联动阶段验收（2026-10-19）

已完成下述原生登录、文件上下文、Web与插件安装到Skill正文消费的新增验收。后续复核补上成功连接后断线的 W02：真实失败复现后修复 RPC/UI 关闭与工作区恢复 Hook 序列两处问题，42 项回归、新完整构建和 v4 浏览器恢复通过，console0/script0，详见[W02报告](client-web-disconnect-recovery-test-2026-10-19.md)。随后[G09b](client-native-gateway-usage-logout-test-2026-10-19.md)完成原用量真实HTTP在途退出、原authority abort/drop与匿名原面板重开，Native计量增量0、console0/script0。G04j已安装插件推荐卡的原UI绑定由新审计列为待验。此前“本机当前可运行独有切片已完成”的表述过宽，撤回该概括。U02–U05保持未勾，T13项不变。历史报告保持各自日期、候选和失败，不把旧用例数量冒称在当前产物全部重跑。

| 范围               | 已接受的实际证据                                                                                                                                                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native空身份原登录 | [G04h v8](client-native-primary-login-progress-2026-10-18.md)：prelogin全0、唯一attempt/callback与Host私有claim；原主/标题2模型、2本人settled、2Trace、44 Credit；认证冷恢复、Gateway、原退出拒发与cold3保持退出。                |
| Native文件上下文   | [G07c v3](client-native-file-context-test-2026-10-19.md)：原mention/Back/发送，A Read正文3请求/66；同task B发送前撤FS后Read拒绝、无新B marker，新增2请求/44。Native5/110与独立2B/44分列。                                         |
| Standalone Web     | [Web v8](client-web-standalone-dom-test-2026-10-19.md)：Electron41原正常Web产物、Cookie/FirstRun/目录/预览/reload恢复11项通过；企业仍未配置，不含模型、自动重连或Chrome兼容声称。                                                 |
| Web断线与原重试    | [W02 v4](client-web-disconnect-recovery-test-2026-10-19.md)：实际关闭连接、错误页、四宽及原Tab/Enter Retry；同配置服务恢复后Cookie/项目/文件恢复，console0/script0。两处修复、42项回归及新正常构建通过；Native交互未由此替代。    |
| 插件正文消费桥     | [G04i v5](client-plugin-skill-bridge-test-2026-10-19.md)：普通成员原Host/正常CLI安装非默认根；D/S禁启catalog与别名、A正文入模、同S撤personal.skills后未消费B拒绝且无B正文；5模型/5settled/5Trace、25 input/10 output、45 Credit。 |
| 既有本机入口       | [持续矩阵](client-integration-coverage-2026-10-17.md)保留配置/菜单、技能管理、专家/工作流恢复、Main定时调度、个人能力、插件生命周期、分享发布及guest阅读退出等已验切片；正式CLI/Host与真实OS工具合同不按tool再套重复Native测试。  |

此前完成的两条产品修复：[freshDraft](client-fresh-draft-model-selection-test-2026-10-18.md)保留空目录新草稿待选资格，登录目录到达后只补模型，15项回归及v8原界面发送通过；[Read结果复验](client-read-result-authorization-test-2026-10-18.md)在释放正文前重查同owner/授权端口和当前权限，原deadline/取消不被迟到allow绕过，Core119/Host292、正常打包CLI真实OS五阶段与G07c原界面分层验收。G07c发送前撤权不冒称Native OS handler等待期间撤权。

前述Native/File/Web结果沿各自原manifest：CLI/stage正常dd0a、Desktop正常7fb08候选、Web/Server独立正常e111构建，不宣称在新产物重跑。G04i采用[legacy完整选型修复后的新正常构建](client-legacy-model-selection-test-2026-10-19.md)：7,325客户端来源、CLI/stage03adc56b及正常Desktop，标准根/CLI类型、Lint与架构通过；legacy真实RED2→GREEN9，严格缺失/非法档位拒绝保持。FileUI返回与身份缺失拒发5项是测试/spec修正，不为其单独重建产品，也不累加重叠测试数量。

资源分别收口：Native v8为8已知PID/4ports/3BH，FileContext为已记录PID/4ports/BH及21 helper，Web为275已知PID/2ports；G04i v5原PTY实际exit0，[Root独核](../evidence/client-sharing-followup-root-review-20261018/plugin-bridge-v5-public-independent.json)29公开文件全SHA、4已知PID/4ports闭合。原不完整handoff或FD查询失败保留，由Root独核处理；保留私有根不能写成已删，也不能由PID/端口关闭推断零写者。未读/stat retained私有根或查询未知holder。

G04i结束后，Root于2026-10-18 19:41:01.783 UTC确认主PID42125身份/cwd/DB正确，health及首页JS/CSS均200、字节SHA匹配，九业务表及四部署资产哈希不变。见[插件桥结束后的主服务保护](../evidence/client-sharing-followup-root-review-20261018/plugin-bridge-final-main-protection.json)。W02结束后的[最新只读核验](../evidence/client-web-disconnect-audit-20261019/main-final-protection.json)时间为2026-10-18 21:32:09.788 UTC，同样确认PID42125、HTTP资源及九表/四资产不变；未重启、重新部署、管理员登录或调用主后台模型。

剩余范围分列：

- **当前无入口/未实现**：热切企业、legacy共享技能UI、同Main第二Root、手机/云协作caller、managed远端企业authority、生产workflow灰度或offPeak启用来源。普通Docker File/System已验，不造新authority/票据/协作服务补数量。
- **目标环境未验**：签名安装包与Windows/Linux/macOS安装目标、OS选择器/剪贴板/默认外链、官方市场/公司库存及生产CI；unpackaged Electron不能替代。
- **排除/外部边界**：真实企微、外部MCP、网盘；受控supplier不代表外部模型账单，Chrome旧导航失败根因仍未知。Gateway在途用量退出已由G09b另验；G04i自有包正文消费不替代官方市场、任意插件代码、全部Workspace或跨平台安装验收。

G04i已以有限真实Host/CLI/FS实测补齐独有连接，没有重演G04f安装生命周期。其余场景仅在新增可用环境、明确新入口、相关产品变更或具体失败出现时追加验证。
