# G04k 修复的原生渲染层验证（2026-10-19）

在真实 Electron Native 应用上，用**原界面**走完 A 登录→原退出→原模型菜单普查→B 重认证，并对「修复前/修复后」两份 Desktop 产物各跑一次同一脚本，取得有效 RED 与 GREEN。

**层次声明**：这是我自己编排的 CDP 探针，不是仓库里那套受审的 Go/actor 流程（source-lock、Go 文件、Root 独立复核），因此**不把 G04k 标记为正式验收通过**。它证明的是：该缺陷在真实渲染层确实被修复，且修复前的产物在真实菜单上确实复现同一现象。输入用 CDP `Input.dispatchMouseEvent`（真实命中点、与原脚本相同的 pressed/released 帧），**不是** OS 级输入、AX、截图或解锁操作。

## 复用的审过逻辑（只读）

| 模块                                            | 用途                                                  |
| ----------------------------------------------- | ----------------------------------------------------- |
| `scripts/fixtures/native-first-run-ui.py`       | 原 FirstRun 七动作与原始 DOM 投影                     |
| `evidence/…-v9-preparation-20261019/ui.py`      | 双组织阶段（`套餐模型` 标题、press/release 两帧点击） |
| `evidence/…-v9-preparation-20261019/catalog.py` | 退出后原模型菜单普查（v9 发现该缺陷的同一逻辑）       |

新增编排：`scripts/tests/native-g04k-cdp-probe.py`（Python 编排 + 审过模块）与 `scripts/tests/native-cdp-bridge.mjs`（stdio JSON-RPC → 回环 DevTools 端点，只转发标准协议）。

## 两次真实运行

同一脚本、同一受控元数据，仅 Desktop 产物不同：

| 轮次  | Desktop 产物                                 | 结果                                                                                 |
| ----- | -------------------------------------------- | ------------------------------------------------------------------------------------ |
| RED   | 停掉修复后重建（见下）                       | 前 7 项通过；退出后 `otherProjectionVisible=true`；普查返回 **`G04K_CATALOG_STALE`** |
| GREEN | 修复版（host `98e3d10b…`、main `3d054c14…`） | 12 项全通过，20 个原界面动作，0 次模型调用                                           |

RED 的原始观测：退出后弹层 `popupCount=1`，其中仍有 `registry-provider:ucas` 分组，且 composer 的模型锚点仍是 A 的模型 ID；普查据此判 `exactAItems≥1`。这与 v9 的结论一致。

GREEN 的原始观测：

- 退出后 `signedOut=true`、`authenticated=false`、身份菜单不可见；`otherProjectionFields=["modelLabel"]`——**草稿保留历史文字标签**，但模型选择本身已撤销（`modelId` 不再命中）。
- 普查：`popupVisible/ownerVerified/anchorComposer/censusComplete=true`，`totalModelItems=0`、`exactAItems=0`、`selectableAItems=0`，且弹层内已**没有** `registry-provider:ucas` 分组。
- B 重认证后：`authenticated`、`identityNameMatches`、无 A 投影（`otherProjectionFields=[]`）；原菜单恰好一项——B 自己的模型且可选（`exactBItems=1`、`selectableBItems=1`、`exactAItems=0`）；网关面板姓名／部门／角色／额度／四项用量／模型全部匹配。
- B 登录后 composer 未自动带模型（`modelReady=false`）：与既有规格一致——历史草稿不被静默改写为另一个执行模型，B 的模型由原菜单提供并由用户选择。

## RED 对照的做法

只停掉「本次修复新增的两件事」，保留原有身份投影撤销，精确复现 v9 现象：

1. `gatewayModelSelectionSource.ts` 的读侧准入恒为允许（`admitted()` 直接返回 true）。
2. `gatewayCatalogLifecycle.ts` 的目录失效只保留代次推进与身份投影撤销，去掉异步清盘。

随后 `pnpm --filter @zcode/desktop build:no-runtime-assets` 重建 Desktop 并复跑；两次运行的产物 SHA 均记录在各自 `probe-result.json` 的 `desktopArtifacts`。对照结束后源码已逐字节恢复（`diff` 通过），并按同一命令重建了修复版 Desktop。

## 流程与资源

夹具以隔离后台／自有 Electron／真实 Host 运行；探针在 `data/<profile>` 与 `evidence/<profile>` 内完成，未触碰主后台或客户端源码以外的目录。运行结束发 `stopNative` 并终止自有进程；四次运行后已核对无自有进程残留、四个 CDP 端口均无监听。中间 profile 已删除，保留：

- `evidence/client-native-g04k-fix-red-20261019/probe-result.json`（RED）
- `evidence/client-native-g04k-fix-green-20261019/probe-result.json`（GREEN）

## 仍然开放的边界

- 未执行受审的 source-lock/Go/actor 流程，也没有 Root 独立复核；G04k 的正式验收层保持未勾选。
- 未使用 OS 级输入，未验证锁屏、系统选择器、剪贴板与外链；真实企微、外部 MCP、网盘按用户要求排除。
- 未发送任何消息或模型调用（两次运行均为 0）；B 之后的用量与账本增量未由本探针证明。
- 同一脚本未在 Windows/Linux 或安装包形态上运行。
