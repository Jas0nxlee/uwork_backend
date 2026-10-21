# Linux ARM64 原桌面包与后台联测（2026-10-20）

最终 v9 **七项检查、15 个原界面动作通过**。原 Preview 包从未修改的 app.asar 启动，连接同容器中的当前后端源码、真实 SQLite/HTTPS、原加密会话存储和本地受控 HTTP 供应商。没有替换产品 IPC、注入 React 状态或使用测试 Main。

## 已取得的真实证据

[v9 原结果](../evidence/client-linux-desktop-v9-20261020/result.json)：

1. 原 Linux ELF/Electron → app.asar Renderer 启动。
2. 原 onboarding 完成，恢复普通成员身份；原启动参数指定 `/work/project`，界面工作区匹配。
3. 悬停原项目行 → 原文件树 → 原文件预览；可见 Shadow DOM 的正文包含自有哨兵，未仅以文件名判断。
4. 正常 Renderer reload 后身份/工作区恢复，再沿原文件入口读到相同正文。预览 tab 本身是模块 Map 内存，不声称跨 document 自动恢复。
5. 原 Composer 发送，真实后台转发主回答/标题两次，供应商精确凭据检查无拒绝；本人两条 settled、24 input/20 output Token、44 Credit，模型上下文 cwd 仅 `/work/project`。
6. 生产 spawn preflight 的包内 CLI 参数绑定到活 PID 155；实际 executable `/app/zcode-preview`、cwd `/work/project`、父 PID 112。CLI 改写 process.title 后 argv 不保留脚本，未据此误判进程来源。
7. 通过原后台 API 撤销席位后，同会话原输入/发送实际拒绝，错误提示包含登录/席位/权限检查指引；供应商、本人账本、Token、Credit 均无增量。

最终前后账务只属于 v9；v5/v6 的历史两调用分别留在各自隔离 DB，不并入本轮总数。身份由本机 email 登录与原凭据加密存储恢复，未测试真实企微扫码。

## 修复与验证

v6 的撤权拒绝和零计量本身正确，但原界面仅显示“企业模型服务暂不可用，请稍后重试”。现只修正现有中英文 `chat.error.enterpriseServiceUnavailable` 文案，加入登录、席位和权限检查指引；原精确码映射、原始详情、授权和重试逻辑不变。该类别涵盖 policy/model/relay unavailable，不把它误标成唯一确定的席位错误。

- [旧提示原结果](../evidence/client-linux-desktop-v6-20261020/result.json)、[新提示截图](../evidence/client-linux-desktop-v9-20261020/final-ui.png)保留，已实际查看截图。新提示的关键授权指引可见，仍使用原有单行 banner/展开详情布局。
- 原精确码回归 **2/2**；客户端 typecheck/Lint/architecture/改动格式通过，Lint 为 0 error / 113 既有 warning；新正常 Desktop 构建和原 Linux electron-builder 配置打包均 exit 0。
- 本地原子提交 `f4e97eb4`，只包含两语言文件与规格，未推送。

## 上下文拒绝用例

正常重新构建后生产工具面含 32 工具。v8 实收 tools JSON 133,646 字节、输入保守上界 141,311，加 1,024 输出预算后超过测试模型的 128,000 窗口；原后台返回 CONTEXT_LIMIT，供应商和账本均为 0，见[原拒绝证据](../evidence/client-linux-desktop-v8-size-20261020/result.json)。这是声明窗口下的正确拒绝，未修改生产默认、上界算法、配额或工具定义。

v9 的允许用例通过管理 API 明确创建 500,000 窗口的受控模型，完整保留生产工具面与输入检查，沿原 UI 再执行上述允许/撤权路径。没有删工具、截断输入或降低后台限制来取得成功。

## 打包与资源闭合

- 原资源准备成功；首次直接调用 builder 漏传配置文件而报缺 version，原失败日志保留，随后使用原配置成功。最终包位于 `/Users/ljp/Library/Caches/uwork-backend/client-linux-desktop-package-v2-20261020/linux-arm64-unpacked`，未安装到宿主。Agent SHA 仍为 `6cd2e95f7e9783a98832365919b104cf030e0543a81974154565df22ecd445b9`。
- [独立核验](../evidence/client-linux-desktop-independent-verdict-20261020.json)：实际输入归档 SHA、五个关键运行时文件与源包一致，包运行后原文件不变；最终快照与关闭前 proof 相同。
- v9 后台主动确认关闭，容器 exit 0；九轮自有容器/卷/网络均不存在。SSH 和 browser-harness 两个已知宿主 PID 不存在，两个回环监听端口拒连，BH socket 已闭。
- 专用 Colima 起始为 Stopped，本轮结束后[恢复 Stopped](../evidence/client-linux-desktop-colima-final-20261020.json)，另外两个 profile 保持 Stopped。测试数据根和包/镜像缓存保留，没有声称清空所有系统 FD 或删除测试资料。

测试设施失败也全部保留：v1 的 Docker internal 网络不对外发布端口，最小端点已定位并改为专用 VM 的独立 SSH 回环隧道；v2 缺少原 hover 挂载动作；v3 漏读 Shadow DOM；v4 错将预览 Map 内存当成跨页面持久化；v5 依赖被 process.title 覆盖的 argv；v6 指出原提示问题；v7/v8 为上下文窗口拒绝。早期 SIGTERM 关闭曾得到空最终快照，后改专属控制端点请求关闭并 flush，v4 起逐字段核对完整最终快照。独立核验的首次 absence 检查未统一 Docker 错误大小写，修正后再实查九组资源全部缺失。这些不会被最终 GREEN 改写成通过。

## 继续保留的边界

此项使用私有 Xvfb/DBus、软件渲染、内部网络和新 HOME，无宿主桌面/剪贴板/设备/个人浏览器挂载。直接依赖版本与当前后端安装逐项匹配；测试中的企业会话和供应商均为本地受控环境。

本结果补齐 Linux 原桌面包的一条真实正向及撤权链，尚不证明 deb/rpm/AppImage 安装、物理 GPU、Linux 原生协议登录或 PTY、Windows、生产目标部署或远端 CI。容器缺少 xdg-mime 的日志按最小运行环境保留，未声称默认协议注册通过。真实企微、外部 MCP、网盘继续排除，全范围目标仍 active。
