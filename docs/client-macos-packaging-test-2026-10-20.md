# macOS ARM64 打包补测

后续 v3 包已真实启动并完成后台/Host/CLI 发送、分享发布和系统剪贴板复制，见[打包态运行报告](client-packaged-runtime-test-2026-10-20.md)。该报告也保留剪贴板恢复事故及启动工作区疑点，不能仅按本页的构建 GREEN 判整体完成。

已在独立缓存目录生成 UWork Preview 3.16.0 的 DMG、ZIP 和 `.app`，没有安装或覆盖 `/Applications/UWork.app`，没有发布。

## 构建修复

`build-macos-window-bounds.mjs` 原无条件编译 ARM64、x86_64 并拼 universal。本机只提供 ARM64 的 Swift 静态兼容库，因此已能编出的 ARM64 辅助程序也无法发布到固定输出路径。实测保留于 `evidence/client-macos-runtime-assets-20261020.log`。

现复用 Desktop 目标解析器，只编译所需架构；按 `-arm64`/`-x64` 分开构建源文件，打包配置选择对应架构、包内名称不变，避免不同架构在同 checkout 互相覆盖。本机架构另外原子更新开发态固定路径。编译或 SDK 缺失时清除过时的目标产物，保留已有可选能力降级规则。规格见 `clients/uwork/specs/macos-window-bounds-build.md`。

三项原始回归先 RED，修复后连同缺 SDK 路径共 **4/4**；按架构隔离输出的补强也取得 RED→GREEN。真实 ARM64 Swift 编译成功，Mach-O 架构正确，实际启动收到合法 JSON 帧并关闭。x64 仅编译器合同测试，未冒称实机编译。

## 已验证的 v2 安装包

目录：`/Users/ljp/Library/Caches/uwork-backend/client-macos-package-20261020-v2`。

- 打包 exit 0；`codesign --verify --deep --strict` 通过（ad-hoc 签名，无 Apple 公证）。
- DMG `hdiutil verify` CRC 校验通过，174.0 MiB，低于现有 500 MiB 门禁。
- ZIP 174,256,568 字节，SHA256 `7aaedb3652d04e888a8ae1435996ee4efa817548220d740cf7e8e964a7fbd741`。
- DMG 182,500,337 字节，SHA256 `85c9bf3b9b57b054290f1ea65373776f4eeb8aa8de48d383896ac97d74f42f25`。
- 包内 `app.asar`、CLI、默认配置、Provider 配置、ARM64 窗口辅助程序和第三方声明均存在。manifest：`evidence/client-macos-package-manifest-20261020.json`。

初次在工作区 data 目录生成的包在 codesign 阶段被 resource-fork/Finder 元数据拒绝。已有 afterPack 本就清理生成包的 xattr，本轮没有关闭签名或改签名规则；改到专用缓存目录重新生成成功。无法仅凭这一对运行确认元数据的具体写入来源，原失败日志保留。

## 当前进度及继续入口

- v2 是最终“按架构分开源文件”调整之前的完整压缩包；它的签名与内容结果成立，但不能冒称最终打包配置已跑过。
- 最终配置的 v3 `.app` 已通过原 electron-builder 配置重建（`--mac --arm64 --dir --publish never`），exit 0，`codesign --verify --deep --strict` exit 0，包内窗口辅助程序仍为 ARM64。输出 `/Users/ljp/Library/Caches/uwork-backend/client-macos-package-20261020-v3`；日志 `evidence/client-macos-package-build-v3-20261020.log`；最终包内 SHA 与退出码见 `evidence/client-macos-package-v3-manifest-20261020.json`。
- 后续已实际启动此 v3 `.app` 并完成隔离联动及退出；运行结果与 OS 状态恢复见上述报告。不能拿开发态 Electron 结果替代，也不能把当前包的结果推广到三平台。
- 当前配置没有 `.release-config/enterprise-identity.json`，不能运行会接触真实企微的原 packaged QR 测试；后续只使用已授权的本机受控后台。
- 类型/Lint/架构通过（113 既有 warning、0 error、0 架构违例）。Windows/Linux、签名发行、生产部署仍未验收。
