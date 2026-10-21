# RPM / Arch Linux ARM 真实安装运行卸载

当前状态（本轮最终）：原Fedora/Arch包管理器安装消费均已验证；RPM卸载真实RED修复后原新包同版DNF重装/卸载GREEN；Arch原pacman卸载GREEN。Fedora原GUI10checks、Arch独立业务11checks和原reload诊断10checks各具名保留，但系统URI均未达native确认，因此整组仍FAILED；Arch v2间歇reload/CDP超时未根因、未声称修复。新Mac/后续Linux包不在此immutable1db/cdf/3658范围。

本切片进行中。Fedora 原 dnf 安装、五个核心文件/权限已通过，真实 GUI 的 10 项业务、文件、PTY、撤权通过；整轮因原 generic xdg-open 派发失败仍为 FAILED。原 dnf remove 另发现真实悬空 alternatives 链接与空目录产品 RED，项目自有 hook 已修、11项永久回归和新原 RPM 同版DNF重装/卸载实际GREEN。Arch 正常依赖构建正在进行。旧 v9 四格式包仍是历史证据。

## 最新输入与生产

输入为 `data/sandbox-verification/linux-native-packaging-v10-20261020/input`，正常原预打包的 `expected.json` 绑定产品提交 `1db59c77`；后来测试工具提交不改变此产品载荷。五个核心文件及原归档均已独立重新计算摘要匹配，见 `evidence/client-linux-distro-bases-20261020/input-verification.json`。

- Agent：`cdf781ecf004b9639157fae25e6e96e558b95faefaee7aab09488d5dc650ecac`。
- app.asar：`3658e4731d2f23977b0bf0ecdf0a7378fa05d0bab531b12100904353b850fd4e`。
- 正常原镜像：`uwork-linux-native-packager:20261020-v10`，实际 ID `8b8562948a939a1efd3e039309cf0419e23e123ea1ddb8e749f60f352dd2c6a3`。

唯一 producer 顺序执行原 `/input/native-package.sh rpm` 和 `... pacman`，均自然退出 0。未改变源配置、压缩方式或包内容，没有并行 GUI，没有手动重压缩。不是一条 all-target 命令全绿。

新目录 `data/sandbox-verification/linux-native-packaging-v10-20261020/output-distro-v1`：

| 原包 | 字节 | SHA256 |
| --- | ---: | --- |
| RPM | 109361453 | `1045042df11d28b080436ce7b538e5f617447d0c01e345e76e08332701df0a31` |
| pkg.tar.zst | 168199531 | `30d89acee7f47a3db597c5a42a3c1b5da95872dc44da666245846b5e86893ac3` |

最后原单 target 生成的 YML 只有其自己的 pacman 项，未补造完整更新 feed，未签名发布。原旧产物及历史 OOM、禁网工具下载失败全部保留。

## 发行版来源与校验

Fedora 官方列出 ARM64 Container Base 和签名校验流程，本轮选择 Fedora 44 AArch64 OCI 原归档。官方 `fedora.gpg` 已真实验证 CHECKSUM 签名：指纹 `36F612DCF27F7D1A48A835E4DBFCF71C6D9F90A6`；原归档 SHA256 为 `eca19542a48a8e39b84e869713a1fa2408cbcc578de26c25ae72e3334ef968c1`。原 OCI config 为 Linux/arm64/v8，版本 44。来源：[Fedora Container downloads](https://fedoraproject.org/en/misc/)。

Arch Linux ARM 使用官方 AArch64 通用 rootfs 和原 detached signature，真实 `gpg --verify` 已返回 GOOD/VALIDSIG，精确匹配官网完整指纹 `68B3537F39A313B3E574D06777193F152BDBE6A6`。密钥来自公共 keyserver 后独立核对指纹；原 rootfs 为 829367415 字节，SHA256 `42a4eeaa038994ffd31fa173256ef2f0ef511358eeb41b9ea1f8626391b9b319`。官方 `os.archlinuxarm.org` / `mirror.archlinuxarm.org` 的 HTTPS 请求实际证书 hostname mismatch，本轮未绕过 TLS，而选用 TLS 正常的官方域 `ca.us.mirror.archlinuxarm.org`；原 rootfs 自带 mirrorlist 也列出此 mirror。原 pacman.conf 的 Required DatabaseOptional/LocalFileSigLevel Optional 已只读确认。来源：[Downloads](https://archlinuxarm.org/about/downloads)、[Mirrors](https://archlinuxarm.org/about/mirrors)、[Package Signing](https://archlinuxarm.org/about/package-signing)。

host 下载驱动前两次失败是脚本处理 `gpgv` 的 `.part` 输出及 CHECKSUM 注释行的错误，原签名已验证成功；这两条不是产品、签名或安装失败。原失败记录独立保留，后续驱动只读取验签命令实际正文中的精确 `SHA256 (filename) =` 行。

## 验收合同

`scripts/tests/linux-distro/README.md` 记录顺序计划。将通过发行版真实 `dnf install` / `pacman -U` 安装原 UWork 文件，依赖由各自签名仓库解析。没有 `--nodeps`、关闭仓库签名、TLS 跳过或将手解 UWork 包冒充安装。

独立 `run.py` 复用原业务、PTY、file、系统 URI 取消/确认/25秒并发断言，只将原测试夹具的 dpkg 专用观测改为真实发行版查询，并移除夹具显式 `--no-sandbox`。原共享脚本、桌面注册和产品包不修改。单独一次性外层容器允许 user namespace，保留 UID/GID 1000、cap-drop ALL 和 no-new-privileges；内核样本要求 renderer Seccomp=2，且与 Main 使用不同 user/PID namespace。

安装发生在原 consumer image 构建中，GUI 使用该已安装 image 的只读实例。卸载将在独立的同 image 副本调用原包管理器，并验证包数据库、原 manifest、launcher/alternatives、system desktop 与应用根残留。这是同一已安装载荷的生命周期验证，不写成同一个可写容器内完成全部事务。用户 profile 的保留和实际系统 URI 残留会分别记录。

## 资源清理与当前边界

两个 producer 已退出并移除。经协调者明确授权，仅专用 `colima-uwork-backend` 的未用 builder cache 已回收，10.25GB→0；磁盘 18GB→8.5GB，余约11GB。最新 builder、Clock AppImage image ID 和 host 新原包摘要均保留核对成功，没有全局 image/system/volume prune。

原始证据位于 `evidence/client-linux-distro-native-clock-v1-20261020/`：`production-result.json`、两个 production log、`disk-before.log` / `prune.log` / `disk-after.log`、`post-prune-preservation.json`、`consumer-contexts.json`、`driver-preparation.json`。发行版来源证据在 `evidence/client-linux-distro-bases-20261020/`。

本切片不覆盖物理 Fedora/Arch 桌面、systemd 开机、Wayland/GPU、所有 CPU 架构、签名发布或完整 update feed；不操作受拒的真实企微浏览器页面、外部 MCP 或网盘。当前不得据此关闭尚未实跑的安装/运行/卸载项目。


## 转交后的实际推进（backend_linkage）

macOS Server 已完成后承接此独立目录，Mac Desktop producer/GUI 仍由其他 owner 负责。本轮先执行原 `prepare-consumer.py fedora`；已认证 OCI layer 导入成功，首轮尚未进入包安装即被 BuildKit 拒绝 `--network=bridge`。失败日志与 controller JSON 以 `*-bridge-network-failed.*` 保留，这不是 UWork 产品或依赖失败。独立驱动仅改为 BuildKit 的正常 `--network=default`，仓库签名/TLS 校验和原 RPM 均未改；第二轮正进行真实 dnf 仓库依赖安装。尚不能据下载进度声称安装或 GUI 通过。

新增 `run-lifecycle.py` 顺序调度脚本；当前允许 GUI 整体失败后的独立卸载取证，明确留存 guiAcceptanceStatus，并硬要求原 container/network/tunnel 已闭且 clone imageId 与 GUI 完全相同，再调用原 lifecycle.py；使用具名、禁网、768MiB 的自有 clone，保留原 GUI 自有 profile 以观察 URI 注册，最后核容器不存在。不将包管理器 root 事务的权限合同混成普通 UID GUI sandbox 证据。


## Fedora 实际运行与边界

原 `dnf install` 完成，consumer `uwork-linux-desktop-fedora:20261020-clock-v1` 的真实 image ID 为 `sha256:9c4bd298cc9234b2a471972c513fb36b9875f366ae54b32c420626e588f720d9`。独立 [install proof](../evidence/client-linux-distro-fedora-install-proof-v1-20261020/lifecycle-result.json) 已过真实 RPM DB、launcher、desktop 和原五 core SHA/大小/公开权限，非手解包代替安装。签名仓库校验保持；只对命令行本地未签开发 RPM 采用发行版原允许行为。

v1 wrapper 在创建任何 container 前重复建 evidence 目录，已保留框架错误并修复。v2 原 GUI 10 项业务通过但 xdg 失败，wrapper 又错误按 `--type=renderer` 判断角色，忽略 Chromium 从 zygote 继承的 argv；该次整体 FAILED。v3 在 Page.reload 附近出现 BH IPC 超时，原 driver 容器内 `/json/list` 也超时、0模型/账本，原 stop acknowledged 后待 exit 超时，最终具名清理；不推断其根因，也不以另一轮 reload 成功声称该失败已修。

v4 复用既有已验证的原 BH browser-target `SystemInfo.getProcessInfo` 绑定 Browser53/Renderer213，并在初始 ready 和 Chat 前分别读取其真实 `/proc`：双读 start ticks 稳定、NSpid 对应、UID/GID1000、CapEff0、NoNewPrivs1，Main Seccomp0 / Renderer Seccomp2，user/PID namespaces 不同。只读原普通 UID，无加 caps、ptrace 或 VM root observer。证据 [initial-ready](../evidence/client-linux-desktop-fedora-clock-v4-20261020/kernel-initial-ready.json)、[before-chat](../evidence/client-linux-desktop-fedora-clock-v4-20261020/kernel-before-chat.json)。原 Page.reload 此次约94ms返回，十项业务检查通过，模型/账本两条、44 Credit、24输入/20输出 token，撤权拒绝零增量。

**v4 整体仍 FAILED。** [原结果](../evidence/client-linux-desktop-fedora-clock-v4-20261020/result.json) 的 xdg-mime 查询成功，但原 xdg-open exit3，未进入原 native 确认，因此取消/接受/25秒 pending 并发保持均未达到，不能按配置的 hold=25 秒写成已覆盖。Root 独立 [原解析器对照](../evidence/client-linux-fedora-xdg-readonly-v2-20261020/result.json) 证实有效带空格 Exec 被 Fedora xdg-utils1.2.1 generic `first_word` 错拆，gio/which/desktop-file-utils 等依赖已齐；不修改合法 Exec、不设伪 GNOME、不换 dispatcher 或加 no-sandbox 求绿。v2/v4 原 Desktop 均自然 exit0，全部 container/network/tunnel/专用 BH daemon 已清；v3 待 exit 超时的失败单列保留。

## RPM 最终卸载 RED 与修复准备

原同 image 的独立 writable clone 分别真实执行 dnf remove；和 GUI 的只读实例分开，不冒称同一可写 container 全事务。两轮 dnf exit0、包查询 exit1、清单全部非目录文件消失，但 `/usr/bin/zcode-preview`→`/etc/alternatives/zcode-preview`→已删除 `/opt/UWork Preview/zcode-preview` 的两级悬空链接及29个空目录残留。完整 lstat/target/tree 与用户 MIME 注册保留在 [uninstall v2](../evidence/client-linux-distro-fedora-uninstall-v2-20261020/lifecycle-result.json)，clone 均已删除。

原 rpm scriptlet 的 install alternatives target 为实际 `/opt/.../binary`，postun 却传 `/usr/bin/...`。项目新增 RPM-only `afterRemove` 原模板入口：统一实际 target，升级时保留新包资源，最终仅清本应用空目录，保留非空自定义内容及原 AppArmor 清理。见 [spec](../clients/uwork/specs/linux-rpm-uninstall.md)。原 FpmTarget 配置渲染的永久回归 [RED4/4](../evidence/client-linux-rpm-remove-unit-red-20261020.log) → [GREEN4/4](../evidence/client-linux-rpm-remove-unit-green-20261020.log)，相关正常配置/发布回归16/16，typecheck/lint/architecture exit0。此时只证明源/单位回归，不能代替新 RPM 的真实安装卸载。

独立 `prepare-fixed-rpm.py` 已准备 v10 原 producer base + 两个新 source COPY；原 desktop.tar.gz、expected.json、native-package.sh 三 SHA 与原 input 全等，不读取当前 Mac out，不改原归档/Agent/app.asar，不手压缩补钩子。资源窗口后沿原单 rpm builder 生成新包，再真实 dnf 复测。

## Arch Landlock 前置条件与当前进度

原认证 rootfs 导入和 pacman-key init/populate 成功，初轮 normal build 在下载前因 Landlock EPERM 失败，保留 `arch-*-original-landlock-failed.*`。四组网络none、具名短 container 对照 [完整收据](../evidence/client-linux-distro-native-clock-v1-20261020/arch-landlock-outer-comparison.json)：默认和仅放开 outer seccomp 都失败；仅加 NoNewPrivs 后 Landlock 成功进入数据库下载，之后只因明确禁网 DNS 失败。故未关闭 Landlock/DownloadSandbox、未放开 seccomp，而在原 Arch Dockerfile 给 pacman Syu/U 使用原系统 `setpriv --no-new-privs`，加强进程 NNP。

随后 normal docker build 已进入202个原仓库包、544.82MiB下载的真实完整升级/依赖流程。尚未以下载进度断言所有签名包校验、UWork安装、GUI或卸载成功。

经 Root 明确授权又仅清一次本 context unused builder cache，2.308GB cache 报告清理，43个原有镜像 tag/ID全部保持，见 `second-prune-preservation.json`；未 system/image/volume prune 或更改 VM 生命周期。实际磁盘余量持续观测，Arch依赖、RPM压缩和唯一LinuxGUI按顺序执行。


## 新原 RPM 事务收口

Root/peer复审后补了已缺alternatives注册的幂等和真实工具错误、两个symlink边界、fallback ownership，最终11/11 GREEN，并在RPM原额外fpm依赖加findutils。原normalproducer新包 `65844f4036b4fb44e01b6c5dd15f99ef6b81b56ec01b29074553fbdef88b3d47` / 109362213 bytes 自然exit0；原cdf/3658五Core不变。空间受限按Root接受方案独立clone真实DNF同NEVRA reinstall→installedDB POSTUN逐字等新file header/Requires findutils→原默认dnf remove，全部清单、两级链接、安装空树均消失，clone自然exit0/removed。不是freshinstall/新包GUI整组PASS；详[独立修复报告](client-linux-rpm-uninstall-fix-test-2026-10-20.md)。

Arch NNP解决Landlock后第一轮完整下载因两个firmware.sig的原低速超时自然失败、无包升级；原失败独立保留。下一轮只对同一RUN里的原Syu作至多两次有限重试以复用正常缓存，不关闭原下载timeout、Landlock、TLS或签名校验，不改原pacman包。尚未将其写为安装/运行通过。


RPM修复最终由Root统一typecheck/lint/architecture与独立11项再核通过，本地四文件原子提交 `220ba514`；原payload1db与packaging220分别记录。Arch在相同VM单次Mesa签名文件TLS获取200/566bytes/0.872秒后，仅自有consumer把已认证原conf的ParallelDownloads5改1，保所有原validation/timeout，当前新normalbuild执行中。此前python的extra路径诊断404不是已核pacman精确repo URL，不据此宣称上游缺签名。


## Arch 串行真实事务与导出空间失败

ParallelDownloads=1 的新normalbuild已完成约422.1秒的RUN：原Syu完成keyring/package integrity/conflict/space及包升级，原UWork pacman-U/Q实收`zcode-preview 3.16.0-1`，原cache清理完成。仍需准确分列：发行版sshd prehook因容器PID1非systemd报不能重启、后续bus hook明确Skipped current root not booted；initcpio成功但有module/vconsole默认警告。不称物理Arch启动或sshd生命周期通过。

随后正常image export又95秒后ENOSPC（dockerdata20G卷仅112MiB余），不是UWork、签名或包事务错误；没有Archconsumer tag、未启动GUI、五core消费验证尚未完成，因此整体仍FAILED。该成功RUN缓存必须保留，不用global builder prune抹掉重新下载；正常上下文/input已冻结，重导出需直接重跑同context build，不重import base改变cache identity。

已仅做只读、可恢复的Fedora9c4 image host备份，未据此自行删除任何image：`/Users/ljp/Library/Caches/uwork-backend/client-linux-distro-image-backups-20261020/fedora-9c4bd298cc9234b2.tar`，727346688 bytes，SHA256 `d2b9ae44dce9d030969f7df37c54ec4e7f928a09bc2165bbfaabfa8fc4fa7775`。原OCI index精确引用9c4、digest blob存在，mode0600；见`fedora-image-host-backup.json`。精确消费image的迁出须经Root资源调度，其他image/VM/主服务保留，不做system/image/volume prune。


## Arch 扩盘后原缓存消费

Root 独占将专用 `uwork-backend` 盘20→40GiB，CPU2/内存4GiB、其他 profiles/context/主backend不变，见 [扩盘收据](../evidence/client-colima-disk-extension-20261020.json)。没有继续prune。此前经Root明确授权，只将已完整保存/逐blob验证的Fedora9c4从VM迁出，原727346688字节OCI保留host；第二次Arch导出曾完成OCI但unpack ENOSPC，其原27ad index的完整OCI也已保留host，两个历史失败未覆盖。

冻结 Dockerfile `edf4e8289bdc15a2c09cfc3904024703fec854b490454eb95765ae556298d379` 与原pacman归档30d8逐SHA确认后，直接对原context正常build，不重import、不重新依赖下载；原安装RUN明确CACHED，export/unpack约12秒 exit0。新OCI index为c42e5019，但不是换payload：旧host OCI与新正常export日志精确同runtime manifest `b38f1363b9a5c92d98245cfd9f650f69601f3de4e5de752ca873296be7fd63ee` / config `7f008d821120ced9d6304f2f9570d7a6205340da758732c9ec1eeb6807d57efa`，仅BuildKit attestation/index重生；见 [identity](../evidence/client-linux-distro-native-clock-v1-20261020/arch-cached-runtime-identity.json)。

[原安装消费proof](../evidence/client-linux-distro-arch-install-proof-v1-20261020/lifecycle-result.json) 已实际pacman-Q/原manifest，5个core大小/SHA/公共权限、launcher/desktop通过，独立clone清理。GUI尚须以自己的原结果为准。

Arch v1 GUI在初始sandbox gate实际拒绝：新增stdin fixture扩展使原后置`entryPoints`检测失配，未移除夹具原有no-sandbox；原argv与kernel证据均保留，1项renderer检查、0供应商/账本、自然exit0且资源全闭，整体FAILED。驱动将同一构建标记贯穿pre/post，保留恰好一次flag移除与原sandbox严格断言；新v2使用全新profile，未把v1改名为通过。


Arch v2 [原GUI结果](../evidence/client-linux-desktop-arch-clock-v2-20261020/result.json) 真实完成3项：renderer、onboarding恢复身份工作区、Host文件预览；[初始sandbox](../evidence/client-linux-desktop-arch-clock-v2-20261020/kernel-initial-ready.json) 精确角色/UID1000/cap0/NNP/Seccomp2/nested namespace成立。原reload约94ms返回，之后BH35秒超时，容器内原9222 `/json/list` 也curl28，模型/账本0；stop ack后wait-exit超时，精确container/network/volume/tunnel/BH均清理。与Fedora v3症状相似，未把两者合并根因或以另轮成功宣修复。

不受此GUI失败阻断的 [Arch原卸载](../evidence/client-linux-distro-arch-uninstall-v1-20261020/lifecycle-result.json) 已执行：与v2同c42 installed image的独立writable clone，先原pacman数据库/5SHA守卫，再原`pacman -R --noconfirm zcode-preview` exit0、`pacman -Q` exit1，原manifest全部非目录及四系统路径均无，afterDetails={}，clone闭。原GUI自有用户zcode.desktop/MIME default仍保留，如实单列，不冒称其已清除，也不将clone写作同一个可写container内安装运行卸载。

为覆盖被失败reload阻断的其他现有业务，`run.py --business-without-reload --usage-isolation` 新开独立profile，原facts/controller明确记scopeOmissions、不记录reloadPASS；保留原File/PTY/Chat/revoke/系统URI严格断言，预算、sandbox及原载荷不变。原公开HTTP创建/login第二普通成员后，观测本人两条settled与另一成员隔离，并核真实撤席位NO_SEAT；不会以该独立业务slice关闭上面的reload失败。


## Arch 独立后续业务结果

[business-v1原结果](../evidence/client-linux-desktop-arch-business-v1-20261020/result.json) 有11项实际checks通过，整体仍FAILED、scopeOmissions明确保留reload：原File；真实PTY写文件及同PTY隐藏/恢复；原模型2次调用/2条settled，44Credit、24输入/20输出token；原生产spawn绑定活Agent、backend/Desktop/Host/Agent/PTY UID1000；原撤席位后再次send拒绝且供应商/账本零增量。两次真实sandbox gate均Seccomp2/nested user/PID namespace、cap0/NNP。

新增公开HTTP观测不是私有ledger归属替身：原owner API创建同企业第二普通成员并密码login；原`/api/client/usage`本人2请求/44Credit/44tokens，另一成员200但0请求/0cost/0tokens/空trend/models；另一成员传foreign userId仍200且全0，符合self API不支持跨人selector的合同；两普通成员直接管理usage均403 FORBIDDEN。原撤席位后本人原self API403 NO_SEAT，另一成员200且仍空；[完整原响应](../evidence/client-linux-desktop-arch-business-v1-20261020/result.json) 不含token/password。fixture仅一处源码锚点注入HTTP setup/observer，原shared backend/probe及产品handlers不改。

最后原xdg-open exit3，未进入native确认，URI取消/接受/25秒pending都没达成；不得将11checks说成整组PASS或补计未执行的reload。原Desktop自然exit0，容器/network/volume/tunnel/专用BH已闭。唯一后续fresh reload诊断沿同immutable image、原File/reload/原预算加入只读proc/cgroup与本地CDP HTTP观测，未改资源/sandbox/Main，不再盲开多轮。


## 唯一 Arch reload 诊断与最终边界

经Root允许的唯一fresh诊断沿原c42 image、File/reload动作与原预算，未改Main、资源限制或sandbox。原Main52/Renderer172/GPU126由原browser-target SystemInfo绑定，再以PID birth和逐样本稳定stat确认；只读observer每秒保存proc状态/wchan/线程与cgroup。38条实际样本 peak `1358729216` bytes（约1.27GiB），memory.max为max，memory.events的oom/oom_kill/oom_group_kill全0；原container Memory/MemorySwap/NanoCpus均0，VM4GiB不变。完整原始[采样](../evidence/client-linux-desktop-arch-reload-diagnostic-v1-20261020/reload-passive.jsonl)、[摘要](../evidence/client-linux-desktop-arch-reload-diagnostic-v1-20261020/reload-observation-summary.json)。

本次reload92ms返回，before/returned/最后URI失败时的原9222 version/list均0，原恢复文件/PTY/模型/revoke十项checks实过；[原result](../evidence/client-linux-desktop-arch-reload-diagnostic-v1-20261020/result.json) 最终仍因xdg无native确认FAILED。**此轮没有复现CDP冻结，不证明历史Arch v2/Fedora v3已修或不存在OOM**。历史v2没有live cgroup样本；事后VM全boot ring无OOM记录及事后MemAvailable约3.4GiB只作补充，不能替代当时peak。只读观测改变时序，也不能据此声称消除了race。已保留原stderr、Main/Host尾行、同期VM完整kernel日志和全部测量限制，不盲开更多case。

[Arch原xdg只读](../evidence/client-linux-desktop-arch-reload-diagnostic-v1-20261020/xdg-readonly.json) 证实xdg-open1.2.1的原`first_word()`用`read first rest`，合法`Exec="/opt/UWork Preview/zcode-preview" %U`被拆成字面`"/opt/UWork`，command-v exit1；实际`/usr/bin/zcode-preview`精确realpath仍正确。仅执行原纯parser/alias查询，不发URI；业务case中原真实xdg-open exit3独立证明失败。和Fedora为各自原脚本/原installed桌面文件的实证，未修改合法Exec、换dispatcher/伪GNOME或关闭sandbox求绿。

最后本轮4个GUI case全部按原结果保留FAILED：v1夹具参数遗漏1check；v2 reload/CDP超时3checks；明确不含reload的business11checks；本次原reload诊断10checks但URI失败。不能相加当作单轮全通过。原pacman安装消费、原卸载事务分别PASS。四轮自身container/network/volume/tunnel/专用BH均已逐结果核不存在；business和诊断原Desktop自然exit0，v2原待exit超时单列。所有句柄已退出，不再操作VM，唯一VM窗口已交还Root/coverage；VM最终恢复初始Stopped由Root负责。明确标记为自身重算的[证据核对](../evidence/client-linux-distro-arch-self-verdict-20261020.json)不冒称独立peer。

新工具静态`python3 -m py_compile scripts/tests/linux-distro/*.py`、Node24 check两个新增mjs/cjs通过；生产RPM11项及统一typecheck/lint/architecture此前由Root和peer已核，不因纯报告/只读诊断重跑旧广测试。原Linux载荷仍1db/cdf/3658，不外推到Mac后续1bd wire或新Linux发行包。

专用入口（使用新case名称，GUI需资源owner窗口）：

```sh
python3 scripts/tests/linux-distro/run.py arch --name client-linux-desktop-arch-next-20261020 --image uwork-linux-desktop-arch:20261020-clock-v1 --usage-isolation
python3 scripts/tests/linux-distro/run.py arch --name client-linux-desktop-arch-business-next-20261020 --image uwork-linux-desktop-arch:20261020-clock-v1 --usage-isolation --business-without-reload
python3 scripts/tests/linux-distro/run-lifecycle.py arch --name client-linux-distro-arch-remove-next-20261020 --gui-case client-linux-desktop-arch-next-20261020 --image uwork-linux-desktop-arch:20261020-clock-v1
```

第一条为完整原reload路径，第二条仅独立业务子范围，两者不能互代关闭reload失败。卸载发生于same-image独立clone、原用户profile另挂载，资源闭合和实际imageId为硬守卫。


卸载示例明确读取所指future case的真实结果与work目录，GUI状态不作为PASS推定。当前实际Arch卸载入口为 `run-lifecycle.py arch --name client-linux-distro-arch-uninstall-v1-20261020 --gui-case client-linux-desktop-arch-clock-v2-20261020 --image uwork-linux-desktop-arch:20261020-clock-v1`，原controller留存 `guiAcceptanceStatus="failed"`，原资源闭合与same-image守卫全满足；因此仅证明独立包事务，不关闭GUI失败。
