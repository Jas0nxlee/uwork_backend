# Mac 拒锁副实例修复候选正常打包核验（2026-10-21）

修复候选提交为 `0aeff9adda8b3dd23103cb8dfa6c0cf735d6dbc2`。本报告只证明正常打包及静态产物合同；尚不证明副实例十秒内真实退出、工作区已转发或原七项联动通过。x64 后续运行是 Apple Silicon 上 Rosetta，不代表物理 Intel 验收。

正常 producer 依次执行 `prepare:runtime-assets`、`build:no-runtime-assets` 和原 `electron-builder --mac --<arch> --dir --publish never`，六条命令全部退出 0。使用明确白名单环境、生产/Preview、原构建环境守卫、原 ad-hoc 签名及独立 Library/Caches 输出。未重建 CDF Agent、未启动 App/GUI/VM，未发布或公证。构建脚本与精确 29 个选定源码输入见 [独立准备目录](../data/sandbox-verification/macos-secondary-exit-build-20261021)。选定源码与该提交原字节一致，不把整个仍有既存改动的工作区称为 clean。

| 项目                          | 新 x64 v11                                                                               | 新 ARM64 v12                                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Manifest                      | [原文件](../evidence/client-macos-package-v11-x64-secondary-exit-manifest-20261021.json) | [原文件](../evidence/client-macos-package-v12-arm64-secondary-exit-manifest-20261021.json) |
| Manifest SHA256               | `85abca6169f16b9933f7ab02c8f1c965e53a97e7ae0283f775abaee76b91d2c0`                       | `ad3971e5cb331f423a166733546d98d1711f4d2b1449fd75f12a6bee22029871`                         |
| app.asar SHA256               | `f93b2ae17a913a3a7c1fadb53e02f4a348e4e72b9a493175376c615f9c0ed992`                       | `b078337e6f12bdee343986a5f99155e3f1dd996e5008cb503309ce655a053aa5`                         |
| 实际资源 / Native Mach-O      | 8 / 11，x86_64                                                                           | 9 / 12，ARM64                                                                              |
| 原 Swift 可选 helper          | 原正常构建警告并真实 absent                                                              | 原正常编译、真实 present                                                                   |
| 原 builder 签名与再次严格核验 | exit 0                                                                                   | exit 0                                                                                     |

CDF 始终为 `cdf781ecf004b9639157fae25e6e96e558b95faefaee7aab09488d5dc650ecac`；Provider 与固定 Native 资产保持原对应架构摘要。29 个选定输入、Server/Native 12 个冻结源在每轮构建前后相同；旧 v6、v7、v8、v9、v10 全 App 树及 manifest 保持，新 v11 也在 v12 构建前后受整树核验保护。每包的 `reviewed-sources/` 保存了选定 29 个源码原字节。

静态只读提取的新 Main 确认包含拒锁分支 `exit(0)`、持锁条件后的环境准备及原 `whenReady` 拒锁 guard。实际 fuse wire 与各自旧包相同；没有翻转 fuse 或在包后改字节、补签。x64 初次额外检查看 minified 代码的未压缩变量词而失败，随后依实际发射的锁变量控制流核验；该设施检查不作为产品失败，收据已注明。

ARM 首轮 verifier 的额外“所有非 asar 与 v10 同字节”检查真实失败，原 verifier 与 [失败收据](../evidence/client-macos-arm64-secondary-exit-package-v12-20261021/static-verification-failure.json) 保留。原 Swift helper 正常重编译后长度仍为 89392，新完整 SHA 为 `f08de0fa0941f5a3d82e064a8ec19fb54e546b819d4f8faba1f48e83c7e98349`。独立 [只读审计](../evidence/client-macos-arm64-secondary-exit-package-v12-20261021/helper-readonly-peer/result.json) 证明 78 个差异字节仅在 LC_UUID 和签名区；全部 22 个 section、20 个文件段、符号和反汇编一致，签名代码页均按实际字节重算通过。Root 授权的 v2 verifier 只为这份精确审计及新完整摘要设例外，其他固定资源仍逐字节约束；原 App 丝毫未改。不把 normalized hash 当作实际 helper 摘要，也不把 UUID 差异原因归为已经证实的 PID 影响。

各产物收据：

- [x64 原命令与完整核验](../evidence/client-macos-x64-secondary-exit-package-v11-20261021/result.json)、[fuse/Main 只读核验](../evidence/client-macos-x64-secondary-exit-package-v11-20261021/fuse-and-main-static.json)。
- [ARM 原命令与完整核验](../evidence/client-macos-arm64-secondary-exit-package-v12-20261021/result.json)、[fuse/Main 只读核验](../evidence/client-macos-arm64-secondary-exit-package-v12-20261021/fuse-and-main-static.json)、[新严格 loader 9 项实际读文件/签名合同](../evidence/client-macos-arm64-secondary-exit-package-v12-20261021/loader-green.log)。

接下来仅按新严格 loader、fresh profile 和 Root/peer 冻结计划进行单次原七项 Native 联测。原 30 秒 renderer 就绪、原 1c 副实例完整函数、stdio ignore、十秒期限和业务断言保持；副实例 exit 0 本身不能替代原 UI 工作区真实转发。旧失败与旧 v9/v10 产物不改写。
