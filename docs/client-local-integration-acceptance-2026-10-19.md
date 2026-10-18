# 本机客户端联动阶段验收（2026-10-19）

已完成下述原生登录、文件上下文和Web新增验收；本机仍需补测插件安装记录、启用状态及manifest根装配到Skill正文消费的独有连接。U02–U05保持未勾，T13项不变，不宣称所有环境或全平台完成。历史报告保持各自日期、候选和失败，不把旧用例数量冒称在当前产物全部重跑。

| 范围               | 已接受的实际证据                                                                                                                                                                                                                 |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native空身份原登录 | [G04h v8](client-native-primary-login-progress-2026-10-18.md)：prelogin全0、唯一attempt/callback与Host私有claim；原主/标题2模型、2本人settled、2Trace、44 Credit；认证冷恢复、Gateway、原退出拒发与cold3保持退出。               |
| Native文件上下文   | [G07c v3](client-native-file-context-test-2026-10-19.md)：原mention/Back/发送，A Read正文3请求/66；同task B发送前撤FS后Read拒绝、无新B marker，新增2请求/44。Native5/110与独立2B/44分列。                                        |
| Standalone Web     | [Web v8](client-web-standalone-dom-test-2026-10-19.md)：Electron41原正常Web产物、Cookie/FirstRun/目录/预览/reload恢复11项通过；企业仍未配置，不含模型、自动重连或Chrome兼容声称。                                                |
| 既有本机入口       | [持续矩阵](client-integration-coverage-2026-10-17.md)保留配置/菜单、技能管理、专家/工作流恢复、Main定时调度、个人能力、插件生命周期、分享发布及guest阅读退出等已验切片；正式CLI/Host与真实OS工具合同不按tool再套重复Native测试。 |

本轮两条产品修复：[freshDraft](client-fresh-draft-model-selection-test-2026-10-18.md)保留空目录新草稿待选资格，登录目录到达后只补模型，15项回归及v8原界面发送通过；[Read结果复验](client-read-result-authorization-test-2026-10-18.md)在释放正文前重查同owner/授权端口和当前权限，原deadline/取消不被迟到allow绕过，Core119/Host292、正常打包CLI真实OS五阶段与G07c原界面分层验收。G07c发送前撤权不冒称Native OS handler等待期间撤权。

构建/来源沿原manifest：CLI/stage复用正常dd0a产物，Desktop正常7fb08候选，Web/Server独立正常e111构建。已有类型/Lint/格式/架构结果按修复报告保留，不累加重叠数量。本次FileUI返回及身份缺失拒发的5项回归属于测试/spec修正，未改产品Source/out，不为它重建产品。

资源分别收口：Native v8为8已知PID/4ports/3BH，FileContext为已记录PID/4ports/BH及21 helper，Web为275已知PID/2ports。原不完整handoff或FD查询失败保留，由Root独核处理；保留私有根不能写成已删，也不能由PID/端口关闭推断零写者。未读/stat retained私有根或查询未知holder。

Root于2026-10-18 18:09:58 UTC确认主PID42125/health200、九业务表及四部署资产哈希不变；18:10:30 UTC实际首页/JS/CSS三个HTTP200且字节SHA匹配部署文件，无管理员登录或模型调用。见[主服务保护](../evidence/client-sharing-followup-root-review-20261018/local-closure-final-main-protection.json)和[页面资产](../evidence/client-sharing-followup-root-review-20261018/local-closure-final-admin-http.json)；本轮未重启或重新部署主后台。

剩余范围分列：

- **当前无入口/未实现**：热切企业、legacy共享技能UI、同Main第二Root、手机/云协作caller、managed远端企业authority、生产workflow灰度或offPeak启用来源。普通Docker File/System已验，不造新authority/票据/协作服务补数量。
- **目标环境未验**：签名安装包与Windows/Linux/macOS安装目标、OS选择器/剪贴板/默认外链、官方市场/公司库存及生产CI；unpackaged Electron不能替代。
- **排除/外部边界**：真实企微、外部MCP、网盘；受控supplier不代表外部模型账单，Chrome旧导航失败根因仍未知。Gateway迟到HTTP增强仍为可选；插件发现与消费桥已确认存在独有分支，列入本机待测G04i。

先完成G04i的有限真实Host/CLI/FS实测，不重复G04f的安装生命周期。其余场景仅在新增可用环境、明确新入口、相关产品变更或具体失败出现时追加验证。
