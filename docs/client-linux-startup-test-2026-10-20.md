# Linux 首启超时调查（2026-10-20）

针对 PTY v2 在首启、尚未点击 UI 时发生的 CDP/关闭超时，完成八个全新 DB/HOME/userdata/profile 的重复取证：unpacked 与真实 deb 安装镜像各四次，均 exit 0。每次原角色页就绪后连续五次 DOM/CDP 采样全部正常，模型和账本始终为零，关闭前后快照一致。

- [八轮汇总](../evidence/client-linux-startup-stress-20261020/result.json)
- [独立核验](../evidence/client-linux-startup-stress-20261020/independent-verdict.json)：40 次采样、八组自有容器/卷/网络、SSH/BH 宿主 PID 和回环端口均逐项核验关闭。
- 角色页就绪耗时：unpacked 6.215–6.420 秒、installed 3.695–3.905 秒，均从夹具开始计时，包含复制/解压/后台准备，不能据此比较纯应用启动性能。VM 与工具镜像复用，仅应用/数据 profile 为全新。
- 当前宿主 urllib/环境代理元数据没有配置的代理项，没有改系统代理、证书策略或产品源码。

原失败仍保留于 `evidence/client-linux-desktop-pty-v2-20261020/result.json`：当时原 app.asar target 已出现，第一次严格 FirstRun 观察失败，后续 CDP 探测也超时，容器关闭等待超时后由控制器收口。该轮未取得直接 CDP HTTP/进程状态，无法从历史日志确定是应用、转发还是自动化守护进程的问题。

现已在严格 FirstRun 观察前等待原 onboarding/加载终态，并在后续异常路径采集容器内直接 CDP HTTP 与进程状态。后续同包的多轮完整九项联动及本次八轮均未复现。**没有已证实的根因或产品修复，不把重复通过写成历史问题已根治。** 当前完成的是该阶段的有界重复验证与取证改进，实际协议/其他格式/Windows 等验收仍继续。
