# 普通用户 deb 实际协议补测

同一个新原deb已完成真实安装、普通UID内容核对、原系统URI取消/允许及长确认期间并行URI握手；新镜像的原dpkg purge也通过。协议通过范围限定**允许user namespace的临时外层容器**；默认外层seccomp的拒绝仍保留，不宣称所有物理Linux/SUID fallback已修复。

## 当前安装与内容核对

- 原产物：`data/sandbox-verification/linux-native-packaging-v9-20261020/output-v2/UWork Preview-3.16.0-linux-arm64.deb`，**131,741,824 bytes**，SHA256 `f7f25e0279d045b069fa879ec224aacdce630a30edaed57b0c655b7e00dce68a`。源文件和复制输入分别重算一致。
- 消费镜像 `uwork-linux-desktop-installed:20261020-v4-async`，不可变image ID `sha256:7615e2f3dca262a77a0936d8bdc776019764d11504962ca18d6cf6e4103b3cf3`。以已有完整工具v6-capture为基座，仅替换原installer的FROM；已实查基座未安装zcode-preview，实际apt输出Selecting/Unpacking/Setting up新包，非同版本被跳过。
- 新镜像由UID1000/GID1000检查：`zcode-preview 3.16.0 arm64 installed`；系统launcher最终指向`/opt/UWork Preview/zcode-preview`；五core字节/SHA与本轮v9输入`expected.json`全部一致，目录可遍历、文件可读、原程序可执行。
- 新`resources/app.asar`为283,366,250 bytes，SHA256 `4f716c13f57315ab5992a6ba1b831ee2665dc6ab2db8e0eda0d3e65ddbac5034`。系统desktop原Exec保留带空格路径的双引号，声明`x-scheme-handler/zcode`；这还不是实际URI通过。
- 第一次内容检查错误地要求`pty.node`共享库具有X位，产生EACCES；这是测试断言错误。共享库需要可读/可加载，不能要求文件执行位；只修检查器，未改包权限，原失败留存。后续完整五core检查通过。
- 同一次all4 producer后续在rpm压缩发生VM OOM，不影响此前已完整形成并固定SHA的本deb；最新rpm/pacman待独立补产，不称最新四格式全通过。

上述证据为`evidence/client-linux-deb-protocol-v4-20261020/artifact-provenance.json`、`consumer-build.log`、`installed-content.json`与`installed-content-red.json`。后续运行及purge结果如下。

## 同包、同UID、不同外层seccomp的实际结果

默认外层参数使用原probe，没有修改Main、`.desktop`或产品flags。证据`evidence/client-linux-desktop-deb-protocol-async-v4-20261020/result.json`为**failed**：首次正常启动、成员恢复和工作区均通过，但原`xdg-open`启动的secondary在到达确认前报`LaunchProcess: failed to execvp: /opt/UWork`及zygote fatal。opener虽返回0，不能据此判协议成功。该轮39.008秒结束，容器exit0、网络/卷/tunnel全部清理，模型/账本0。

随后通过独立`run-deb-userns.py`仅为这个精确具名的外层`docker run -d`添加`seccomp=unconfined`，其余UID1000/GID1000、cap-drop ALL、no-new-privileges、只读镜像、原产品flags与注册入口不变。没有改shared probe/fixture或产品源码，且只执行一次目标启动注入。两个运行的不可变image ID相同，用户desktop文件逐字SHA也相同。

`evidence/client-linux-desktop-deb-userns-v5-20261020/result.json`为**passed**，35.247秒：

| 检查          | 实际结果                                                                                                   |
| ------------- | ---------------------------------------------------------------------------------------------------------- |
| 原系统URI入口 | `xdg-open`与原`zcode.desktop`，同一HOME/userData/sessionData；两个具名动作的原launcher均exit0              |
| 原确认属主    | 取消、允许两个GTK确认框都属于原Main PID68                                                                  |
| 长确认并发    | 取消确认保持未决25.109秒；期间原系统入口再发未知URI，launcher exit0；等待后Main集合只剩`[68]`，原exe仍存在 |
| 原取消        | 原工作区`project`保持，dialog正常消失，原实例仍存活                                                        |
| 原允许        | 原工作区切到`protocol space 测试`，dialog正常消失，原实例仍存活                                            |
| 原后台计量    | 两阶段供应商/模型调用0、账本0；最终持久化与shutdown前proof一致                                             |
| 清理          | 原shutdown、container exit0；container/network/volume/tunnel/browser-harness均关闭                         |

100ms内核采样共335次，捕获24个原包进程，所观测real/effective/saved/fs UID/GID均1000。三个真实secondary Main为296、687、1269，初次argv均是完整的`/opt/UWork Preview/zcode-preview`与各自URI，**没有`--no-sandbox`**。对应zygote进入嵌套PID/user/net namespace：308/316、698/700、1275/1283；它们在完成通知后退出，没有变为长期重复Main。

**初实例仍使用原测试fixture显式`--no-sandbox`**，其`Seccomp=0`是预期值。本轮不把初实例renderer冒充sandbox正例，也没有硬要求短命secondary先创建renderer/进入Seccomp2。独立Chromium renderer sandbox正例仍是之前[v6原始内核验证](client-linux-sandbox-test-2026-10-20.md)，范围不混算。

内核数据、外层实际参数与source SHA见`userns-kernel.json`和`userns-comparison-controller.json`。较早一次只读进程采样发生在默认运行容器已经移除之后，未得到数据，已保留missed记录，不用于任何内核断言。

## 路径空格报错的定位及未修复边界

系统及用户desktop原文均为`Exec="/opt/UWork Preview/zcode-preview" %U`。系统入口只经过symlink到ELF二进制，不存在拆参shellwrapper；`chrome-sandbox`实为root:root、4755的ELF，未发现CHROME/ELECTRON/APPIMAGE环境覆盖。默认外层同UID的`unshare -Ur /bin/true`为EPERM。

结合一变量实测及对应Chromium146官方源码，错误符合：userns不可用→选择SUID helper→把带空格的裸helper路径作为wrapper字符串→wrapper按空格分词，尝试执行`/opt/UWork`。`SetuidSandboxHost`直接传helper路径，`CommandLine::PrependWrapper`会分词；这解释了错误前缀，但本轮没有运行SUID分支的execve syscall trace，所以明确是源码与对照共同支持的定位，不冒称已捕获该系统调用。[zygote选择逻辑](https://raw.githubusercontent.com/chromium/chromium/refs/tags/146.0.7680.216/content/browser/zygote_host/zygote_host_impl_linux.cc)、[SUID helper wrapper](https://raw.githubusercontent.com/chromium/chromium/refs/tags/146.0.7680.216/sandbox/linux/suid/client/setuid_sandbox_host.cc)、[wrapper分词](https://raw.githubusercontent.com/chromium/chromium/refs/tags/146.0.7680.216/base/command_line.cc)。

原`.desktop`引号错误没有得到证据支持；允许userns后，完全相同的desktop/原路径/原flags已经通过。未改产品安装路径、未复制二进制到无空格路径、未持久化`--no-sandbox`，也未改VM全局安全策略。默认Docker限制及不支持userns时的上游SUID空格路径仍开放，不将其写成已修复。

## 实际purge与独立核对

另一新建、无GUI、无外部网络、cap-drop ALL的容器对同一安装镜像执行原`install-lifecycle.mjs`。`dpkg --purge zcode-preview`成功；包目录、`/usr/bin`启动链接、alternatives和系统desktop全部消失。原postrm有dangling alternative自动移除提示，最终无残留；未手改postrm或删除镜像。

`evidence/client-linux-deb-protocol-v4-20261020/install-uninstall-result.json`记录purge；同目录`independent-verdict.json`独立核对12项通过，含五core/同镜像/同desktop、实际UID、secondary完整argv与namespace、两决策/25秒并行/零计量、purge和收尾。六个具名容器已不存在，四个本轮CDP/control端口已拒连。首次独核误按数组顺序比较Docker安全选项，已改为精确集合比较，不重跑业务、不放松实际选项。

R02的“支持userns环境下普通UID deb系统URI”具名范围已通过；物理Linux、GPU、完整SUID fallback及其他安装形态仍分列。未执行新的GUI或触碰受阻企微页面。

## 旧证据与当前要验证的差异

- 旧 `uwork-linux-desktop-installed:20261020-v1` 是真实 apt/dpkg 安装镜像，系统 `/usr/bin/zcode-preview` 经 `/etc/alternatives/zcode-preview` 指向 `/opt/UWork Preview/zcode-preview`。历史9项/21原动作、两次本地模型/44 Credit及purge结果见 [PTY/deb报告](client-linux-pty-installer-test-2026-10-20.md)。这是旧产物，不作为本轮新Main验收。
- 普通UID旧v1遇安装目录权限EACCES；v2/v3已通过10项具名业务与UID核对，但协议分别卡在xdg helper和含空格二进制路径/zygote启动。对应失败记录保留，不因业务通过关闭协议。
- 系统opener launcher返回0不等于detached Electron已退出。本轮保留原确认长时间未决，再发并行URI，必须核对真实Main存活集合和原PID/锁不被替换。
- 本切片沿既有容器参数使用`--no-sandbox`；普通UID不等于Chromium sandbox，后者已有 [v6独立内核证据](client-linux-sandbox-test-2026-10-20.md)，不能移植为新deb的sandbox通过。

## 预先登记的验收方案（执行结果见上）

1. 从root交付的实际deb读取字节数、SHA256与dpkg元数据，禁止只按文件名/版本号认包。元数据必须为`zcode-preview 3.16.0 arm64`；真实SHA以新产物独立读取结果为准，当前不填旧SHA。
2. 消费镜像须真正执行原deb安装脚本，记录不可变image ID和`dpkg-query` installed状态；不能只解包deb或借旧安装目录。现有probe必须显式传新`--image`，避免落回旧默认镜像。
3. 比较安装后的五个原文件与同一新producer输入和新AppImage内容：`zcode-preview`、`resources/app.asar`、`resources/glm/zcode.cjs`、`resources/config/provider/zcode-builtin.json`、原`pty.node`。逐个字节数/SHA256一致；核对目录可遍历、文件可读、程序可执行及实际launcher最终路径。旧expected不能替代新Main产物。
4. 只在root释放GUI后启动一个测试容器。依赖须含Xvfb/Openbox、xdotool、xdg工具、`libglib2.0-bin`及既有原后台运行依赖。新HOME、数据根、SQLite、普通成员和internal网络，未附着用户Chrome，不动真实安装/VM生命周期。
5. 使用未修改的原驱动参数：`python3 scripts/tests/linux-desktop/probe.py --name <新client-linux-desktop-证据名> --ordinary-user --installed --protocol-only --window-manager --protocol-hold-seconds 25 --image <新镜像>`。

## 应取得的运行证据

- 原`/usr/bin/zcode-preview`启动，原app.asar页面、成员恢复和工作区到达；后台与Main/Host采用UID1000。
- 原产品注册`zcode.desktop`，实际`xdg-open zcode://workspace/open?...`到原PID的GTK确认；父窗口和dialog归原实例。
- 第一次确认保持未决25秒，其间再次原系统入口发送未知URI；两个opener真实结束、第二实例Main实际退出，仅原Main留下，不能用opener返回0替代这一条。
- 原取消不切工作区；原允许切到含空格/中文的目标目录；确认前不提前信任外部目录。模型、供应商、账本全程零增量。
- 原实例仍活、原二进制不被删除，且测试后台原shutdown、容器exit0、容器/网络/volume/tunnel/browser-harness都关闭。失败则保留原日志、截图、Main PID集合及真实退出证据，不静默改断言。
- 另开一个无GUI新容器执行原`install-lifecycle.mjs`：实际`dpkg --purge zcode-preview`后，包目录、launcher、alternatives、系统desktop文件均不存在；原不可变安装镜像保留。purge root仅限一次性容器。

最终报告应填写新deb与image的实际摘要、每条检查的原证据路径及结果；物理Linux、FUSE、GPU、rpm/Arch安装、Windows与生产部署仍分列。外部MCP和网盘不测试，本切片不触碰受策略阻止的企微授权页面。
