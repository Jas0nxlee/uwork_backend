# G05e1 原生自动化按钮的原生验证（2026-10-19）

在真实 Electron Native 应用上，用**原自动化页面**完成「手动创建 → 暂停 → 恢复 → 再暂停 → 跨过真实到期 → 删除取消 → 删除确认」，每一步都同时核对 UI 与持久化状态。

**层次声明**：这是我自建的 CDP 探针（复用 G04k 的夹具/桥/守卫），不是仓库受审的 source-lock／Go／actor 流程，也没有 Root 独立复核。输入是 CDP `Input.dispatchMouseEvent`（真实命中点）与 `Input.insertText`，**不是** OS 级输入、AX、截图或解锁。全程未发送任何消息：受控供应商调用 2→2 不变。

## 步骤与证据

运行 `scripts/tests/native-g05e1-cdp-probe.py`，profile `client-native-g05e1-probe-20261019`，13 项检查、23 个原界面动作全部通过；证据 `evidence/client-native-g05e1-probe-20261019/probe-result.json`。

| 阶段         | 原界面动作                                                                                          | 同时核对的事实                                                                                                                                 |
| ------------ | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 进入自动化页 | 企业侧栏 agents 菜单（managed 模式下由 `openAutomations` 所有者路由；不使用内置入口，也不臆造菜单） | 新建控件可见                                                                                                                                   |
| 手动创建     | 新建 → 排期「自定义」对话框（单位=分钟、间隔=1）→ 填写标题与指令 → 提交                             | 落盘 1 条：`enabled=1`、`lifecycle_status=active`、`run_count=0`、`dispatch_status=idle`                                                       |
| 暂停         | 卡片菜单 → `automation-action-toggle`（标签「暂停」）                                               | 落盘 `enabled=0`、`lifecycle_status=paused`、`dispatch_status=idle`、`automation_runs=0`                                                       |
| 恢复         | 同一控件（标签「继续」）                                                                            | 落盘 `enabled=1`、`active`；到期前恢复未触发任何运行                                                                                           |
| 再暂停       | 同一控件                                                                                            | 落盘回到 `enabled=0`                                                                                                                           |
| 跨过真实到期 | （无动作，只读观测）                                                                                | 到期在创建后 58.1 秒，实际等待 70.1 秒跨过：`automation_runs=0`、`run_count=0`、`last_run_at` 为空、`dispatch_status=idle`、受控供应商调用不变 |
| 删除（取消） | 卡片菜单 → `automation-action-delete` → 对话框「取消」                                              | UI 仍 1 张卡，落盘仍 1 条                                                                                                                      |
| 删除（确认） | 同一入口 → 对话框确认                                                                               | UI 0 张卡，落盘 0 条                                                                                                                           |

「真实到期」是可证伪的：探针由 `next_run_at` 计算等待时长，**若到期不在有界窗口内则直接失败**，不会把「等了一会儿」写成「跨过到期」。

## 一处产品行为

暂停期间到期被跨过之后再「恢复」，会**触发一次真实的追赶运行**（观测：`run_count=1`、`last_run_at` 有值、`dispatch_status=dispatched`、`automation_runs=1`）。这与已验收的 G05e 结论一致（「恢复消费同一原 due、恰一次成功 run」），不是缺陷；但它意味着探针必须在**到期之前**完成暂停/恢复动作，因此本轮把它们排在到期窗口之前，避免测试自己制造一次模型调用。

## 与既有切片的分工

- G05e：Host／完整 Main 的暂停后自然到期（45 秒窗口、零派发），已验收。
- G05e1（本项）：**原 Native 按钮本身**的实际点击与持久化效果，不以 Host RPC 代替。
- G05a：原 Native 自动化创建/立即运行，已验收；本轮不重演其范围。

## 边界

- 未执行仓库受审的 source-lock／Go／actor 流程与 Root 独立复核。
- 仅 macOS 未打包 Electron；未在安装包或 Windows/Linux 上运行。
- 未使用 OS 级输入、系统选择器、剪贴板；真实企微、外部 MCP、网盘按用户要求排除。
- 本轮只覆盖定时任务的暂停/恢复/删除；闲时任务（off-peak）的对应按钮不在本项范围。
