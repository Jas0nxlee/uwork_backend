# Linux Desktop 真实终端尺寸修复

状态：源码与真实模块/PTY验证通过，正常新原包正在补原UI尺寸复测；尚不称最终GUI通过。修复提交 `1a8f24cb`，只含Desktop依赖、原native恢复脚本、锁文件、永久测试和spec五文件。

## 真实问题与定位

此前终端输入、cwd与隐藏恢复证明了PTY存在，却没有证明resize成功。新原包interrupted v1原日志保留两次 `Usage: pty.resize(fd, cols, rows, xPixel, yPixel)`。原实际app.asar内node-pty1.1.0公开resize传三个native参数，而beforePack无版本校验地复制@lydell平台1.2.0-beta.10 native；不能把输入成功解释成终端尺寸正常。

Root从真实原包提取JS（SHA9194fd3f...d615）及原Linux native（SHAd8314caa...3ad8），在匹配Linux ARM64 Node24.14/UID1000/只读、禁网、cap-drop-all/NNP/128MiB自有容器实测：公开JS调用三参数报Usage5，直接五参数才进入ioctl/EBADF。只使用无效fd的探针没有创建PTY、子进程或模型调用。第一次准备的完整JS文本SHA差异仅是正常packaging去掉sourceMappingURL注释，已保留前置失败并核实其余内容一致；执行时始终使用实际提取字节。

官方registry的两个平台1.1.0原tarball经过SHA512 SRI、SHA1与native SHA核验：arm64为c192e560...b75b，x64为ff8c140f...1cb0。两个包采用平铺package.json/pty.node，无JS入口，不能沿beta的prebuilds路径猜测。原包、metadata与独立peer见 `evidence/client-linux-pty-matching-native-peer-20261020.json`。

## 修复与门禁

Desktop JS及两个Linux平台包精确pin1.1.0。原beforePack保持唯一写者，从显式Desktop项目根解析JS/native，兼容官方flat布局与带exports的prebuilds布局；写目标前核包名、非空一致版本、os/cpu、ELF64 little-endian与目标machine，双布局同时存在也拒绝。错误不得覆盖已有target；不修改第三方JS或native、不改TerminalService API、不补像素参数或吞错误。非Linux原路径跳过，不覆盖Darwin资源。

永久真实filesystem测试旧22项中21RED/1GREEN，后续完善为24项；Root与独立peer最终24/24、0skip。源码类型/Lint/架构均exit0，Lint114warnings/0errors；源hash检查期稳定。正常锁更新只改变Desktop三声明及两项1.1完整SRI/snapshot；真实frozen安装exit0（明确关闭lifecycle scripts），Desktop实际JS/两native为1.1，Server当时实际JS1.1/平台Beta保持，cdf Agent未重建。证据：`evidence/client-linux-pty-resize-fix-20261020/quality-result.json`、`effective-dependency-isolation.json`，独立锁审 `client-linux-pty-lock-isolation-peer-20261020.json`。

## 实际ABI与系统尺寸

同一份public contract和实际原包JS不变，仅换官方匹配native：旧Beta exit1→1.1 exit0，公开resize已到预期ioctl/EBADF；旧native的五参数路径仅是诊断对照，不是新调用规则。另用匹配组合真正spawn PTY，在同一shell中两次公开resize后执行系统stty，实收rows/cols `[37,91]`、`[44,113]`，cwd `/tmp`，自有shell退出、三个独立容器都关闭。

完整收据 `evidence/client-linux-pty-resize-abi-pair-20261020/result.json`。这是Linux ARM64实际模块/PTY验证，不替代原UI fit，也不代表Linux x64已执行。

## 原包复测边界

正常1a8 host build与builder目录已各自然exit0：asar eced6754...b2d6，实际包内JS1.1/resize3、nativeC192/69064B、Agentcdf、原9项Linuxfuse不变。输入11来源已保存byte-exact snapshot。后续AppImage packager的413项tracked配置从git1a8取原blob，build-meta另单列；不从并行Server工作树猜产物来源。新AppImage与原UI两次stty-fit、文件/reload、两调用账本/撤席位及25秒协议并发仍须以新fresh结果闭环。

旧wire AppImage338a/asar b253含错配native；其controller误TERM143与部分被动输入/计量证据按interrupted保留，没有driver最终result，不计整轮PASS。完整已知容器/网络/BH/tunnel关闭，遗失的动态host controlport未补造四端口证明。新phase拆开prepare/preflight/run，不自动跨越清理阶段。

同类原Server Linux3b50也已实际复现ABI错配，Darwin旧/新原包的同一无效fd合同则通过；Server不是本提交的已修范围，正在单独修其三个发行资产路径，见[独立Server审计](client-server-node-pty-abi-audit-2026-10-20.md)。不得以Desktop GREEN关闭Server或受拒远程Provider边界。
