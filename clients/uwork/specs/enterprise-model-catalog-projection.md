# 企业会话模型目录的候选投影

2026-10-17 真实新成员 Native RED：后台只授权一个不透明模型 ID，新 HOME 却默认选择种子的 `ucas-deepseek-flash/max`，首次真实 Native 请求观测为 400 参数错误（旧 UCAS 方言先触发严格校验）；即使移除方言，目录外模型 ID 仍应由后台拒绝，不能将理论 404 当作这次实测码。根因是 ProviderRuntime 的六模型播种、Gateway 的追加式 membership 和 Registry 的完整配置准入叠加，UI 与真实可执行候选都继续包含旧 UCAS ID。

## 所有者与合同

后台目录是授权事实，现有私有 Gateway owner 读取当前 scope-bound `plan.ids`。既有 ProviderConfig/Repository writer 原子更新 endpoint、`enterprise-session` access 和非秘密 `enterpriseModelIds` 派生候选快照。无第二份身份、授权队列或配置文件。

`enterpriseModelIds` **不是执行许可**：它只收窄本地 Registry 的可构造/可选候选，不能取代 Host 当前身份与后端每次模型 scope/订阅/额度裁决。公开个人配置 create/save 不允许提交或扩大这个保留字段。手改磁盘不可能借此让后端执行未授权模型。

- 仅 access=`enterprise-session` 时，Resolver 在现有候选的 executable/selectable 判定叠加当前快照成员关系；undefined/null/[] 均无企业模型候选。缺少模型、disabled 或配置错误仍拒绝。
- 设置中的 builtin/personal membership、模型规则、顺序与用户默认偏好保留，不通过删除旧 UCAS 配置或 UI 隐藏实现约束。切回 legacy/API-key 时忽略该候选快照，原配置与偏好继续可用，其他 Provider 不受影响。
- 同一原子 writer 在持锁 mutator 的提交准入点调用 Host-only `isCurrent` 同步回调；过期 scope 不得排队后清掉新 owner 的目录。回调不进入 JSON/配置，已准入的文件事务不承诺回滚。
- 401/403 等明确身份拒绝由现有 Gateway owner 用同一私有 writer 清空快照；旧请求不得越过 owner 校验覆盖新目录。普通读取失败不制造授权，后台仍每次拒绝失效身份/模型。
- 全新草稿继续复用 ModelSelectionFacade/resolveInitialModelSelection：失效 legacy 默认不改写磁盘偏好，从过滤后的真实 Registry 选有效模型及其合法 reasoning 值；目录为空且没有其他合法候选时不回退六个种子模型。已有历史意图不被静默改写为另一个执行模型。

```mermaid
flowchart LR
 B[后端当前授权目录] --> G[现有私有 Gateway owner]
 G --> W[同一 Repository 原子 writer]
 W --> C[ProviderConfig 派生候选快照]
 C --> R[真实 Registry executable/selectable]
 R --> D[现有默认选择 owner]
 D --> H[Host 私有会话请求]
 H --> A[后端每次重新鉴权]
```

验收：真实磁盘/privateSymbol→Registry→默认选择 7vs1 RED；全新 HOME 私有 Gateway→真实 Registry→默认首次发送，无手选；同 ID 描述刷新、目录收缩/清空/重启/401拒绝后不复活、disabled、legacy/API-key 与个人 Provider 哨兵保持；旧 scope 晚写不能清新目录。测试不调用真实企微、MCP、网盘或付费供应商。

## 仅文本模型的首轮装配

无手选的真实打包 CLI RED 进一步确认：正确选中目录内、supportsTools=false 的模型后，Core 仍默认装配工具清单，严格 Adapter 因而在任何供应商派发前拒绝。Core 的既有 getTools(model) 必须按该模型能力返回空清单；getTools() 仍用于原注册表/持久化元数据，不能删除工具或改写历史。支持工具的模型保持原清单、权限与 CommandInbox。

不放宽 Adapter/Backend：显式提交工具给不支持工具的模型继续拒绝；已有工具调用/结果历史保留事实并沿既有能力校验明确拒绝，不伪造执行结果，不静默宣称工具已执行。JSON/SSE 新会话则无需工具即可正常文本生成。验收保留 tools=false 原始真实 RED、无手选新 HOME 正向、tools=true 现有真实逐次权限与工具参数回归。
