# Mac x64 两版代码身份与既有启动时间只读核查（2026-10-21）

本轮没有启动 App/GUI、打包、重签、复制产物或读写 Rosetta 缓存。目标仅为本项目不可变 v9、v11 两个 App 的实际 Main executable、Electron Framework、Info.plist，以及四个已完成 case 的原日志。

**可证事实是新 Main 的签名身份发生变化，但 Native 代码没有变化；大 Electron Framework 整个文件相同。现有材料不能证明 AOT/cache 是原三十秒就绪失败的原因。**

## 实际字节与签名

[comparison.json](../evidence/client-macos-x64-cache-identity-readonly-20261021/comparison.json) 的逐段解析、实际 CodeDirectory 页面摘要重算及原 `codesign -d --verbose=4` 回读：

| 项目                    | v9 → v11                                                                                                 |
| ----------------------- | -------------------------------------------------------------------------------------------------------- |
| Main executable         | 均 14352 bytes，所有 sections、代码页、load commands、LC_UUID 和签名区外 whole SHA 完全相同              |
| Main CDhash             | `d1b64dd550b59dfb55ff4d358247bd4aef51aa6a` → `ee736865336797468d12f07d9fcf78f3bc852902`                  |
| Main CodeDirectory 变化 | 仅 special slot 1（Info.plist）、3（CodeResources）；不是代码页变化                                      |
| Electron Framework      | 均 199656832 bytes，整个文件 SHA 同为 `22c7d44e08fee6fa5600afe1ab087a18e81d55c4d5f763d323aa6bdb089db255` |
| Framework CDhash        | 均 `ba4b558c87ef095f8a504a235d2570e0ef3de9cb`，UUID、代码页及签名也一致                                  |
| App Info.plist          | 唯一内容差异为 `ElectronAsarIntegrity.Resources/app.asar.hash`                                           |

因此，“大 Framework 因本次重签得到新 CDhash 而重新翻译”不受这些实际字节支持。新 Main 的 CDhash 不同，为不同代码身份条件提供了事实，但并不证明系统是否已有可用翻译，也不排除路径、缓存保留策略、JS/模块评估或其它启动条件。静态 native-macos REA Main 摘要及局限见 [rea-main-summary.json](../evidence/client-macos-x64-cache-identity-readonly-20261021/rea-main-summary.json)，两个分析会话均关闭；没有启动 Hopper 或目标程序。

另一个独立元数据事实必须保留：[asar-header-integrity.json](../evidence/client-macos-x64-cache-identity-readonly-20261021/asar-header-integrity.json) 以当前两个原安装 reader（`@electron/asar.getRawHeader` 与 builder `readAsarHeader`）确认 v9、v11 的 Info.plist 声明均不等于当前 ASAR header SHA。v9 actual `4eb283b9…3d559`、声明 `bf4b3f54…606af`；v11 actual `58df27fd…709ad`、声明 `495584d0…13d44`。原 embedded ASAR integrity fuse index 4 在两包都是 48，即 disabled，没有修改开关或包。首次额外“声明应等当前 header”的断言失败已记录，不能将声明误称为本轮已验证完整性。原 builder 在 afterPack 注入运行时/清理 sourcemap 后重写 ASAR 是可见源码路径，是否完整解释该元数据差异尚需单独归因；这不是 AOT 因果结论，也不在本轮擅自修包。

## Header 算法与真实 hook 顺序校准

匹配版本为 installed electron-builder/app-builder-lib **26.8.1**、`@electron/asar` **3.4.1**、目标 Electron **41.10.7**。官方 [archive.cc 第210–228行](https://github.com/electron/electron/blob/v41.10.7/shell/common/asar/archive.cc#L210-L228) 从 Pickle `ReadString` 取得 `std::string header`，只对该字符串字节调用校验；[asar_util.cc 第126–132行](https://github.com/electron/electron/blob/v41.10.7/shell/common/asar/asar_util.cc#L126-L132) 使用 SHA256；[archive_mac.mm 第37–58行](https://github.com/electron/electron/blob/v41.10.7/shell/common/asar/archive_mac.mm#L37-L58) 读取 Info.plist 中相对 `Resources/app.asar` 的声明。因而正确范围是 UTF8 JSON 字符串字节，不含八字节外前缀、Pickle envelope 或 padding。

为避免两个 JS reader 共享误解，[独立原字节检查](../evidence/client-macos-x64-cache-identity-readonly-20261021/cpp-compatible-raw-header-check.json) 另按尺寸前缀和 Pickle 字符串长度直接读取当前 ASAR；两个 raw UTF8 摘要仍与原 reader 相同，而 raw Pickle-buffer 摘要不同。因此已确认声明与当前正确段的差异，仍不把它称为包损坏或首启原因。

installed builder 的 `platformPackager.js` 先 `computeData` → `beforeCopyExtraFiles`/`createMacApp` 写 Info，再 `emitAfterPack`。本项目 hook 先注入依赖、再清理 sourcemap，均可能重新 pack，之后才 sanity/fuse/sign；v11 原日志确有两次 asar-pack 在 signing 前。匹配源与摘要见 [algorithm-and-packaging-order.json](../evidence/client-macos-x64-cache-identity-readonly-20261021/algorithm-and-packaging-order.json)。没有原 pre-hook header 字节快照，故不虚构该声明对应哪个确切中间包；顺序已确认，而本轮未修该字段、未改 fuse 或重签。

## 已发生的时间轴，不命名为已证 cold/warm cache

[historical-timeline.json](../evidence/client-macos-x64-cache-identity-readonly-20261021/historical-timeline.json) 只保留已知 Main PID 的四阶段与固定标记，并从本 case `electron.log` 提取四个有限数值 launchMarks；不复制或访问 URL、身份或正文。

| 产物/已完成 case             | creation→mainStart | creation→appReady | creation→loadUrl | file target 观测                       |
| ---------------------------- | -----------------: | ----------------: | ---------------: | -------------------------------------- |
| v9 原七项 startup-v2         |           21.126 s |          24.700 s |         29.132 s | 30.042 s 时仍未选中，原验收 0/7 failed |
| 同 v9 secondary 诊断 v6      |            6.033 s |          10.025 s |         13.251 s | 16.047 s 选中；旧副实例随后十秒失败    |
| v11 原七项 secondary-exit-v1 |           22.184 s |          25.781 s |         29.755 s | 30.068 s 时仍未选中，原验收 0/7 failed |
| 同 v11 secondary 诊断 v7     |            5.011 s |           8.699 s |         12.983 s | 14.197 s 选中；新副实例原十秒自然 0    |

`createdAt` 来自 Electron `process.getCreationTime()`，`mainStart` 实为 `desktopLaunchMarks.ts` 模块评估时的 `Date.now()`；它不是能够排除所有前置 JS/模块加载的 Native-only 边界。两版较慢与较快的差额主要出现在该标记之前。四次条件不同且没有观察缓存状态，所以不能把第一行自动称为 cache miss、后一次自动称为 cache hit，也不能用诊断的成功时间回填原三十秒失败。

## 有限 oahd 查询与官方机制

原 [oahd-query.json](../evidence/client-macos-x64-cache-identity-readonly-20261021/oahd-query.json) 仅查询 `oahd*` 事件、消息中包含这两个本项目 App 的完整绝对路径，并严格限定 `2026-10-21 03:05:54+0800` 至 `03:06:27+0800`。原命令 timeout 10 秒、exit 0、无 stderr，匹配 0 行。未扩大到其它 App 或时间段；0 行也可能受保留、隐私或事件格式影响，不能证明没有翻译。

Apple 说明 AOT 补充签名绑定原 x86_64 CodeDirectory hash，运行时向 Rosetta 服务查询可用翻译；缓存位于服务独占的 Data Vault。这说明身份相关性为何值得检查，不代表本 case 已观察到 cache miss。见 [Apple Platform Security：Rosetta 2](https://support.apple.com/guide/security/rosetta-2-on-a-mac-with-apple-silicon-secebb113be1/web)。

若将来另行授权最小观测，应保留同一不可变产物与原 30/10 限制，仅在原启动前开始带绝对 App 路径和已知 Main PID/birth 的有限旁路系统事件收集，并对齐原 spawn、launchMarks、file-target 时刻；若没有明确 cache hit/miss/翻译耗时事件，继续报告不可归因。不得通过清缓存、重签或复制制造“cold”，也不能拿 inspector 运行的不同时间条件证明原首启原因。本轮不执行该建议，不改变任何已完成用例的判定。
