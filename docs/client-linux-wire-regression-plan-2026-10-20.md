# 当前 wire/reload 源的 Linux 原包有限回归准备

状态：本计划编写时为只读准备；随后正常hostdir/AppImage生产和单格式核心权限验证已完成，v1真实GUI被agent误TERM中断，fresh v2仍prepared-only。实际进度与原失败见 `docs/client-linux-wire-regression-test-2026-10-20.md`。Root统一安排共享out与Linux VM排他窗口；旧asar3658/cdf的具名通过不代表本轮新wire/reload源的原包通过。

## 输入与来源

2026-10-20只读收据：`evidence/client-linux-wire-readonly-inputs-20261020.json`。测得HEAD `1bd1ec7b9949353ae11390e020a58b0fe7719c3e`，包含wire `1bd1ec7b`、reload `263146f4`、RPM配置 `220ba514`。本次准备只读取这些源/资产并记SHA，未改共享out、bundled-agents或target prebuild。

| 输入                                   | 当前字节/SHA或边界                                                                      |
| -------------------------------------- | --------------------------------------------------------------------------------------- |
| 源CLI dist及原linux-arm64 staged Agent | 两者16579914字节，均 `cdf781ecf004b9639157fae25e6e96e558b95faefaee7aab09488d5dc650ecac` |
| linux-arm64 pty.node                   | 69112字节，`d8314caa682827c0bcab6a7a2ef121a17065605e830d5eac55de3245333b3ad8`           |
| wire工厂/提取器源                      | `619377c7458d678d1f1c585981cc8daf34996618dcd7a75970b51025dfab3100`                      |
| reload Hook源                          | `93db5b44f1ebd99eb5d373375541e478ebe865eec18b268227afc63f90836866`                      |
| 正常electron-builder配置               | `0c3e82291f696773025f4d6e36589cc205143b1051b783a598436c5e7819ec09`                      |
| 原Electron / builder                   | package脚本锁定Electron41.10.7；原native packager安装builder26.8.1，不改fuse/runtime    |

原Clock包来自 `evidence/client-sqlite-clock-desktop-package-manifest-20261020.json`，旧asar3658、AppImage629f；仅供已通过历史的来源对照，不复用其desktop archive冒称新源。原Mac v7签名包与旧Linux缓存不覆盖。

## 正常生产步骤（仅方案，尚未执行）

1. Root授予单一producer共享out所有权后，冻结源SHA与HEAD；按现有干净env规则移除继承ZCODE/UWORK/ELECTRON/BU/BH/BROWSER/NODE_OPTIONS/NODE_PATH/签名身份，再设原production/preview、target linux/arm64与全新Cache输出路径。复用原build-env-guard只防止构建读取生产`.env`，不注入产品运行时。Node24/Pnpm路径沿既有正常Mac/Linux producer。
2. 在`clients/uwork`执行原 `pnpm --filter @zcode/desktop build:no-runtime-assets`。只建本轮桌面源，不执行会重建Agent的 `prepare:agent-bundle` / `prepare:runtime-assets`，现有Linux staged cdf已有来源及SHA。若正常builder发现缺失受支持资产，先记录缺项，再由Root安排其原producer；不能临时复制假资产。无需Server重建。
3. 在desktop目录原 `pnpm exec electron-builder --config electron-builder.config.js --linux --arm64 --dir --publish never`，输出全新 `~/Library/Caches/uwork-backend/client-linux-desktop-package-wire-20261020/linux-arm64-unpacked`。记录原beforePack的linux-arm64 pty恢复、原afterPack模块/资源政策/asar完整性，构建前后源及Agent SHA。实际新asar此时才产生，不能提前用旧值填入。
4. 保存新的5运行时文件：`zcode-preview`、`resources/app.asar`、`resources/glm/zcode.cjs`、public provider、unpacked linux-arm64 pty。原目录整体归档至fresh输入，保留清单/源与复制SHA。不解包改写产品。
5. Root在backend释放VM重压缩窗口后，运行原 `prepare-native-packaging.py --name linux-native-packaging-wire-20261020` 创建新tracked配置快照（包含当前220配置），build全新packager tag。原 `native-package.sh AppImage` 单target采用新desktop.tar.gz、正常压缩与publish never，不并发其他格式生产。不能用旧packager snapshot声称当前配置已载入。
6. 新consumer只把这份AppImage保存为 `/opt/artifacts/uwork-preview.AppImage`，沿原既有测试镜像/WM依赖建立fresh tag；保留真实新AppImage SHA、image ID及input expected文件。运行前核AppImage、新asar/cdf；运行中回读真实提取目录SHA，不能仅凭镜像tag。

上述步骤都仍待调度，没有执行命令或创建新输入archive/image。Server/cdf不重建，Mac/x64 asset producer不并写共享目录。

## 一轮最小真实回归

原已有入口 `scripts/tests/linux-desktop/probe.py` 不需要增删业务步骤。待新consumer/expected SHA独审及唯一Linux GUI窗口后，以fresh profile运行：

```sh
python3 scripts/tests/linux-desktop/probe.py \
  --name client-linux-desktop-wire-appimage-v1-20261020 \
  --image <new-frozen-wire-consumer-tag> \
  --ordinary-user --appimage --pty --protocol \
  --window-manager --protocol-hold-seconds 25
```

原入口已包含以下有限真实断言，复测一轮即可，不重复历史四格式大全：

- 原Main/Host/Agent、原asar renderer，UID/GID1000；自有后端/身份及原onboarding，File UI实际读sentinel。`Page.reload`后原身份/项目保持并沿原File入口再次读文件，对应当前reload改动。
- 原terminal输入只操作自有文件，真实shell cwd/tty/PID与副作用一致；隐藏/重新显示保留同一live PTY。
- 原composer发送到自有受控supplier，2次真实请求/2笔settled账本44Credit，生产spawn preflight/started PID绑定真实包内CLI与cwd；原席位撤销后再次原composer请求得到原拒绝，supplier/两笔账本无增量。这里“两笔”是同一受控身份的两请求键，不泛化为跨成员隔离覆盖。
- 原系统xdg-open/.desktop真实URI，原GTK dialog所有者、cancel等待25秒、第8秒第三未知URI自然ACK，原Main不换代；cancel保project、confirm才切自有中文空格目录，计量无增量。原Linux `/proc/exe`与Node-mode CLI的生产证据按原protocol合同区分，不套Mac的ps argv启发式。
- 原shutdown后Main/Host/Agent/PTY、4端口/CDP/tunnel/BH、container/network/volume关闭，最终proof与shutdown前一致；任何失败都保原证据并先完成owned资源闭合。

保留原probe默认seccomp/权限设置，不把某次sandbox=false或临时outer unconfined对照称为安全正例。若新源触发设施或产品问题，先记录真实边界再窄修，不通过隐藏入口、改required或弱化权限求绿。此次不覆盖真实FUSE/物理Linux、全局用户桌面安装、Windows/x64、企微OAuth或受拒remote provider runtime；外部MCP/网盘继续排除。
