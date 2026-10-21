# 原生打包态 Host/CLI/后台与分享复制联测

最终包：`/Users/ljp/Library/Caches/uwork-backend/client-macos-package-20261020-v3/mac-arm64/UWork Preview.app`。运行前重新校验签名与四项运行时 SHA；从原 app.asar 正常启动，未修改包，未使用复制的测试 Main，也未覆盖用户安装。

## v3 实收结果

证据：`evidence/client-native-packaged-runtime-v3-20261020/probe-result.json` 与 `independent-verification.json`。

- **6 项业务检查、7 个原 UI 动作通过**：原 FirstRun、身份恢复/模型、原 Composer 发送、包内 CLI、原分享发布及复制链接。
- 当前成员新增主回答/标题各一次：2 条 settled、24 input/20 output Token、44 Credit。另一个成员的初始化基线 2 条/44 Credit 保持；全夹具供应商总调用 4 次，不能全算成当前成员新增。
- 分享原 prepare/confirm 成功，后台 confirmed 一条、当前成员创建、零附件；发布与复制后模型调用和账本均不增加。
- 中文界面原复制按钮将 `/cn/share/<owned-code>` 写入真正的 macOS 剪贴板，与后台同一 share_code 严格对应。守卫只输出布尔值及该测试 URL 的 SHA，不输出用户剪贴板内容。
- 实际包内 CLI 证明由生产 spawn 参数、已启动 PID、当前进程树、包内可执行映射和隔离 cwd 联合给出；不是仅凭启动日志或文件存在。该 PID 为 18078。ps 在该运行时只显示短进程标题，最初依赖完整 argv 字符串的断言不适用。
- 夹具 exit 0；8 个已知进程及 BH daemon 已消失，四端口拒连，BH socket 关闭；四项包内字节 SHA 未变。OS 协议 handler 与**本轮**剪贴板恢复通过。
- scoped FD 扫描完整但仍有 4 个 FD 持有测试根；未查询这些持有者身份、未终止它们，根按 0700 保留。不能声称目录已删除或系统中零 FD。

## 失败记录与剪贴板事故

v1 实际发送已成功，但测试假设 ps 完整命令行中会出现 CLI 路径，导致取证失败。改为生产 preflight/start 事实与活 PID、映射文件、cwd 联合核验后通过，未改变产品运行路径。

v2 原分享发布及复制本身成功，但测试将中文 `/cn/share/` 错当成规范 `/share/`。恢复守卫也只认单一路径，把已写入的中文测试链接当成外部改动而保留；**这一轮未恢复用户原剪贴板**。原备份只存在于已退出进程内存，未落盘，现无法从测试资料恢复。后续只读比较确认残留确是该轮生成的中文本机测试链接，已按精确值条件清除；没有清理其他剪贴板内容。诊断与处置见：

- `evidence/native-packaged-clipboard-v2-diagnosis-20261020.json`
- `evidence/native-packaged-clipboard-v2-remediation-20261020.json`

守卫现于实际复制前重新快照完整 item/type/Data，并独立识别同一受控分享的规范/中文两种路径；即使主断言路径不符，仍恢复已知测试内容。复制完成用有界只读轮询观察，不重复点击。用户后续写入其他内容时保留用户新内容。独立 pasteboard self-test 验证多 item/二进制格式恢复、语言路径误判后的恢复和并发用户改动保留：`evidence/native-os-state-guard-selftest-v2-20261020.json`。

**v3 的恢复成功只证明 v3 的起始状态得到恢复，不能倒推 v2 丢失的原内容已经找回。** 此事故已向用户说明，历史失败记录保留。

## 边界与下一缺口

真实企微、外部 MCP、网盘仍未测试；初始身份以隔离后台 email 会话写入原加密 store，恢复与实际请求均走产品路径。包为 ad-hoc Preview，无 Apple 公证、没有安装/发布或三平台声明。

运行还观察到：启动期 secondary `--open-workspace` 的指定目录被 Main 缓存、之后写入 recentProjects，但实际 CLI cwd 为该隔离 profile 下的默认会话目录。此 smoke 断言的是“隔离 cwd”，没有断言“指定目录必须保持激活”；不能据此证明显式工作区打开成功。下一步单独测试启动恢复期间的显式工作区意图，重点核对 `Root.tsx`、`root/useRootPlatformEffects.ts` 的 initial workspace bootstrap 与 `onOpenWorkspacePath` 顺序。当前只是已观测的覆盖缺口，尚未将根因定为产品缺陷。

系统默认浏览器外链出口仍待验。相关原 UI 入口已定位为 `browser-open-external-item`，与分享按钮默认打开应用内 guest 的语义分开。

本轮夹具合同 **170/170**、新增 packaged 模式合同 2 项及相关关闭合同共 9 项通过；后端 Lint 通过。包内应用/Host/CLI 源码及发布产物未因本轮测试而修改。
