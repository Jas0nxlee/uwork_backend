# Windows 运行输入只读审计（2026-10-21）

本轮仅检查现存源、依赖和缓存，没有联网、下载、交叉构建、运行 PE/Wine、启动 VM、安装应用或连接 Windows 主机。未发现产品源码的新确定缺陷。本机当前没有已识别的授权 Windows 执行目标；Windows Native 安装、UI、PTY和后台联动仍未验收。

## 正式目标与依赖

正常发行清单 `clients/uwork/scripts/desktop-release.mjs` 的 Windows 正式目标只有 `win-x64`；Desktop 使用 NSIS，可选择安装目录。源码另有 ARM64 构建分支及 ARM64 预编译文件，不表示 ARM64 已发布或实际验证。

Desktop 与 Server（`packages/server`，不是 CLI 包装层）均精确声明 `node-pty=1.1.0`。原 Node `createRequire` 从两 owner 的 package.json 实际解析到同一 `clients/uwork/node_modules/node-pty/package.json`，实际版本为1.1.0。Windows使用该包自身的 `prebuilds/win32-x64`，没有混用 `@lydell` Windows 包；Server 的四个 `@lydell` 1.1.0依赖只面向 Darwin/Linux。锁文件的注册表 integrity 已记录，但本轮没有重新取得或核验官方完整 tarball，不能把本地 metadata 当作独立供应链证明。

## 已存在 Windows PE

实际读取14个 node-pty运行文件的完整SHA和PE头：x64七个全部是 `AMD64/0x8664`，ARM64七个全部是 `ARM64/0xaa64`，均为PE32+。每组含 `pty.node`、`conpty.node`、`conpty_console_list.node`、`winpty.dll`、`winpty-agent.exe`、`conpty/conpty.dll`、`conpty/OpenConsole.exe`。三种 `.node` 均导出 N-API 注册符号，未在Mac加载或执行它们。

Windows x64的 `pty.node` 为303,104字节，SHA `ae323edd0835ee7b9e18cc96a7b2bb4b8173ff768317d178af2788406feb71ff`；`conpty.node` 为312,320字节，SHA `ee8f4e6f4dad71939eecfda11de249400e34bfefe4c8b48af13f3b5476f4035b`。包内 OpenConsole/conpty DLL 的真实 VERSIONINFO 是1.23.2510.8001，这是其独立组件版本，不是 node-pty JS/native 混版证据。检测到证书表只表示数据存在，本轮不声明 Authenticode 信任验证通过。

另只读记录了现有 electron-builder NSIS缓存的11个 `.exe`；它们是打包工具，不是 UWork客户端。固定 Electron缓存根没有 Windows Electron ZIP。当前 Desktop `bundled-tools/win32-x64` 不存在，Windows浏览器导入 helper和搜索工具没有本轮已准备的资源。

## 原 writer 与未完成输入

| 原路径                                             | Windows选择及边界                                                                                                                             |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/desktop/scripts/node-pty-rebuild.mjs`    | Windows已有目标 `pty.node` 时复用1.1原生预编译；缺失才 electron-rebuild。没有模拟或执行Windows分支。                                          |
| Desktop builder `files` / `asarUnpack`             | 只保目标平台，整个目标node-pty prebuild目录解包，涵盖winpty-agent及conpty依赖。`beforePack` 的 `@lydell` restore仅Linux执行，不覆盖Windows。  |
| `packages/zcode-server-cli/src/packaging/stage.ts` | node-pty只复制JS/lib/typings/license及目标prebuild，排除宿主build目录；Windows保原包目标目录，存在pty.node才接受。完整原Windows产物尚未运行。 |
| `scripts/zcode-distribution/assets.mjs`            | 四种POSIX `@lydell`原生替换与Windows stock目录分开；Windows文件仍来自原node-pty包。                                                           |
| `scripts/prepare-prebuilds.mjs`                    | remotePlatforms只有Darwin/Linux，不能把此链称为Windows远端组件验收。                                                                          |
| `build-windows-browser-import-helper.mjs`          | 非Windows明确skip；Windows需可信 `csc.exe`，默认Framework编译器，ARM64需显式可信Roslyn。Mac skip不能算helper构建成功。                        |
| `scripts/native-search-tools-windows.mjs`          | 原构建要求Windows host和Visual Studio17 2022生成器；本轮未安装工具链或执行交叉构建。                                                          |

嵌套 `clients/uwork/.github/workflows/desktop-release.yml` 有 Windows2022/x64 job；当前 Git top是本后端仓库，根活动workflow只有Ubuntu。嵌套文件本身不构成现有可用Windows runner或已完成CI，也没有推送/触发CI。其旧企微页面探针不能用于绕过已拒绝的真实授权页面。

## 证据与下一验收边界

[静态结果](../evidence/client-windows-runtime-input-audit-20261021/result.json)包含25个PE的机器类型、字节、SHA、版本资源和原writer源SHA；[实际依赖解析](../evidence/client-windows-runtime-input-audit-20261021/resolved-node-pty.json)记录两个owner；[离线复现脚本](../evidence/client-windows-runtime-input-audit-20261021/audit.py)只读取固定项目/工具链资源并写本证据目录。

已验证旧Mac plugin37和TTL44来源SHA不变。Windows后续仍需授权执行入口，才能完成正常Windows producer、真实安装/卸载、原生工具加载、UI及后端联动；PE存在、N-API符号或静态平台分支测试均不能替代这些验收。
