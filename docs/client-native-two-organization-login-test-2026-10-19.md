# Native 双组织重新认证测试记录（2026-10-19）

G04k 尚未完成真实 Native 验收。目标是在同一个全新空身份 profile 中，经原 UI 完成 A 登录、原退出、B 重新认证，并验证身份、模型目录、配置、权限和本人用量随会话切换，B 不显示 A 的受保护投影。两个组织使用同一受控 Corp/agent、两个真实 backend tenant 和不同普通 member；这不代表真实企微或不同 Corp 的集成验收。

每槽仅一次原 beginLogin、受控 callback 和 Host 私有 claim；中间仅一次 A logout。错配、旧 state/nonce、旧槽重放由独立合同验证，不向 happy path 追加认证。全程不发送模型；A/B 预置账本只用于隔离读取，不称新增请求、Trace 或实际计费。

## 来源与合同层次

正常构建基线为 `a650d96961ef10c2473aeac0790cc229f9d16ba2`，客户端产品 Source 与正常产物未因 G04k 改动。Root 已应用四个正式夹具／测试文件，夹具独立按 SHA 绑定；不是产品认证实现或客户端构建变更。见[正式文件复核](../evidence/client-native-two-organization-login-preparation-20261019/root-formal-review.json)。

| 层次                        | 实际结果                | 验证边界                                                                              |
| --------------------------- | ----------------------- | ------------------------------------------------------------------------------------- |
| 正式相关合同                | 63/63；入口合同 7/7     | 双槽与原单槽夹具、正式入口                                                            |
| 原 UI 投影／Binding 纯合同  | 8/8、5/5                | 固定 DOM、物理 Input、显式 CDP session 与一次性 journal；未运行 Native                |
| 实际 actor／driver 定义合同 | 4/4、5/5                | 编排与固定验收逻辑；未运行 Native                                                     |
| 内存基线 HTTP               | 两槽通过                | 原路由下 A/B 请求、成功、Token 均为 0，预置 cost 分别 7/11；不代表 Native Host 已读到 |
| CoreOnly 只读独审           | Critical 0 / Required 0 | 代码审查结论，不能代替真实链路                                                        |

计数见[最终准备复核](../evidence/client-native-two-organization-login-preparation-20261019/FINAL-REVIEW.json)、[入口合同日志](../evidence/client-native-two-organization-login-preparation-20261019/root-formal-entry-green.log)和[内存 HTTP 收据](../evidence/client-native-two-organization-login-preparation-20261019/root-baseline-http-check.json)。测试期间修正了 claim 重绑定、退休 guest 和真实 `/v1/models` 路径等夹具问题；不将这些修正记为产品缺陷或 Native 通过。

## 九次实际运行

前三轮及 v7 在认证前停止。v4–v6 已完成 A 的原客户端认证与 Host 私有 claim。v8 已进一步通过 A 的完整配置、Gateway 账户／额度／用量及同 owner 的原退出。v9 在新的独立 profile 中实际复现退出后仍有一个可选 A 模型；B 尚未登录。九轮均未 Send，仍没有 A→B 切换的完整成功证据。

| 轮次 | 原工具与固定公开结果                                                                                                                                                   | Root 独核公开封存                                                                                                                                                                                                                                                                        |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v1   | 停在 preworkspace，内部分类为 UNKNOWN，旧内部诊断未保留，原因未知                                                                                                      | 29 文件；manifest `9b9f83cba6a369f77f09ec4d5e91a2b8685a0d754d15a9f2a6fb04fe53dfcb58`；[公开独核](../evidence/client-post-g04j-boundary-audit-20261019/g04k-first-public-independent.json)、[资源闭合](../evidence/client-post-g04j-boundary-audit-20261019/g04k-first-root-closure.json) |
| v2   | preworkspace 内层 CLI exit 0，但 stderr 147B，被严格协议拒绝；未恢复其正文，不归因具体内容                                                                             | 32 文件；manifest `8e7d790174bc9c144c6f57b0c297a8e929120f4b9f6f4a43342ec2077a39f2fb`；[公开独核](../evidence/client-post-g04j-boundary-audit-20261019/g04k-v2-public-independent.json)、[资源闭合](../evidence/client-post-g04j-boundary-audit-20261019/g04k-v2-root-closure.json)       |
| v3   | 关闭 BH_UPDATE_CHECK 后 preworkspace 以 0 stderr 通过，workspace secondary 38225 exit 0；随后 first_run_skip_login 的 Input 内部出现 OSError／TimeoutError，首错停止   | 40 文件；manifest `b91c6442d9a31ad6251f4add04651aa7d584096875277ac965400f4614cec0c5`；[公开独核](../evidence/client-post-g04j-boundary-audit-20261019/g04k-v3-public-independent.json)、[资源闭合](../evidence/client-post-g04j-boundary-audit-20261019/g04k-v3-root-closure.json)       |
| v4   | console 前后明确未锁定，原 app／Target 焦点、FirstRun 七动作通过；A 各一次 callback／claim／me／guest 关闭及模型、菜单、欢迎投影通过；完整风险提示断言不匹配，首错停止 | 136 文件；manifest `c1d8dbae83402ca6d3b32392d256efa465b8c19bb7492f7a3043629faacabecf`；[公开独核](../evidence/client-post-g04j-boundary-audit-20261019/g04k-v4-public-independent.json)、[资源闭合](../evidence/client-post-g04j-boundary-audit-20261019/g04k-v4-root-closure.json)      |

v5 修正全文风险期望后，A 的原登录、模型、菜单、欢迎和完整风险配置实际通过。随后原身份菜单可见且姓名／公司精确匹配，底层身份节点按原弹层行为隐藏；driver 却统一要求底层 identityNameMatches=true，因此误拒。该测试层问题随后由 v6 修正并复测，不能记为产品身份丢失。142 个公开文件封存于 manifest `c3112efef8b30c91ff911f71e8d6e6c340a1771175d9c15d218608068ba2fa65`；见[公开独核](../evidence/client-post-g04j-boundary-audit-20261019/g04k-v5-public-independent.json)和[资源闭合](../evidence/client-post-g04j-boundary-audit-20261019/g04k-v5-root-closure.json)。

v6 按阶段校验实际可见身份后，A 的原身份菜单通过；Gateway 的姓名、部门、角色、额度及四项用量全部匹配，仅模型列表匹配为 false。测试定位使用“模型”，而原 locale／组件的标题为“套餐模型”。158 个公开文件封存于 manifest `21fb1b3677c87acb12f971f33c4029c4f989dec407d4ee84e5fa6efc0b5bde26`；见[公开独核](../evidence/client-post-g04j-boundary-audit-20261019/g04k-v6-public-independent.json)和[资源闭合](../evidence/client-post-g04j-boundary-audit-20261019/g04k-v6-root-closure.json)。

v7 仅修正模型区标题，跨层定向合同 RED→GREEN 3/3；真实运行随后在 FirstRun next_mode 的第一个 mouseMoved 帧内部超时，尚未发送 pressed／released，也未到认证。焦点 setup 当时明确通过且 console 未锁；不把后来锁屏反推为唯一原因。82 个公开文件封存于 manifest `5a3d8c70a184fb66536000f1b152a5802d31452a471e149b03d65f8f894fc829`；见[公开独核](../evidence/client-post-g04j-boundary-audit-20261019/g04k-v7-public-independent.json)和[资源闭合](../evidence/client-post-g04j-boundary-audit-20261019/g04k-v7-root-closure.json)。

v3 的 Input 超时只证明调用未正常返回，不能声称输入未执行、将其归为产品错误，或据此重发。各轮原 Common 工具终态均为 exit 1，BH 为 exit 0；Root 分别精确收口 Common 及本轮子进程，并独核已知 PID 不存在、四端口拒连、精确 BH socket 关闭。FD 查询不完整时保留私有根，不声称未知 FD 为零；未重读闭合的 R／BH 或原始日志。

## 环境与下一步

[04:11:30Z 收据](../evidence/client-post-g04j-boundary-audit-20261019/current-console-state-v2.json)记录 `rootConsoleLocked=true` 且活动 console 的锁定字段为 true；[05:56:18Z 收据](../evidence/client-post-g04j-boundary-audit-20261019/console-state-after-g04k-v3.json)记录 `rootConsoleLocked=false`，其 console session 锁定字段为 null。两者仅说明各自时点，不回填三轮历史锁定状态，也不证明此前超时的唯一原因。

v4 实际焦点与逐帧记录已通过。A 的 Host 读取计数为 me 2、models 1、configuration 3、entitlement 1、usage 1；供应商调用与两槽新增账本／Trace 均为 0。七次认证后观察均只有 riskMatches=false；测试期望取了裸 notice，而原组件完整文案包含固定 riskPrefix 和分隔符。v5 已通过全文精确比较，没有修改产品认证或风险提示实现。

v4 原 Common exit 1、BH exit 0，Root 独核五个已知 PID、四端口及精确 BH socket 已关闭；FD 查询仍不完整，不称 FD0，保留私有根且不再读取。G04k 仍开放，后续自动复测原 A 登录→退出→B 重认证。

v8 采用标准 pressed／released 两帧点击，正式 FirstRun 新增显式 opt-in，默认三帧保持；旧 10 项及新 3 项合同共 13/13、Binding／完整 12 动作两项合同通过。没有扩展认证或超时，没有重发失败动作。11:44:14 UTC 的[启动前控制台核对](../evidence/client-post-g04j-boundary-audit-20261019/g04k-v8-pre-admission-console-state.json)明确锁屏，首次准入停止；12:17:32 UTC 另次只读核对明确未锁后，Root 才创建本轮 Go 并实际执行。

v8 的 A 原登录、模型／菜单／欢迎／完整风险配置、Gateway 姓名／部门／角色／额度／四项本人用量均通过；原退出返回 204，退出 owner 与本轮 A claim 精确匹配，公开身份已变为 signedOut。随后 B 登录前的检查发现 Composer 仍保留 A 的模型 ID／标签，因此按首错停止，B attempt／callback 均为 0。该标签来源是 Composer 草稿；当前模型目录是否仍可选尚待原菜单实际验证，暂不把它定性为权限泄漏或无害残留，也不清除历史草稿来绕过断言。

本轮供应商调用、新增模型账本及 Trace 均为 0，A/B 合成用量基线仍为 7/11。161 个公开文件由 manifest `db9e5377a831e188277f9a0f9b0c94db66d0eae09081be5418114e98959c0de6` 封存；见[公开独核](../evidence/client-post-g04j-boundary-audit-20261019/g04k-v8-public-independent.json)和[资源闭合](../evidence/client-post-g04j-boundary-audit-20261019/g04k-v8-root-closure.json)。Root 独核五个已知 PID 不存在、四端口拒连、精确 BH socket 已关闭；原 Common exit 1、BH exit 0。FD 查询不完整，保留私有根且不再读取，不声称 FD0。

v9 增加原模型菜单诊断，未改客户端产品、正式夹具或旧 signedOut 断言。六项新增纯合同及 Root 独核的 7339 Source／六正常目录 12789 文件通过后，只运行 A 完整链→同 owner 退出→原模型菜单；没有 B、选模、Send 或关闭菜单动作。原菜单实际可见，完整 census 为 total=1、exactA=1、selectableA=1、selected=1、locked=0、disabled=0、B=0、unknown=0，明确返回 `G04K_CATALOG_STALE`。这确认旧候选仍可选，不能只解释为历史草稿标签；Composer 当时 Send disabled 只是一项界面观察，本轮没有验证模型鉴权绕过。

v9 的 B attempt／callback、新供应商调用、账本及 Trace 增量仍为 0。178 个公开文件由 manifest `60ce238f82ba1aa6d2030c86984e4c4e8eda54f943e978f7084887613a3aba50` 封存，见[目录独核](../evidence/client-post-g04j-boundary-audit-20261019/g04k-v9-public-independent.json)及[资源闭合](../evidence/client-post-g04j-boundary-audit-20261019/g04k-v9-root-closure.json)。五个已知 PID、四端口和精确 BH socket 独核关闭；原 Common exit 1、BH exit 0，FD 不完整仍保根。12:58 UTC 的[正常后台核对](../evidence/client-post-g04j-boundary-audit-20261019/g04k-v9-root-current-main.json)确认原 PID 59926、健康／入口 200、九张当前业务表保持恢复备份状态。

后续身份失效到托管 UCAS 候选目录的同步已按原私有 Writer 修复：清 IDs／names，保留历史草稿、模型成员及偏好；旧 A 回包或清理不能覆盖新 B。修复、标准门禁、六产物正常重建与真实后台／身份／Gateway／Writer／Registry 端到端复测（含双向有效 RED 与 GREEN）见[本轮报告](client-g04k-catalog-revocation-test-2026-10-19.md)。原 A→退出→B 的原生渲染层验证已在我的 CDP 探针上完成：真实 Electron 原界面、审过的 FirstRun/双组织/普查模块只读复用，修复前产物复现 `G04K_CATALOG_STALE`、修复后退出态菜单为空且 B 只得到自己的可选用模型，见[原生验证](client-g04k-native-cdp-verification-2026-10-19.md)。该探针不是受审的 source-lock/Go/actor 流程，G04k 的正式验收层保持未勾选。

2026-10-19 10:54:57 UTC 的[主后台存在性核对](../evidence/client-post-g04j-boundary-audit-20261019/main-before-g04k-v4-presence.json)确认旧 PID 42125 已不存在、3000 健康地址不可达；没有复用早先健康／业务表结果冒称当前状态。v4 使用独立后台，未启动、修改或重部署主服务。

随后 11:12 UTC 已按原运行授权完成独立备份与正常后台恢复，新 PID 59926、健康及访问路径正常，九张当前业务表和四资产均保持。见[本次后台恢复记录](local-backend-recovery-2026-10-19.md)；客户端联测仍使用独立后台。
