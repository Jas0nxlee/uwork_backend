# Linux ARM64 原桌面包联测

首启超时调查：独立 startup-only 用例在全新 DB/HOME/profile 中启动原包，只读确认角色页和加载终态，再连续采样 DOM/CDP 响应与零模型/账本。分别测试 unpacked 和真实安装镜像；该用例不替代完整九项联动。记录每个阶段耗时；出现失败时保留直接 CDP HTTP、容器进程状态和已有关闭证据，不因观察超时重启同一实例。

PTY 增量：通过原终端按钮和 xterm 输入一条固定自有命令，写入仅本轮新项目内的哨兵文件。后台只读核对 marker、cwd、tty 路径、shell PID/可执行文件及活 fd/0 绑定；不得经控制端点执行命令。按原组件规则，关闭面板只收起 UI、保留会话；重开应仍为同一活 PTY。沿既有七项业务及关闭证据继续核验，终端不增加模型/账本调用。

使用仓库原 Linux target 资源准备和 electron-builder 配置生成 Preview unpacked 包，正常 Main/Host/Renderer、目标 node-pty、目标 Agent 与 native-search 均保留，不改 app.asar 或替换入口。未安装到宿主，不覆盖 macOS 包。

运行于专用 Colima 的独立容器、私有 Xvfb/DBus、新 HOME/用户数据与项目。无宿主桌面、剪贴板、设备、凭据或个人浏览器挂载。Docker 内部网络只用于宿主连接自有 CDP 转发端口，不允许外部模型/企微/MCP/网盘网络访问。测试结束关闭专属容器/网络/卷及 browser-harness，再恢复 Colima 原状态。

普通生产工具面包含 workflow 定义。128k 测试模型已实测：32 工具、tools JSON 133,646 字节、输入保守上界 141,311，加 1,024 输出预算后由原后台 CONTEXT_LIMIT 拒绝，供应商/账本均零。保留该拒绝用例；允许路径明确创建 contextWindow=500000 的本地受控模型，完整保留工具和原输入上界检查，不修改生产默认、限制或准入。

验证包完整性与真实启动：原 onboarding、恢复普通成员身份、原工作区打开参数、Renderer→Host 的自有文件预览；重载后恢复身份/工作区，再沿原入口重开文件。预览 tab 由 taskSidePaneMemory 模块 Map 记忆，不要求跨 document 自动恢复。原 Composer 发送经包内实际活 CLI 到真实后台/本地受控供应商，核对本人 settled/Token/Credit；后台撤销席位后，原发送拒绝且供应商/账本无增量。UI 通过 browser-harness 在明确自有 CDP 端点操作，不能注入 React store 或伪造 IPC 结果。虚拟显示/软件渲染不代替物理 GPU、systemd、发行安装器或 Windows。身份由隔离后台 email 登录和原加密会话存储恢复，不声称真实企微扫码。
