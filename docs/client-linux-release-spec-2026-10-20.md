# Linux ARM64 发行运行时补测

使用原 stageCli 从正常 server-cli/Core/Agent 构建生成 Linux ARM64 发行树与归档，包含固定 Node 22.16.0、目标平台 native search 工具和依赖。不得以宿主 Node24 或 macOS 的 native binary 替代包内运行时。

仅启动既有 UWork 专用 Colima；记录原为 stopped，结束后恢复 stopped。新容器无外部网络、不注册系统服务、不挂载用户 HOME，仅挂载只读发行包/探针和全新可写 0700 测试目录。容器不访问企微、外部 MCP、网盘或付费模型。

沿包内原 launcher serve --daemon 的显式 opt-out 路径运行：Node 版本/平台 → 原 Core ready → HTTP server-info → 原 WebSocket SocketProtocol/ChannelClient/RemoteServiceAccess 读取自有文件、SystemService 报告隔离 HOME/Linux → 原 restart → 新 Core/新 WS 重读相同文件 → 原 stop → 原 uninstall 双确认自然退出 → known PID/端口/Unix socket 关闭。包内 native search 工具必须实际执行。控制器与容器终态、源归档/运行时哈希另行保留。

此项补 Linux 原 Server 运行时和固定发行 Node 的证据，不声称 Linux Electron GUI 安装、systemd 注册、Windows、企业 managed remote authority 或生产发布完成。原 UI 和企业后台链路继续使用各自既有证据。
