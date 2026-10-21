# Mac Quit 候选容量：只读诊断准备

当前不运行App、AX或后台，不修改原共享AX helper。v7真实菜单成功，随后在`macos-architecture-warning-dismiss.py:candidates:261`的`len(seen)<=128 and depth<=4`失败；`_confirmation`和Cancel AXPress尚未执行。不能据此说没有确认框、已发生CF语义别名或产品Quit故障。v7的211源/计划/编译产物已逐SHA归档到`before-candidate-diagnostic-review`；Manifest权限生产修复期间的3个已变源只从已验证旧snapshot取与v7计划SHA相同的原字节补齐，不写回产品。诊断将等待新正常包，不再生成可执行v15计划。

## 新独立纯设施

`scripts/tests/native-candidate-bound-observer.py`提供`derive_candidate_method(originalArchitectureSource)`、`make_candidate_method(source)`和`derive_candidate_ax_module(originalQuitAxSource)`。这只构造新命名空间，不猴补或改写原文件。原身份/actor guard、128节点、depth4、5秒deadline、原菜单/Cancel/Allow及按钮/文案/frame/PID检查不动。

原候选遍历正常路径只收已有整数和已读role/subrole，不额外调用AX；继续原顺序读取AXWindows、AXChildren、AXSheets。原容量条件将失败时，在原assert之前记录：

- `depth/seenCount/pendingCount/foundCount`、固定上限和究竟哪个条件超限。
- 最多8个已读节点的固定role/subrole枚举；当前越界节点不越过原cap读取role。最多16条已有边标签/本地ordinal，元数据内存有界，截断明确，不存指针、任意文本、title/value/description/路径或模型正文。
- 最多3次CFEqual：当前ref相对application和最近两个已读ref。每次前后均原owner/birth/executable guard，两个ref均走原`_own`精确PID检查；沿用原截止时间，不等待/重试。guard/PID/期限失败只记不可观测，并仍抛原容量AssertionError。CF函数签名沿已审只读x64 reader的c_void_p/c_bool，绝不由Python地址相等推导CF语义相等。

观察结果放新adapter的`candidateBoundDiagnostic`；新派生AX异常只把此已白名单对象附加到原异常后原样raise，finally仍释放全部原ref。没有任何AX动作新增，正常路径无新增CFEqual。未来新包retarget时还需新薄entry把该对象保存到本case0600文件、冻结完整source/derived SHA及Root/peer审核；当前没有该Native执行计划/Go。

## 当前纯合同与限制

纯测试执行原`_NativeAx.candidates`方法与精确派生方法，受控图模拟depth5、seen129和原正常sheet：读属性/边顺序、返回值、原超限失败完全保持；只在原失败点出现计数和最多3次受控CF比较。另核owner失效时零CF比较，旧cap仍失败。这里的CFEqual是测试fake，不是新Native测量或当前ARM别名事实。

源码已经剪去AXWebArea和AXScrollArea子树，并在发现native sheet/dialog时停止向外候选遍历；不能声称这是待新增功能。后续若实际诊断证实AXWindows返回application自别名/未知role，应先把它作为unresolved route记录并失败，不盲加depth/node上限。仅在真实role/边关系有证据后再讨论按native window/sheet容器裁剪；不得默默丢弃未知分支后把候选唯一或对话框不存在当成功，也不搜索其他App。当前不启用这种语义裁剪，不新增属性查询/激活/GUI重试。
