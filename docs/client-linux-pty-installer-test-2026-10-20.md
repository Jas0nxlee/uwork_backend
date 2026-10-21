# Linux PTY 与 deb 实际安装联测（2026-10-20）

新增两种具名运行形态均通过九项检查、21 个原界面动作：原 unpacked 包的 PTY 增量，以及真实 deb 安装后从系统链接启动的完整联动。它们各用独立后台/SQLite/普通成员和数据根，各自两次模型调用、两笔本人 settled、24 input/20 output Token、44 Credit，撤席位后均无增量；不能把两组计量混为一次运行。

## 真实 PTY

[unpacked PTY v7 原结果](../evidence/client-linux-desktop-pty-v7-20261020/result.json)与[独立核验](../evidence/client-linux-pty-independent-verdict-20261020.json)：

- 原终端按钮 → 原 xterm → 原 TerminalService/node-pty → `/usr/bin/bash`。命令只由真实 UI 输入及一次 Enter 发送，后台控制端点只读观察，不执行命令。
- 自有文件首次不存在，随后写入固定 marker、`pwd`、`tty` 和 shell PID。shell PID 199 的实际 cwd 为 `/work/project`，活 fd/0 与命令回报的 `/dev/pts/0` 一致。
- 收起面板后，唯一包含本次 xterm 的 Panel 高度为 0；原按钮重开后为 236.40625 px，同一 PID/TTY 仍活。终端阶段供应商与账本基线均保持 0。
- 后续原发送、包内活 CLI/cwd、本人记账及席位撤销拒绝，沿既有七项业务全部通过。容器 exit 0，最终后台快照与关闭前一致。

早期失败保留：v1 悬停导致按钮/布局位置变化，原坐标打开标签概览；补真实指针移动后的坐标复核，实际记录 terminal-toggle 的 x 从约 812 变到 753。v2 在首启期间 CDP 超时并有关闭超时，原因尚未归因，后续同包多轮未复现，不能追认成已根治。v3–v6 的真实 PTY 写入已经成功，剩余失败是观察器将保活 DOM、aria、边框或透明度当成面板关闭条件；最终按唯一含 xterm 的 Panel 实际高度和同一活 PID 核验，不要求组件卸载。未改产品终端逻辑。

## 原 deb 生产与工具链修复

使用原 electron-builder 配置 `--prepackaged --linux deb --arm64 --publish never`，先将已验包复制到独立 staging，原包保持不变。原工具添加 package-type/app-update/AppArmor 资源，不手工组装或修改 deb。

1. 首轮因隔离 PATH 缺少 xz，原 gtar exit 2；[最小复现](../evidence/client-linux-deb-gtar-diagnosis-20261020.json)证明补入现有 xz 路径后 exit 0。
2. 补 xz 后 builder 返回 0，却生成 **96 字节**文件，ar 中只有 `__.SYMDEF SORTED`。[最小复现](../evidence/client-linux-deb-ar-diagnosis-20261020.json)证明本机 `/usr/bin/ar` 对普通成员同样返回 0 并丢失成员；此坏包及其 latest yml 保留。[Debian 工具确实拒绝它](../evidence/client-linux-deb-installed-20261020/artifact-protocol-verdict.json)，没有把进程 exit 0 当成安装器通过。
3. 安装 GNU binutils 构建依赖，仅本次命令临时优先 `/opt/homebrew/opt/binutils/bin`，没有改 shell rc 或覆盖系统 ar。[GNU ar 成员/内容保留验证](../evidence/client-linux-deb-gnu-ar-verdict-20261020.json)通过，再由原 producer 成功重打包。

有效包为 **133,579,920 字节**，SHA256 `476b62ccf77d51b25747e0882a76feafd78de8d5f78c868a91e5c7e3f787de18`。Debian 工具读取到 `zcode-preview / 3.16.0 / arm64`，latest yml 的大小与 SHA512 同实际 deb 一致。Homebrew 工具与构建缓存保留，未发布安装器。

## 真实安装、运行与卸载

- 新镜像用 apt 安装原 deb 及其声明依赖，真实执行原 postinst；不是仅解压安装包。`dpkg-query` 为 installed，系统启动链接 `/usr/bin/zcode-preview` 经 alternatives 指向 `/opt/UWork Preview/zcode-preview`。
- [安装后原 GUI 结果](../evidence/client-linux-desktop-installed-v1-20261020/result.json)九项/21 动作通过：从该系统链接启动，原 app.asar URL 位于 `/opt/UWork%20Preview/resources/`；读取/重载后重开文件、原 PTY/保活、真实后台发送/记账、活包内 CLI 与撤席位拒绝均通过。
- 安装后活 CLI PID 179 实际 executable 为 `/opt/UWork Preview/zcode-preview`，cwd 为 `/work/project`；PTY shell PID 217 绑定 `/dev/pts/0`。这里 PID 都属于各自容器，不映射为宿主 PID。
- [独立核验](../evidence/client-linux-deb-installed-20261020/independent-verdict.json)从同一不可变安装镜像读取，五个关键运行时文件与已验源包逐字节 SHA 一致；运行容器没有 `/app` 解压挂载，确实使用 dpkg 安装内容。
- [真实卸载结果](../evidence/client-linux-deb-installed-20261020/install-uninstall-result.json)：新容器执行 `dpkg --purge zcode-preview` 后，包目录、系统启动链接、alternatives 和 desktop 文件全部消失。原脚本有 dangling alternative 自动修复提示，最终状态无残留；没有根据静态脚本疑点擅改上游模板。`/opt` 中其他内容保留是正常行为。

原应用的 Linux 用户级协议 fallback 注册成功，独立读取到 `mimeapps.list` 的 `x-scheme-handler/zcode=zcode.desktop`，对应 Exec 指向安装后的二进制。原 Electron 注册接口失败、update-desktop-database 缺失日志同样保留；此项只证明注册落盘和原 fallback 成功，未执行真实 URI 回调登录。

## 清理与边界

两组后台最终快照完整，容器 exit 0；各自 SSH/BH 宿主 PID、回环端口、容器/卷/网络独核关闭。真实安装/卸载的一次性容器也已消失，系统路径变更全部位于容器层。专用 Colima [恢复原 Stopped](../evidence/client-linux-pty-installer-colima-final-20261020.json)，另外两个 profile 保持 Stopped。测试根、包、镜像和证据保留；本轮未修改宿主 UWork 安装或剪贴板。

测试设施 Lint、Python 编译与 diff whitespace 通过。本轮无产品代码修改，修复的是观察器和本机构建工具链。真实企微、外部 MCP、网盘继续排除。

deb 容器验证不代替普通用户的物理 Linux 桌面/GPU/Chromium sandbox、真实协议回调、rpm/AppImage/pacman、Windows、目标生产部署或远端 CI；首启的单次未归因超时仍保留。目标继续 active，不关闭整体跨平台验收。
