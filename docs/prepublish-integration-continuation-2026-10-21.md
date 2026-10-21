# 编译发布前联动续测

本轮继续同一目标：共享前端、开发运行时与后端真实联动；不验收发布后的多系统客户端，不调用外部 MCP 或网盘。目标仍未完成，真实企微和下一批已确认 UI 消费者保持开放。

## 本轮完成

- **退订时序修复**，提交 `5cab2ccb`：索引同步器先封闭摄入，等待 active 订阅退订及迟到 subscribe ACK 的退订，再关闭 Agent 协议；重复异步关闭等待同一个 Promise，补齐 memory diagnostics 清理。3项定向回归通过。v10/v11真实 UI 执行与退出中，原8条 task-index 退订警告降为0，未降低日志等级或增加固定等待。
- **Main 83条类型错误清零**，提交 `44371033`：正确纳入 shared/scheduler 源与页面 DOM 回调类型，补齐公开类型导出和调用接口，修正 URL/二进制/事件参数及可选值处理。消息中继使用现有 schema 推导的 wire 类型，没有把仅校验 envelope 的数据强称为完整业务事件。默认 `pnpm typecheck` 现包含 Main 严格检查；正常 bundle 清除声明后也能重新生成依赖声明并检查，未关闭原检查项。
- **新增原回复反馈真实联动**：点赞→reload仍点赞→点踩→reload仍点踩→再次点踩清除→reload仍清除。7个阶段均核对同一对 assistant message ID，CLI transcript 的 `metadata.assistantFeedback` 为 `[null,null] → [null,like] → [null,dislike] → [null,null]`，各刷新阶段同值；模型请求与双方账本逐字不变。随后原归档、键盘取消、确认删除及刷新仍通过。

真实 UI 结果：[v11](../evidence/client-native-prepublish-v11-20261021/result.json)、[反馈与清理复核](../evidence/prepublish-continuation-20261021/feedback-and-cleanup-verification.json)。自有 Electron 自然 exit0，四端口均拒连、独立数据根删除，browser-harness daemon/socket关闭；正常后端保持运行。

## 当前验证

| 验证                             | 本轮实际结果                                       |
| -------------------------------- | -------------------------------------------------- |
| 服务层全部 `*.test.ts`           | 451通过，0失败/跳过                                |
| UI全部 `*.test.ts/tsx/mjs`       | 92通过，0失败/跳过                                 |
| Desktop全部单元 `*.test.ts/mjs`  | 108通过，0失败/跳过                                |
| CLI清单36个测试文件              | 295通过，0失败/跳过                                |
| enterprise-policy复测            | Core225与Services316通过，和上表有重叠             |
| CLI `check`                      | 注册表核验通过；Turbo27任务成功，其中19缓存、8执行 |
| 默认完整 typecheck（已纳入Main） | 通过                                               |
| Main独立最终门禁                 | 通过；此前83条原始诊断保留                         |
| Lint / 架构                      | 114条既有警告、0错误；0架构违例                    |
| 未打包Desktop正常构建            | 通过；未生成安装包、未推送或发布                   |

不同测试命令存在重叠，不将它们相加称为独立功能数。原 UI 测试第一次误用不包含测试文件的源 tsconfig，使3个JSX测试报 React未定义；改用已有测试配置后全92通过，无产品修改。CLI首次 check 因嵌套 workspace PATH 未包含已有 Turbo 而失败；使用本仓库已安装工具的路径复测通过，未下载/升级依赖。所有原失败日志保留。

Main边界回归覆盖 URL→Electron fetch 输入桥接、PDF Buffer子视图隔离复制、SaveFile非法/空载荷及实际文件写入、当前/legacy manifest字段和release channel、desktop_window/relay_bridge两种消息交付角色的未知事件透传、文本合并、seq与终态后拒发。此类源码回归不替代外部连接器或平台安装验收。

## 尚未完成

1. **真实企微**：本轮再次取得token成功，但 department/list 与 agent/get仍60020。当前后台health200；旧已登录管理会话没有配置中的应用。真实目录正向/授权回调/前端成员登录不能记通过；不绕过历史授权页面自动操作策略拒绝。
2. **任务侧栏的原入口补测**：源码 `TaskListItem`、`TaskListItemContextMenu`、`WorkspaceSidebarItem` 存在重命名/置顶和任务检索消费者；当前具名真实联动报告未找到这些入口的成功、刷新及零额外计费证据，下一轮逐项验证。已有后端metadata搜索测试不能替代共享UI消费。
3. 在下一批实测后重新逐项审计原能力矩阵，区分当前支持功能、无消费者能力、用户排除项和外部阻塞。旧发布安装包的未完成项不重新加入本轮；仍不宣称整个目标全覆盖。

证据目录为 `evidence/prepublish-continuation-20261021/`。新增反馈场景复跑使用全新profile：`PREPUBLISH_KEYBOARD_CANCEL=1 PREPUBLISH_FEEDBACK=1 python3 scripts/tests/prepublish-ui-probe.py client-native-prepublish-v数字-20261021`。
