# Legacy 创建会话的完整模型选择复验（2026-10-19）

产品修复提交：`858c9c484eaa7327e62b613b7eb3b4786b63da37`。原 legacy `session/create` 将完整 ModelSelection 转成 provider/model 字符串，再交给 App，导致已校验的 `options.reasoningLevel` 丢失。修复直接调用原 `App.setModel(initialModel)`，Runtime 仍是选型唯一所有者。

本轮只涉及三个客户端文件：

- `apps/zcode-cli/packages/bootstrap/src/zcode-protocol/server-operations.ts`：保留完整对象，删除无用 import，并以中文注释说明原因。
- `apps/zcode-cli/packages/core/test/protocol-session-create-contract.test.ts`：新增真实 legacy 创建合同。
- `specs/enterprise-session-provider.md`：明确完整选型、独立 thoughtLevel 顺序和拒绝语义。

真实合同调用生产 legacy handler、App、Registry、Runtime、SessionFacade 与严格 snapshot schema，核对返回当前选择、原存储端口收到的选型和 Runtime 实际状态。配置、存储、日志及 OS home 使用本次隔离目录或有限端口；禁网且模型 relay 调用计数为 0。

- **RED**：新增 5 项中 2 项真实失败；没有独立 thoughtLevel，或独立 thoughtLevel 不受支持时，snapshot 丢失原 `high`。受支持的 `low` 覆盖、缺失档位拒绝、非法档位拒绝这 3 项原行为通过。
- **GREEN**：最薄修复后新增 5 项与相邻 legacy read 4 项共 **9/9，通过、skip 0、exit 0**。独立 thoughtLevel 的覆盖/忽略规则保持，missing/invalid 继续由原 Registry 严格拒绝，没有补默认档位或放宽门禁。
- 测试清理修正为单一 after：先 unsubscribe/close 所有 App，再删除本次自有目录，最后恢复 homedir 与同步 ESM 导出。修正后重跑同一 9 项通过。
- 初次测试装配缺少 eventStore 工厂的失败仍保留在 `red.log`，不计产品 RED。有效 RED 为 `red-contract-1.log`；最终结果为 `final-tests.log`、`final-checks.json`。目标 noEmit、lint、三文件格式、架构与 diff 检查均通过。

定向证据：[修复 manifest](../evidence/client-legacy-create-model-selection-fix-20261019/manifest.json)，SHA-256 `598d28dcb0c3de936c3a4420c4062053898ae31ba0d6d5797d0ea43546ea2592`。

Root 随后完成标准验证与正常构建，使用 Node 24.14.0：

| 验证                                      | 实际结果                            |
| ----------------------------------------- | ----------------------------------- |
| 根 `pnpm typecheck --force`               | exit 0                              |
| CLI `pnpm --dir apps/zcode-cli typecheck` | exit 0                              |
| 根 lint                                   | exit 0；113 条既有 warning、0 error |
| CLI lint、完整架构检查                    | 均 exit 0                           |
| 正常 CLI 构建及 stage                     | exit 0；两份字节一致                |
| 正常 Desktop 构建                         | exit 0                              |

验证镜像首次标准 typecheck 为 exit 2：workspace dependency 仍指向原 UI。Root 将 87 个工作区依赖链接重绑至同一 tracked Source 镜像，外部依赖目标保持，再执行上述 `--force` 检查通过；未改产品源码来消除该失败。原 `typecheck.json/log` 与 `validation-dependency-links.json` 均保留。

新构建按 **7,325 个 tracked 客户端来源**锁定，无 Source overlay；正常 CLI 与 stage 均为 16,575,520 B，SHA-256 `03adc56b7687a0ca74ce7839aea13f42fef9bdb2fdc5e6d94a439c5a047e84dd`。Desktop out 全量 6,631 文件、138,813,727 B，已记录全量 SHA。

构建与标准 gates 证据位于 [client-plugin-model-selection-build-20261019](../evidence/client-plugin-model-selection-build-20261019/manifest.json)：

- `manifest.json`：`414091c8e78a8f84ba0ff94b39740794687f4b5755a8156106c558fdc6c103c1`。
- [artifacts.json](../evidence/client-plugin-model-selection-build-20261019/artifacts.json)：`5b61da836cb60936d257b024cc63c6ba1ff46365374b24a3e56de024b70069fd`。

本报告证明源码合同与正常同版构建通过，未重跑 Native 或 Web。后续[G04i v5真实Host/正常CLI补测](client-plugin-skill-bridge-test-2026-10-19.md)已通过插件正文消费及同会话撤权拒绝，实际5模型/5settled/5Trace、45 Credit；不能将此前 disabled-session 相位直接认定为本缺陷的运行根因，也不据此宣称真实企微、外部模型供应商或跨平台验收通过。
