# Linux 普通用户与协议补测范围

复用已验原包和真实隔离后台，在专用 VM 新容器中以 UID/GID 1000 运行后台、原 Electron、Host、Agent CLI 和 PTY。仅自有 `/work` 数据根交给该用户；系统安装文件和原包只读。保留已有完整九项业务断言、两次模型/本人账本计量与撤席位零增量，额外读取进程真实 UID/GID。

协议走应用原 Linux 注册，再由系统 `xdg-open` 读取原 desktop/MIME 配置，投递到同一实例。测试目录包含空格和中文。有效 workspace URL 必须出现原生确认，取消保持原工作区，确认才切换；路径拒绝、原实例保活、模型零增量分列。不得手工重写 Exec 或直接调用产品处理函数代替系统协议投递。

先运行现有 unpacked/deb 形态的普通 UID 切片。若容器 namespace/seccomp 不支持 Chromium sandbox，准确记录并保留 `--no-sandbox` 的测试边界；普通 UID 不等于 sandbox 或物理桌面验收。可在同样隔离条件继续原 AppImage 提取运行；不声明 FUSE 挂载通过。真实企微、外部 MCP 和网盘不在本切片内。

AppImage 扩展使用原产物的 `APPIMAGE_EXTRACT_AND_RUN=1` 启动方式，原 runtime 解包与 AppRun/二进制启动都实际执行。原文件哈希不变；仅在自有 `/work` 设可写 TMPDIR。运行后从真实 `/proc` 与 CDP URL 解析动态提取目录，不能伪装为固定 `/app`。协议注册仍由原产品根据 APPIMAGE 与已有 allowlist 决定，不能手工改 Exec 或替 installed/deb 放宽 sandbox。

每次使用全新 DB/HOME/userdata、独立只内网网络及有限 CDP/SSH/BH 会话；结束核对后台最终快照、exit code、自有进程和端口/容器/卷/网络关闭。不得修改宿主系统协议或用户安装。

诊断增量：AppImage 系统协议投递期间原 runtime 已观测 exit 127，并发生第二实例冷启动；未确定是提取运行时、产品单实例逻辑还是测试环境导致。先在同包/同用户/同 namespace 以 strace 只追踪进程与信号，记录原进程终态和信号来源；不记录 IO 载荷或环境凭据。诊断产物不替代未带追踪器的最终验收，不用扩大超时或关闭原实例断言来消除失败。
