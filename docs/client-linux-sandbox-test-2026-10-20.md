# Linux 普通用户 Chromium sandbox 实测

2026-10-20，在专用 `colima-uwork-backend` Linux ARM64 VM 内，原 AppImage 以 UID/GID 1000 启动，无 `--no-sandbox` 或 `--disable-setuid-sandbox`。Chromium renderer 的真实内核状态证明其内部 sandbox 已生效。该结论限定本次容器与首实例，不替代物理 Linux、GPU、FUSE、完整企业登录或新版第二实例协议验收。

## 原产物与隔离条件

- 镜像 `uwork-linux-desktop-appimage:20261020-v6-capture`，ID `sha256:52db36de9a5d638a63594ff192674b24d104f074258e303d21f2fc7fa7e6a372`。
- 包 `/opt/artifacts/uwork-preview.AppImage`，SHA256 `bb3f58534cd936cb6b2e501e76708425563b272f8dd87cb7572117db02338322`，通过 `APPIMAGE_EXTRACT_AND_RUN=1` 解包执行原代码，未重写 Main、renderer 或 CLI。
- Linux kernel `6.8.0-100-generic`。新建测试 HOME、配置、工作区、数据目录与 Docker internal 网络；无真实用户身份、无外部模型请求，不连接用户 Chrome。
- 外层容器：`--user 1000:1000 --read-only --cap-drop ALL --security-opt no-new-privileges`。未使用 privileged、host PID、额外 capabilities。仅正例增加 `--security-opt seccomp=unconfined`，允许 Chromium 创建其自己的 user/PID namespace。该参数仅作用于临时测试外层容器，不是产品配置建议。
- 通过自有 SSH tunnel 将该容器 CDP 转至本机随机 loopback 端口，再由独立 browser-harness daemon 附加原 Electron 页面。无点击、授权、消息发送或外部页面操作。

## 内核正例

权威记录：`evidence/client-linux-sandbox-v6-20261021/result.json`。

Chromium fork 后 `/proc/<pid>/cmdline` 仍可显示 `--type=zygote`，因此不能据此误判“没有 renderer”。本次使用 browser-harness 的 `Target.attachToBrowserTarget` 与 `SystemInfo.getProcessInfo` 得到 renderer PID，再与 `/proc` 对齐。

| 观测                            | 结果                              |
| ------------------------------- | --------------------------------- |
| Chromium browser PID            | 22；外层 `Seccomp=0`              |
| 实际 renderer PID               | 99（由 SystemInfo 标为 renderer） |
| renderer UID/GID                | real/effective/saved/fs 均 1000   |
| renderer NoNewPrivs             | 1                                 |
| renderer Seccomp / filters      | 2 / 1                             |
| renderer CapEff                 | 全零                              |
| renderer NSpid                  | `99 4 1`，存在嵌套 PID namespace  |
| renderer user 映射              | `1000 1000 1`                     |
| renderer pid/user/net namespace | 均与 browser 不同                 |

由于外层 browser 未被 seccomp 过滤，而 renderer 为 `Seccomp=2`，这不是把 Docker 自带的过滤误当 Chromium sandbox。部分 Chromium utility/Node 主进程仍是 `Seccomp=0`；本次不声称全部应用进程都进入 renderer sandbox。

同一轮原页面 CDP 返回 `readyState=complete`、`file:`、React root 已挂载。该取样早于 onboarding/login 节点出现，所以不能把本轮投影写成完整登录验收。较早 v3 同包已观测 onboarding/login 节点，但该轮因初版采样器仅按 argv 分类 renderer 而标为失败；保留原记录，没有将失败覆盖为通过。

## 默认外层 seccomp 拒绝例

权威记录：`evidence/client-linux-sandbox-default-rejection-v2-20261021/result.json` 与同目录 `desktop.log`。

同一原包、同一 UID1000、同一隔离设置，仅移除外层 `seccomp=unconfined`：

1. `unshare -Ur /bin/true` 的最小同条件预检被 `EPERM` 拒绝；放开临时外层 seccomp 后预检成功。
2. 原 AppImage 启动尝试失败，退出码 127。日志明确表示 SUID sandbox helper 配置不满足并主动中止：`Rather than run without sandboxing ... aborting now`。没有追加 `--no-sandbox` 掩盖拒绝。
3. 本例是可复现的环境限制：Docker 默认过滤阻断 user namespace，解包运行的 helper 又不提供可用的 SUID 退路。未给产物改 owner/mode，没有削弱系统/AppArmor/主机配置。

## 测试修正与清理

- v1/v2 驱动把脚本目录直接 bind，专用 VM 只映射数据区，故启动失败；后续改为复制测试输入至已有映射数据区，产品未改动。
- v3 采样器按 argv 误分类；v5 将 `SystemInfo` 发往 renderer target 被 CDP 拒绝。修正为显式 browser target 后 v6 得到精确 PID 与内核正例。
- v4 的只读 SHA256 容器发生 30 秒观察超时；其后仍运行的同一容器 `nice_cori` 被核对镜像、命令后清理，最终 `inspect` 确认不存在。未因此重启 VM。
- 两个最终 GUI/拒绝例的容器、Docker 网络已删除，自有 tunnel 与 browser-harness daemon 已关闭。未开关 VM，也未删除镜像或用户真实安装。
- 证据目录尾缀 `20261021` 是命名错误；实际执行时间为 **2026-10-20 17:49–17:52 +0800（Asia/Shanghai）**，旧目录保留便于追溯。

独立核对见 `evidence/client-linux-sandbox-independent-verdict-20261020.json`，核对 11 项内核、身份、产物一致性、拒绝与清理条件全部通过。脚本位于 `scripts/tests/linux-sandbox/`；Python 编译、Shell 语法与 Node 语法检查通过。最新驱动额外加入 onboarding/login 等待与 namespace 显式断言，该加强版本尚未再执行 GUI；上述结论引用已执行的 v6 原始内核记录与独立核对。
