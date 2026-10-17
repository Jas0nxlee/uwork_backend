# 客户端控制面后台 UI：源码与真实浏览器验收

终轮 `2026-10-17T14-29-54-778Z-f94bd2` 通过。旧正式资源复现同 kind 租户切换后的迟到读取污染；新正式产物保持当前组织数据。四类结构化表单完成真实保存、发布、另存未发布修改、放弃草稿，以及 320/768/1024/1440 宽度的 16 张稳定截图与视觉复核。本轮只消费 Root 的独占构建，没有修改冻结 admin 源码或重建客户端。

## 实际 UI 动作和 HTTP 验证

每个 RED/GREEN 阶段分别使用合成身份、独占 SQLite、Chrome/CDP/BH 和动态 loopback 端口。浏览器通过实际 DOM 登录、选择 A/B 组织和客户端定制 tab；所有输入、选择、按钮提交均为 browser-harness 原生 CDP。JS 只读 DOM，未覆盖 fetch、注入 React/store、修改字段 value 或派发合成 input/change。

frontend 先获取精确 origin，真实 `createApp.publicUrl` 使用该 origin；静态文件来自本轮不可变 snapshot，API 原样 HTTP 转发。凭据只在内存/正常登录过程中存在，`BH_RECORD=0`，证据不包含密码、cookie 或 bearer token。

| 层次          | 终轮事实                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------- |
| 旧 UI         | 3 个 DOM 阶段、16 个浏览器 HTTP 请求、1 次实际配置写入 200                                  |
| 新 UI         | 23 个 DOM 阶段、56 个浏览器 HTTP 请求、17 次实际配置写入全部 200                            |
| HTTP 交叉验证 | RED 19 次、GREEN 55 次，全部 200，收据标记 `api-cross-check`                                |
| 登录前状态    | 两阶段各一次 `/api/auth/me` 401，正常登录后全部请求 200                                     |
| 生命周期终态  | B 的四 kind 均 version=1、revision=4、draft=published；A 的四 kind 仍 version=0、revision=0 |

HTTP verifier 在每次 UI 操作后分别读取管理配置与客户端聚合配置：保存草稿后客户端保持原发布数据/版本；发布后逐字段等于预期值；未发布编辑不生效；弃稿恢复已发布值且版本不增加。它与 UI 提交分开计数，未以 API 写入冒充表单提交。

- scenes：三类模板、中英文标题/提示词、图标、导航动作、插件稳定 ID、cron、错峰说明均按预期精确保存；实际增删模板；非法 cron 和保留 ID 禁写。
- help：中英文社区 HTTPS、外部反馈 URL 精确保存；HTTP URL 禁写；清空社区和反馈后分别保存 null 与 disabled/null；弃稿恢复已发布链接。
- desktop：两个开关、0.1 采样和 core/settings 分组精确保存；0.21 禁写；0.2 另存后弃稿。此次只配置后台事实。
- plugin-store：code/work 可选模式、分类和插件顺序通过结构化按钮构造并上下移动；`__proto__` 分类使表单禁写，移除后恢复；关闭排序另存 null 后弃稿恢复发布顺序。

## 迟到读取的真实 RED/GREEN

自有后台 onSend 在完成 A/new-chat 的真实读取后暂挂原响应。浏览器切换 B、显示 B 同 kind 草稿后再释放 A，未改业务响应体。

旧资源显示 header=B、表单=A，真实点击保存将 A 内容写入 B 的草稿，B 的发布内容仍独立；这是 UI 作用域缺陷。新产物 pending 时禁写，释放 A 后仍显示并保存 B 内容。accepted 旧 action 完成原 URL 且不刷新/通知新作用域、StrictMode 生命周期、新旧读取顺序等由源码测试另行覆盖。

## 产物和源码一致性

消费 `evidence/client-experience-20261017/owned-admin-artifacts.json` 的最终 4 文件。运行前核对其 10 项源码 SHA 和资源 SHA，复制到本轮 snapshot 后再 serve；最终再次核对。原 `source-freeze.json` 的 13 项内容保持一致。

| 资源                        | SHA-256                                                            |
| --------------------------- | ------------------------------------------------------------------ |
| 旧 JS `index-BiquO3Vt.js`   | `8231e85890942ee6cf1ef330b852c233ed7c45155bf4366063619b1f024c1113` |
| 新 JS `index-BSU_WPEH.js`   | `1f38bfa1ec5399e7a98cf44775d106853960fe01468a8bc3dbe2f3a8dfc3d49f` |
| 新 CSS `index-DLJlk_ZS.css` | `f0559bdbfea4e5789488c9fb332bc4b2c2ab6dff356bf7fbedc3c8142dafc7f9` |

主 `admin/dist` 全 7 文件 SHA 在全部轮次前后不变。本任务未操作主 3000/PID 37266，未读主 env/DB/Vault，未构建客户端 out，未触发模型/付费/企微/MCP/网盘/终端凭据或 remote probes。

## 驱动失败和有效历史

原始失败记录全部保留，未改成 GREEN。

| 轮次末尾 | 实际完成与限制                                                                                                                                     |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `376fab` | native select 驱动未完成 B 切换；未计产品 RED                                                                                                      |
| `56d67e` | old RED/new race GREEN、scenes 通过；URL 驱动先清空触发关闭，help 未按完整预期验收                                                                 |
| `53d75c` | old RED/new race GREEN、前三类完整通过；插件输入焦点驱动断言停止，无错误插件草稿提交                                                               |
| `798114` | 四类完整通过；布局回顶部的多余坐标点击误入组织概览，截图不计布局验收                                                                               |
| `f5898d` | old RED 已复现；cleanup helper 抛错，严格保留根；外层确认 daemon/根进程与三端口已退出后才清理，另存 recovery；原日志未含具体异常，不能确定内部根因 |
| `042d41` | 四类完整通过；布局仍因前述误点停止，资源全清                                                                                                       |
| `d33f66` | 四类和 16 个宽度数据通过；视觉发现 320 截图处于既有侧栏过渡中，不作最终稳定截图                                                                    |
| `a71a53` | 四类及 16 张稳定截图通过；整名称 typeahead 触发重复组织切换请求，另行收窄驱动                                                                      |
| `f94bd2` | 最终同轮完整通过；唯一首字符 typeahead+Tab，除登录前状态外 HTTP 全部 200；16 张最终截图逐一视觉复核                                                |

焦点修正通过原生 DOM.focus 加只读 activeElement 断言；布局不再点击标题，只用原生滚动并等待移动侧栏过渡结束，每宽度强断言当前 hash、目标 tab 与文档宽度。未为驱动失败修改产品代码。

## 清理、验证与交接

每轮释放 gate，关闭实际 Chrome/BH、frontend/backend；birth fence 防止向重用 PID 发信号，首次确认 BH daemon command，未知 daemon 判失败。TERM/KILL 后有界等待实际退出，仍活则保留 root。外层终审 9 轮、16 个独占根、362 个已记录浏览器/驱动/daemon PID、48 个自有端口全部通过；所有 root/BH 均删除，fixture 已退出。外层审计未发送信号，未探测主端口。

20 项定向测试、root/admin noEmit、定向 ESLint、Prettier 和 Python AST 全绿；此前已有源码 RED 和 shared URL 的真实 RED 按原证据保留。旧 7 类/MCP Hub 的源码回归保持绿色，本轮浏览器仅实际操作新对话与四个新增 kind。

`OwnedAdminBrowser` 现有可选 `trustSpkiSha256`，构造前以 RED→GREEN 的纯测试校验单一 canonical base64/32 字节摘要；拒绝多值、空白、URL-safe、错误长度和非 canonical 编码。仅向本次独占 Chrome 添加精确 SPKI 例外，默认无例外。此参数供 Root 后续 Native TLS fixture 使用；本报告未将其记作已执行 TLS/Native 验收。

证据入口：`evidence/admin-client-experience-20261017/browser/2026-10-17T14-29-54-778Z-f94bd2/summary.json`；同目录 `red/result.json`、`green/result.json`、`visual-inspection.json` 和两阶段 `outer-cleanup.json`；全历史清理为 `browser-outer-cleanup.json`，最终源码/构建冻结为 `final-source-freeze.json`。原始历史 `source-freeze.json` 保留其当时“待构建/浏览器”状态。
