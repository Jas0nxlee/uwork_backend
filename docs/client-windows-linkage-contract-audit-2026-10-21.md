# Windows 前后端联动合同审计（2026-10-21）

结论：源码声明发布 **Windows x64**，当前没有可连接的真实 Windows Host。以下只完成静态审计和 **macOS ARM64 / Node 24** 纯测试，不代表 Windows 安装、启动或 Native 联动通过。未启动 App、VM、Wine、远程会话或 CI；旧 37/44 项冻结输入 SHA 均未变。

证据：[审计结果](../evidence/client-windows-linkage-contract-audit-20261021/result.json)、[实际命令](../evidence/client-windows-linkage-contract-audit-20261021/targeted-tests.json)、[路径字符串观察](../evidence/client-windows-linkage-contract-audit-20261021/path-string-observations.json)。

| 范围 | 当前可确认 | 必须留给真实 Windows 的边界 |
| --- | --- | --- |
| 发布与资源 | `scripts/desktop-release.mjs` 的 releaseTargets 含 win-x64；release workflow 明列 windows-2022 / win / x64。Builder 使用 NSIS、目录选择、安装 manifest 与 zcode scheme。通用 arm64 helper 存在不等于已承诺发布 win-arm64。 | 同来源正常 x64 EXE 的 PE/ASAR/CLI/ConPTY/search 资源与实际加载；安装/更新/卸载、用户目录与 Program Files ACL、旧进程占用、系统协议和默认应用恢复。源码 workflow 不是已执行 CI。 |
| 二实例与协议 | 当前共享 factory/extractor 能逐字往返 `C:\\owned\\项目 中文 %25`；合法 URI 中编码后的路径和原始中文 label 可解回原值。ASCII 兼容、版本 wire、decode-once、未知版本 argv fallback、NUL/UNC 分层拒绝有纯合同。 | Windows 命令行引号/尾反斜杠、Shell URL 分派、原 requestSingleInstanceLock/additionalData 的真实 Windows IPC、确认期间第三入口 ACK、原系统确认框的取消/确认与原窗口生命周期。现 V8 framing replay 明确建模 POSIX，不是 Windows C++ 传输。 |
| 路径、工作区、cwd、IPC | Main 外部路径先拒 NUL/UNC，再用当前宿主 `node:path.isAbsolute` 和真实 stat；Host 的原 argv 数组、cwd 选择/备用目录、Main→preload→renderer ready 链可在 Mac 运行。`paths.ts` 的安装目录保护使用显式 win32.normalize/resolve/casefold。 | `C:` 绝对/盘符相对、Unicode/空格/百分号本地目录的真实 stat/ACL、Windows 大小写与路径身份、Host/CLI 的实际 cwd/文件读写、冷恢复与 IPC 只投递一次。未把 POSIX 临时目录或注入 win32 字段视为 Windows 文件系统测试。UNC/网盘仍明确排除。 |
| 身份、租户、配置与模型 | 最近 Mac ARM64 v10 已真实完成同任务登录态冷恢复、同 ID tools 能力往返、Gateway 401 后晚 200、自然 TTL 墓碑/abort-drop、原 UI 插件安装到 Skill 正文后继请求。它们覆盖共享后端/Host 逻辑；原 A/logout/B、配置发布和权限测试按各自历史来源保留。 | Windows 原窗口/profile 的加密会话恢复、退出/到期/原 UI 重认证、tenant/模型目录清理、配置发布到菜单/实际 CLI 使用必须在 Windows 重演。成员 disabled→active 原重认证仍独立未闭；真实企微浏览器拒绝不重试。 |
| 请求与账本 | 共享真实后端的 actor/model/application、ledger/gateway request_key 关联、Trace 集合及 tokens/Credit 汇总已有原生 Mac 证据；Trace 没有 request_key FK，不能伪造逐笔对应。 | Windows 原 Composer→实际 Windows CLI→受控供应商→当前成员与另一成员账本/Trace 的同轮闭环；进程保活、撤权零增量、真实 PTY/ConPTY resize 与收尾。普通 Node API 或 cross-build 不能替代。 |

本次针对性纯测试共 **59/59**，所有进程实际都在 Mac 上运行：

| 日志组 | 数量 | 有效证明范围 |
| --- | ---: | --- |
| serialization-dispatch | 20 | 原 shared wire/argv 提取、V8 字节往返、异步二实例分派/退出门禁；无 Windows Shell/内核。 |
| confirmation-ready-ipc-vm | 29 | 实际源码的异步确认/窗口销毁/ready IPC 合同。Electron/IPC/平台字段由 VM 夹具提供，含 win32 分支名，仍非 Windows Native。 |
| release-manifest-fixtures | 10 | 发布目标/同版本同提交/命名/校验和拒绝。测试 EXE 等文件是临时文本假产物；没有 Windows 包运行。 |

另记录一个精确 parser 边界：`--open-workspace` 的完整 Windows 路径字符串与 `%20` 等合法 URI 编码可往返；URI 查询中**直接放字面空格**会被当前 deep-link 正则截断。未把不符合 URI 编码约定的此输入直接定性为 Windows 产品缺陷，也未修改实现；真实系统入口测试应分别使用原 argv 路径和规范编码 URI，不混淆两种合同。

现有五项 Mac 驱动还包含固定 `/Users/...` Node 路径、`ps/lsof` 进程归属检查和 Swift 协议恢复器，不能直接当作 Windows 驱动运行。真实 Host 可连接后，需要自动准备独立 Windows 所有权/端口与协议恢复前置；业务断言和受控后台可复用。没有把这些尚待接线的步骤交给用户手动完成。

真实 Host 可连接后，最短三块为：①同来源正常包、资源/进程归属、原单实例 Unicode/空格路径与确认生命周期；②原身份/同任务冷恢复加一次真实请求和两成员账本；③原用户目录文件与 ConPTY 输入/resize/保留、撤权及进程/端口/协议收尾。需要的是可自动连接的环境入口，不要求用户手动测试。当前未尝试任何 Windows 入口，未把环境缺失写成通过。
