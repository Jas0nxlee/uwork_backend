# 异步确认修复后 Linux 四格式补产与消费验证

最新正常Main产物的AppImage、deb、rpm、pacman四包已全部取得，并通过原格式消费、20项核心文件SHA比较及20项权限检查。AppImage/deb来自原all-target执行已完成的部分；RPM/pacman分别由两个原单target命令补产。**不是原all-target命令一次全绿**，先前禁网下载失败和RPM OOM保持原记录。

这里的载荷是异步Main修复后的package-v5，Agent仍为6cd2e95。后续另发现并修复了[SQLite启动计时](client-sqlite-startup-clock-test-2026-10-20.md)，新Agent为cdf781ec；本报告四格式结果没有被替换成新Agent全格式已验，新的Native/发行切片须分别引用实际产物。

## 生产与原始失败

正常Desktop预打包为`client-linux-desktop-package-v5-20261020.tar.gz`，同源`expected.json`固定在`data/sandbox-verification/linux-native-packaging-v9-20261020/input`，其中新app.asar SHA256为`4f716c13f57315ab5992a6ba1b831ee2665dc6ab2db8e0eda0d3e65ddbac5034`。输入包含正常构建的异步确认修复，与已实测AppImage v16和普通UID deb协议切片同源。

1. 第一轮原all-target命令人为禁网且没有公共builder工具缓存，下载EAI_AGAIN失败，无发行包；不是产品业务失败。
2. 第二轮允许原工具正常下载，AppImage/deb完整形成；其后RPM压缩被VM OOM killer终止，原日志和内核证据保留。不能凭前两包完成写成all-target成功。
3. 本轮先把完整AppImage/deb复制到新`output-v3`，源与复制分别重算SHA一致；然后等待所有GUI退出，顺序执行原helper `native-package.sh rpm`、`native-package.sh pacman`，两次均自然exit0。

使用原`uwork-linux-native-packager:20261020-v9`镜像、electron-builder26.8.1与原完整配置，普通bridge网络仅供公共GitHub工具下载。没有改变配置、压缩参数、发行包内容或vendor；没有手动重压缩包。`/app`暂存使用一次性容器overlay，避免GUI与大tmpfs同时占满4GiB VM。RPM实际压缩记录最高一次观察约2.345GiB，两个target不并发执行。

原失败日志是`evidence/client-async-confirmation-native-formats-build-20261020.log`、`...-build-v2-20261020.log`、`...-oom-20261020.log`；本轮保留独立`rpm-production.log`和`pacman-production.log`。VM没有重启，未触碰Main、用户安装或主库。

## 最终包与独立摘要

四包均位于`data/sandbox-verification/linux-native-packaging-v9-20261020/output-v3`。

| 格式     |  实际字节数 | SHA256                                                             |
| -------- | ----------: | ------------------------------------------------------------------ |
| AppImage | 187,524,478 | `4bcbeefa49c232f7c3bb3bbfa145b0a8db79c5798c5c648e5cb99f8abf0c8f47` |
| deb      | 131,741,824 | `f7f25e0279d045b069fa879ec224aacdce630a30edaed57b0c655b7e00dce68a` |
| rpm      | 109,327,237 | `8d55f8a80192a9d0c7702c3f06f18c07a10f9da78dc2fbaff1fbb97d2ed899ff` |
| pacman   | 168,186,242 | `4516c4ce05d5976f382540c9feda8a360222b5c880ca3995364148ebac896ff3` |

AppImage/deb的SHA与原已完整产物不变；RPM为aarch64、deb为arm64、pacman元数据aarch64。版本均3.16.0、Preview身份，未签名或发布。

## 原消费验证与独核

新验证根`data/sandbox-verification/linux-native-validation-async-v1-20261020`复制原`validate-formats.mjs`，运行时网络none、只读镜像/输入/包、cap-drop ALL、no-new-privileges，仅自有work和可执行tmpfs可写。验证命令自然exit0，四包逐项passed：

- AppImage真实ARM64 ELF/AI type2、原runtime offset/extract成功；不是仅查看文件名。
- deb读取真实dpkg元数据并解包；rpm读取Name/Version/Arch与mesa-libgbm/alsa-lib依赖后解包；pacman为真实zstd魔数`28b52ffd`，`.PKGINFO`名称/版本/架构符合。
- 四包中的原程序、app.asar、Agent CLI、公共provider配置、pty.node共20个文件，逐字节数/SHA与同源expected完全一致；未混用旧Main或手工改Agent。
- 20个核心路径权限条目全部通过：应用根与所有父目录对普通用户可读/遍历，文件可读，实际程序可执行。该权限断言不等于四种包都实际安装。
- 宿主另行重算四文件大小、SHA256/SHA512，全部与消费者记录一致；AppImage/deb同时对照最初复制清单。

最后一次pacman单target生成了`latest-linux-arm64.yml`，其中**只有pacman一条**。该条版本、大小、base64 SHA512与实际pacman逐字匹配；另外三个包未列入这个文件。本次没有补造或手工合并元数据，不能称完整四格式更新feed、自动更新验收或签名发布。

## 资源与数据留存

三次具名容器均不存在：`uwork-native-rpm-async-v3-20261020`、`uwork-native-pacman-async-v3-20261020`、`uwork-native-validation-async-v1-20261020`。没有GUI、外部MCP、网盘或企微浏览器操作。本轮普通Docker网络随容器退出，没有创建自定义network/volume。

输入、旧`output-v2`、新`output-v3`、验证input和已提取work五个目录明确保留作证据；不是声称数据根已删除。原容器overlay与tmpfs随对应容器移除，验证work曾临时开放写入权限，完成后根目录收回0755。所有重压缩和消费者进程已结束，GUI资源窗口已释放。

权威证据统一位于`evidence/client-linux-native-formats-async-v1-20261020/`：

- `preparation.json`、`production-invocations.json`：输入固定、两保留包摘要、两次单target调用及历史失败来源。
- 两份production日志与`*-production-result.json`：两个target实际退出0。
- `validation.log`、`validation-result.json`、`result.json`：原四格式消费者与20/20检查。
- `independent-verdict.json`：四包独立SHA256/SHA512、20core/20权限计数、三容器不存在、五个保留数据根、pacman单条YML核对。
- `latest-linux-arm64.yml`：原生成文件的证据副本，非新编辑的发布feed。

本切片只关闭最新载荷的包生成/格式消费/核心一致性。AppImage与deb的实际运行和R02系统URI见[Main报告](client-second-instance-confirmation-test-2026-10-20.md)、[deb环境对照](client-linux-deb-protocol-test-2026-10-20.md)；rpm/Arch实际安装、物理Linux、GPU/FUSE、默认外层/SUID fallback、完整更新feed、Windows、生产部署与远端CI均不由本次关闭。整体测试目标仍未完成。
