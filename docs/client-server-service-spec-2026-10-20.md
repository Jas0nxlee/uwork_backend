# macOS Server OS 服务实测范围

补齐 W03/W04 未覆盖的原 `serve --daemon` 默认注册路径。使用新建 0700 私有目录作为显式 `--server-root`，原 CLI 生成按该根散列的唯一 launchd Label 与私有 plist；执行前只读确认同名 job 不存在。不得改系统级服务、真实用户安装、全局 launchd 环境或默认 server root。

沿正常构建的 server-cli/Core：原启动 CLI → launchd → 原稳定 launcher → Supervisor → Core → loopback HTTP。要求 launchd 的 program/arguments 精确指向本轮私有目录，原 status 为 ready/serviceRegistered，HTTP 实际可达；重复启动幂等、restart 更换 Core、stop 不被 KeepAlive 拉起，原 uninstall 双确认解除唯一注册并清理本轮安装文件。只对本轮测试数据发送 DELETE，不授权其他安装卸载。

控制器使用干净环境、固定 Node24，不传 opt-out。原始错误保留，首次失败立即停止业务推进；仅对已校验属于本轮目录的 descriptor/job 做清理。最终确认精确 Label 不存在、已知 PID/端口关闭，保留测试根与证据。此项不扩展到模型、企业 authority、生产部署、其他平台或正式发行安装。
