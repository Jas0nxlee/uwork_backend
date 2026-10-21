# Linux deb 安装形态补测

其余格式使用原配置的受控文件树在 Linux 原生工具链运行 --prepackaged，不导出删减配置或手工重组安装包。复制 tracked 构建配置/helpers/icons、公开 provider/default 配置和已验 build metadata；逐 SHA 验证副本，不复制 .env/用户凭据。工具镜像固定 electron-builder 26.8.1，原配置自行选择平台/身份/产物。先验证产生的格式与运行时文件，再区分实际运行和仅格式/元数据证据。

复用已验原 Linux Preview 包，先复制到独立 staging，再由原 electron-builder 配置以 --prepackaged/--linux deb 生成安装器。该阶段原工具会添加 package-type/app-update/AppArmor 资源，不能修改已验原包；核心 app.asar/Agent/native 文件须与原包匹配。

只在 UWork 专用 VM 的新容器内真实安装、运行与卸载：确认包名/架构/版本和依赖，使用 dpkg/apt 原安装脚本，检查可执行链接、desktop/MIME 文件、协议注册；沿已验界面与真实隔离后台运行，再执行原卸载并检查包文件/链接/注册残留。所有系统路径变更仅在一次性容器层，不触及 macOS 安装、其他 VM 或用户真实数据。测试结束清理自有资源并恢复 VM 原运行状态。

不能用解压内容替代 dpkg 安装，不能用手工生成 deb 或改包跳过原安装脚本。需要修复时保留原失败安装器，先更新对应产品规格及测试，再重打包并复验。虚拟显示、容器 sandbox 边界与 Windows/物理桌面另列；真实企微、外部 MCP、网盘仍排除。
