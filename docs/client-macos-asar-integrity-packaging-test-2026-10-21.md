# Mac ASAR 最终元数据修复的正常包验证（2026-10-21）

源提交 `f4cac9136226bc7e94edd9fcf8d2bba38f327803` 的正常 ARM64 v13、x64 v14 包已串行产出。两包最终 ASAR header 的原 UTF8 JSON 字节 SHA 与实际 Info.plist 声明相同，严格签名通过。这里只接受正常构建与静态检查；本轮没有启动 App、Native UI、模型或后端服务，不宣称 x64 原三十秒准备门、架构提示或业务验收已经通过。

## 制品与正常流程

两架构均使用清理后的显式环境、原 build-env guard，顺序执行 `prepare:runtime-assets`、`build:no-runtime-assets`、原 electron-builder `--mac --arm64/--x64 --dir --publish never`。六条命令实际退出码全为 0，原 ad-hoc 签名和 notarization 设置不变。没有重新构建 Agent、修改输出包字节、替换 helper、翻转 fuse、重新签旧包或发布。

- ARM64：[v13 manifest](../evidence/client-macos-package-v13-arm64-asar-integrity-manifest-20261021.json)，SHA `4bb6f40d4fa18670e0a05d4f8ebeb0114f72fac4fe3cb3b583e26848b051c756`；实际 App 为 `/Users/ljp/Library/Caches/uwork-backend/client-macos-package-20261021-v13-arm64-asar-integrity/mac-arm64/UWork Preview.app`。
- x64：[v14 manifest](../evidence/client-macos-package-v14-x64-asar-integrity-manifest-20261021.json)，SHA `4fb0ae63377480fba47ccb41c47125fd16df109f2fe45a83812aaaa8c49b8cd9`；实际 App 为 `/Users/ljp/Library/Caches/uwork-backend/client-macos-package-20261021-v14-x64-asar-integrity/mac/UWork Preview.app`。

控制脚本、33 个固定源的提交绑定、执行时序与收口见 [completion.json](../data/sandbox-verification/macos-asar-integrity-build-20261021/completion.json)。两包各自 evidence 中 `result.json` 保留完整命令和受控环境，`reviewed-sources/` 保留实际源快照。

## 实际 header 与资源核验

| 包        | 最终 header UTF8 字节数 | header SHA256（实际 Info 声明相同）                                | 完整 ASAR SHA256                                                   |
| --------- | ----------------------: | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| ARM64 v13 |                 6366105 | `198874ad12e181a31818e540a31a9976d990d66fa6c205875355b61c143fcb86` | `e17ddb3bf91604622f51b302f298f86e95e556fa2f76e804a5b065dac7427332` |
| x64 v14   |                 6366102 | `11746f3ec705855710e8b7125919c61e02b363ac75e1ce456ef055e4532527a6` | `3816d64028e4633d05a4e5d6d5206cbe90757b25804a4b529309c8a891baa314` |

匹配 installed app-builder-lib 的 `readAsarHeader` 和 @electron/asar `getRawHeader` 返回相同字符串；独立 Python reader 再按真实 Pickle ReadString 范围直接散列原 UTF8 JSON bytes。三者均与 Info.plist `Resources/app.asar` 的 SHA256 声明相等，排除整个 ASAR、Pickle envelope/padding 或规范化 JSON 误算法。实际收据位于各 evidence 的 `installed-header-readers-and-fuses.json`、`independent-raw-header-check.json`。

ARM64 实查 9 个 runtime 文件、12 个 Mach-O；x64 实查 8 个 runtime 文件、11 个 Mach-O，均为目标架构。五个原 core 资源完整摘要、全 ASAR、CDF Agent 和 provider 资源均核验；CDF 保持 `cdf781ecf004b9639157fae25e6e96e558b95faefaee7aab09488d5dc650ecac`。两包 `codesign --verify --deep --strict` 真实为 0。全部 fuse 值与同架构旧包相同，embedded validation fuse 4 仍为原始 `48`（disabled）；本修复没有启用它。

## ARM helper 首验失败与精确校准

ARM64 首 verifier 因可选 Swift helper 的完整文件 SHA 与 v12 不同而失败，原脚本、失败原因和已生成产物均保留于 [v13 首验收据](../evidence/client-macos-arm64-asar-integrity-package-v13-20261021/static-verification-failure.json) 与 `failed-verifier-exact.py`。

Root 独立新审显示，两个 89392B helper 的 76 个差异字节全部限于 LC_UUID 的 16B 及 CodeDirectory 派生 identifier/page-zero hash；22 sections、其它 load commands、nm、反汇编和其它签名数据一致，实际 6 页代码 hash 与严格签名均通过。精确审计见 [helper-readonly-peer/result.json](../evidence/client-macos-arm64-asar-integrity-package-v13-20261021/helper-readonly-peer/result.json)，摘要 `9a593bda13a058cbcd8075c8006bc4902b1470b0f9b52c77cc6871cbe158ba3f`。

经 Root 明确批准，新 verifier 只接受本次完整 SHA `91ecca093702aac8d812d668efcbe6ebce645db07d72f6b63355c1edc7bbeb34` 和该精确审计，保留其它非 ASAR 资源的原字节相等要求。没有用 normalized hash 代替真实 artifact 摘要，也不接受任意未来 helper 差异；UUID 变化的具体来源仍未确证。

x64 原 Swift 编译仍因缺少 x86_64 的 Swift compatibility 库发出原 warning，原 optional 规则正常继续；实际 helper absent，未伪造、降目标、禁用 autolink 或修改包资源。该限制见 [optional-helper-producer-contract.json](../evidence/client-macos-x64-asar-integrity-package-v14-20261021/optional-helper-producer-contract.json)。

## 保留边界与收口

原 29 源中只更新已提交的 builder config，另加 ASAR spec/helper/两测试共 33 源，均与固定提交内容相等且构建前后不变；五个 startup 源、Root 12 源、CDF、provider 保持。旧 v6–v12 App 整树（文件摘要、权限、符号链接）和 manifest 前后相同；x64 构建还保护了已完成的 v13 整树。

两个 producer 已自然退出，shared Desktop out/runtime assets writer 已释放，没有活动构建或 App。旧失败、旧 manifest 和旧包保持原样。此结果不证明完整 Swift helper x64 可用、物理 Intel、Windows PE 或 Native 客户端联动；后续原 Native 复测须使用新 manifest/strict loader 独立审定，不能由静态 header 修复推断历史 x64 性能问题已解决。
