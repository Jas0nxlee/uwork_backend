# G04k 目录撤销修复与真实端到端复测（2026-10-19）

v9 真实 Native 复现的缺口（A 的原会话退出已返回 204、公开身份已 signed-out，但原模型菜单仍有一个完整可选、未锁定的 A 模型）已按原私有所有者链修复，并在真实后台／身份／Gateway／Writer／Registry 上取得有效 RED 与 GREEN。本机 React 组件层另有独立合同。

本项另已在[原生渲染层](client-g04k-native-cdp-verification-2026-10-19.md)完成真实 Electron 的 A→退出→原菜单普查→B 重认证，并对修复前/后两份 Desktop 产物取得有效 RED（`G04K_CATALOG_STALE`）与 GREEN；该探针不是受审的 source-lock／Go／actor 流程，因此 G04k 的正式验收层保持未勾选。

## 修复内容

沿既有唯一所有者实现，不新增身份、目录或授权副本：

- 原 Identity 仍是唯一会话／generation／AbortSignal 所有者。Gateway 复用原 projectedScope 与 admission 代次持有当前目录的有效性，scope 撤销时先同步撤掉托管目录准入并通知读侧，再异步清盘。
- 读侧在原 `ProviderRegistryFacadeSource` 上派生同一 snapshot：仅当 `providerId=ucas` 且 `config.access.type=enterprise-session` 且当前 Gateway 目录 lease 失效时排除该 Provider；其他 Provider 与普通 UCAS/API-key 保持原对象引用。默认与有效选择仍由原 ModelSelectionFacade 计算。
- 清盘只走原私有 Gateway→Provider Facade→Repository 锁，仅清锁内仍为 enterprise-session 的 UCAS `enterpriseModelIds`／`enterpriseModelNames`，不改 endpoint、access、membership、模型规则、顺序或偏好；普通 API-key 模式原样返回。进入异步工作前与锁内均按本次失效代次／issuer 复验，旧 A 迟到回包或旧 clear 不能覆盖后来者。
- 清盘失败仍撤销当前托管候选，不从 Registry 或 retained-ready 恢复 A。
- 原 Hook 在明确撤销事件上同步移除已撤销的托管候选与其有效选择引用，再经原服务重读当前输入；普通 IO 失败仍保留 ready View，草稿／正文／mode／plan／历史偏好不改写。

详见 `clients/uwork/specs/enterprise-model-catalog-projection.md` 的「退出与换身份时撤销当前托管候选」一节（该节在本轮之前已写入并冻结，本轮实现与之一致）。

## 源码与合同证据

| 层次           | 结果                                                                                                                                                                                                                       |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 服务层新增合同 | `packages/services/test/enterpriseGatewayLogoutCatalog.test.ts` 9/9：真实 Identity logout→Gateway→私有 Writer→Registry/Facade，含持锁 clear、旧 A 迟到结果、B 已提交前后、清盘失败、普通 UCAS/API-key 与其他 Provider 哨兵 |
| UI 层新增合同  | `packages/ui/test/modelCatalogInvalidation.test.mjs` 6/6：真实 Hook 在已 ready 后回读被挂起／失败、旧成功晚回与 B 新 View；普通 IO 失败保留 ready                                                                          |
| 相关回归       | enterprise-policy 163+305、provider-settings 21、UI 目录投影 15、Gateway/Projection 11，全部通过                                                                                                                           |
| 门禁           | 根类型、根 Lint（0 错误／113 既有警告）、架构 0 违例、格式（仓基线）、CLI 类型 27/27、CLI Lint 14/14（0 错误）                                                                                                             |

新增定向入口 `pnpm test:enterprise-gateway-catalog`（含严格 `tsc -p packages/services/tsconfig.enterprise-gateway-catalog-test.json`）。

## 真实端到端复测

新增 `scripts/client-live-gateway-smoke.ts` 用例「real identity owner logout revokes the managed candidates from the current model selection catalog」，使用真实本机 HTTPS 后台、真实加密会话存储、真实 Identity owner、真实 Gateway 传输、真实 Provider Writer 与 Registry：

1. 登录提交后目录恰好承认所属企业的模型；随后原身份退出，公开状态为 signed-out。
2. 同一次身份撤销内读侧即失效：托管候选归零、有效选择为 null、不再有可选候选。
3. 原私有 Writer 把持久候选真正清空（`enterpriseModelIds: []`、`enterpriseModelNames: {}`），连接仍为 enterprise-session，其他字段不变。
4. 仅重新认证不取回旧目录；只有新 owner 自己的完整提交才发布候选。
5. 全程 0 次模型调用。

证据 `evidence/client-live-20261017-keyless-gateway/logout-catalog-revocation-observation-green.json` 记录 admitted／revoked／持久候选／清盘后 Registry 与模型调用数。

### 有效 RED

- 关闭读侧准入：撤销后 `managedProviders` 仍为 1（即 v9 观测到的仍可选旧候选），用例失败。
- 保留读侧、关闭目录失效：持久候选在 10 秒内始终未清空，用例失败。

两项分别证明读侧撤销与持久清盘都是被实际验证的行为，而非同一条断言的副产品。

## 受影响夹具与回归

- `scripts/client-native-session-fixture.ts`：CLI 产物固定从 `03adc56b…`（16,575,520 B）更新为 `6cd2e95f…`（本机重建后 16,579,822 B，含 `clearManagedCatalog`）；按 `packages/services/src/node.ts` 同序绑定目录读侧准入与身份事件订阅。
- 该夹具的 CLI 清理断言原本要求「会话结束时托管提供方仍存在且 access=enterprise-session」，在退出后不再成立（清空的企业候选目录使该提供方不可构造，属本轮之前即有的目录合同）。现改为状态感知：退出态要求无托管可执行候选，登录态要求 access 保持 enterprise-session。
- 两个既有用例（`late-logout`、`apply-after-logout`）原本把「退出后磁盘字节不变」当作断言；退出自身清盘是当前契约，现改为与「清盘落定后」的字节比较，原始意图（迟到响应／缓存视图不得写入）保持不变。
- 复跑受产物固定与接线影响的 9 个 smoke 文件共 49 项，全部通过：gateway 10、personal-ports 3、assets-catalog-queue 9、builtin-policy 5、expert-resume 4、subagent-relay 2、session-relay 5、workflow 10、webfetch-public 1。

## 产物与边界

六个正常 namespace（CLI、staged CLI、Server、Web、Desktop、server-cli）按仓库既有命令重建；CLI 与 staged 字节一致且同 SHA。构建前后完整清单见 `evidence/client-g04k-catalog-revocation-20261019/artifacts-{before,after}.json`。Desktop `out` 由 6,654 降至 6,633 文件（差额为上一代构建遗留的 9 个 `host/*.d.ts.map` 及其他旧代 chunk），属正常构建输出差异。

未完成／不在本项范围：真实 Native Electron 原模型菜单普查（G04k 保持开放）；企业企微、外部 MCP、网盘按用户要求排除；`scripts/tests/native-key-enter/` 的既有 Lint 错误与 `tests/security-sixth-provider-echo.test 2.ts` 的格式问题均为仓库既有基线，未改动以保持其绑定 SHA。
