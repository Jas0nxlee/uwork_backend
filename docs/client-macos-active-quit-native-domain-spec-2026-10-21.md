# Mac Quit 原生确认域发现（v9，test-only）

本轮只修测试设施的候选发现，不修改 App、共享 AX helper、原 v8 输入或 v16 的 84 产品源。v8 已真实操作原 Quit 菜单，但候选发现遍历普通窗口的 Button/Group 链，在深度 5（seen=11）触发原断言；Cancel 未执行。三个被比较的 CF 引用均不等，不代表全图无 alias；found=0 不证明产品没有确认框，也没有确认框迟到的实测时间。

## 发现范围与取舍

仅绑定应用的 `AXWindows` 原生候选，以及每个普通窗口的直接 `AXSheets`、直接 `AXChildren` 中 role 为 AXSheet 或 subrole 为 AXDialog/AXSystemDialog 的元素。不递归普通 Group/Button。历史实际 NSAlert 证据出现过窗口直接 AXChild AXSheet，故不能仅依赖 AXSheets 属性。该范围可能漏掉更深的非标准原生容器；结果只能失败并留证，不能扩大树或伪造候选。

每轮保留 seen<=128、depth<=4 的原限制，直接候选按引用去重，同一引用经两属性出现只处理一次。属性缺席沿原 AX primitives 返回空列表；非数组、超界、错误 PID、guard 或其它属性错误立即失败，不能当成空轮重试。每轮空结果释放其新取得的 CF 引用，包括 application reference，避免轮询累计。命中后保留引用供原 refresh/press 使用，退出仍由原 adapter.close 回收。

## 时间与动作

只在原单次 operation 的同一个 5 秒截止时间内，对真正空候选有限重读；每轮和 pause 前后执行原 owner/PID/birth/executable guard，超过截止立即失败，不另起时钟。任意非空候选直接交原 `_confirmation`，不以无匹配、部分文本、歧义或错误框作为可重试空值。原完整 message/detail 的会话计数、两唯一按钮、frame、refresh 和唯一性校验原样保留；原 menu/foreground/AXPress 调用次数不增加。禁止全局键、额外菜单重试或激活 fallback。

## 证明与执行边界

实际调用新 collector 的纯测试覆盖普通深 Group 不遍历、direct Sheet/Dialog、跨属性引用去重、真正空轮后出现原生候选、错误所属/属性/容量/超时拒绝与空轮 CF 释放。用原 `perform_owned_quit_action` 和 `_confirmation` 组合验证 refresh/press、错误文案/双候选不动作。旧遍历在受控普通深 Group 图触发原深度断言作为 RED；新发现范围同图返回空且不读深层。

fresh v9 仅 retarget 同一个严格 v16 包。完整原暖步骤、持有真实请求、Cancel/Allow 与账务断言、180/160/20、renderer30、secondary10、AX5、Host9、supplier45 均保持。默认 prepare 不启动 App；Root 和 fresh peer 审核 exact plan 后才能单次 Native。纯测试不代替 Native Quit 验收。
