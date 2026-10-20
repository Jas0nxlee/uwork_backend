# Linux 原用户 systemd 服务验收切片

测试目标是本项目专用 Colima VM 的真实 user manager。只使用 `colima-uwork-backend`；已只读确认 VM PID1 为 systemd、当前 UID501 的 `systemctl --user is-system-running` 返回 running。它不是物理桌面或生产主机验收。

使用正常 producer 的匹配 Linux ARM64 Server 归档，逐 SHA 固定后在 VM 新建 `/tmp/uwsysd-*` 私有根。原 `serve --daemon` 注册原用户服务；不能手写 unit、伪造 systemctl 响应、开启 opt-out fallback 或改用户 manager 的全局环境。原 label 在测试前必须不存在。

SDK 设置写入前，读取本轮 Core 的 `/proc/<pid>/environ`，只核对明确的数据根字段，确认修复后的 Core 绑定本轮 root。不能以 `--server-root` 本身代替证据。调用 CLI 的正常用户 HOME 和 user manager 全局环境保留；Core 子进程的默认 profile 由产品代码绑定私有 root。

验收：原注册 ready/serviceRegistered、真实 unit ExecStart/FragmentPath 与本轮 launcher/root 一致；重复 daemon 不换 Core；原 SDK File/Setting 在私有根写入并回读；原 restart 换 Core 后相同文件/设置仍可回读；原 stop 后至少12秒仍 inactive；原 uninstall 的两次真实确认、unit/link/descriptor 消失、已知 PID/端口/control socket 收口。用户数据由原卸载合同保留，不把保留的 `.uwork` 记成系统服务残留。

如果任一归属守卫失败，不操作该 unit，不执行 SDK 写入。只允许对本轮已验证归属的 label 停止/disable。与 RPM/Arch/SSH GUI 的重操作分时，保持原服务3000及其他 Colima profile不变。此切片不运行模型/任务/终端工具，不补造 managed remote authority。
