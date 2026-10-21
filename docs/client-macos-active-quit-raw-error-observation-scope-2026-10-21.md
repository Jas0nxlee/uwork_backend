# Mac Quit v11：原 AX 属性错误只读观察

v10 实际 FAILED5，原菜单返回0且该 owned App 的 AXFrontmost 为 true；失败位于原生候选 inspect 的 AXRole 读取，经原 `_value` 进入 `_raw` 的 `Owned AX attribute failed`。尚未进入 `_confirmation` 或 Cancel。旧收据没有 numeric code，不能据此判断 stale/cannotComplete、没有 Dialog 或产品 Quit 故障。v10 的234源、计划、四个编译产物与实际失败摘要已逐 SHA 归档，原件不变。

v11 只在独立 `_QuitAx` namespace 覆盖一份从原共享源精确派生的 `_raw`。原 `_own`、一次 CopyAttributeValue、原 key/out CFRelease、允许的 -25205/-25212 分支、返回值和失败断言保持；把未知 numeric code 的原 AssertionError 附上固定 receipt，不重复读取属性，不改变错误容忍或新增动作/重试。附加发生在原 key/out 释放后；附加自身失败仍抛原错误。

receipt 仅含白名单 attribute（其它名字固定 other-attribute）、本次原 native int32 code、是否有返回 value、原 `_own` PID guard 已完成、固定阶段与 extraAxReads=0。不保存 ref、文本、locals、参数、环境、错误正文或任何属性值。既有 controller 失败回调兼容地保存此 receipt 到独占0600文件，上限4KiB；持久化失败只记 unavailable，不替换原异常、cleanup 或 result。

原 v10 业务 probe 逐字不变；仅新 profile/fixture entry 及私有方法绑定变化。原 native-domain、单次菜单/激活、完整 NSAlert 验证、AX5/Host9/supplier45/180-160-20 及 safe cleanup 全保留。原生错误立即失败，同一次操作不重试。pure 合同执行真实派生方法与原 perform，覆盖未知码仍 raise、原 CFRelease、零 press、原业务相等和 callback 落盘失败；不能以 fake native code 解释 v10 的未知错误。

本轮只准备，不启动 App/HTTP/AX，不读取或修改 Linux allowed-only case、共享 dist/out 或84产品源。新计划 exact SHA 交 Root 与 fresh peer 后，是否单次运行由 Root 决定。
