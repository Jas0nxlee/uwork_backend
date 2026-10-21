# 最新 macOS 原包本地前后端联动切片

载荷为正常 Darwin ARM64 Desktop 构建、原 electron-builder 配置的 ad-hoc Preview `.app`，包内 Agent 必须保持 `cdf781ecf004b9639157fae25e6e96e558b95faefaee7aab09488d5dc650ecac`。先核原签名及实际包内 SHA，历史 6cd 包结果不迁移到此载荷。

只用全新自有 backend/profile/app/CDP 和独立 browser-harness daemon，原 macOS 产品 UI 交互仅通过该 Electron CDP 坐标/键盘事件。不触个人浏览器、host 全局键鼠或系统剪贴板。受控供应商明确返回测试响应，真实后台 HTTP/Host/CLI 和账本保持原路径；不宣称真实企微 OAuth 或外部模型质量验收。

顺序验收：原 FirstRun 与原加密 store 身份恢复、企业模型配置；原文件树读取自有文件并经 renderer reload 恢复；原 xterm 输入产生自有文件、真实 shell PID/cwd/TTY 与面板保活；原 Composer 成功一次并严格对账主回答/标题两次、当前成员 44 Credit、另一成员基线不变；撤席位后原发送拒绝且调用/账本零增量；原退出登录后停原 app、同一 controller/profile 冷启动，企业身份、当前候选和用量不复活。产品允许保留本地历史任务，不能据此误判企业权限泄露。

受控身份/bootstrap 只在 controller 启动时一次 seed。后续 `launch()` 不再写 store；冷重启必须复用同一个 controller，不能重建夹具或再次 restore。读取和清理都按本轮 PID、映射可执行、cwd、端口和私有目录归属收口；不全局杀进程或删除用户数据。OS 协议默认处理器只由原 protocol-only 守卫恢复，该守卫使用临时私有 pasteboard，不读取系统剪贴板。

签名、业务、拒绝、冷恢复和清理分别记录，任何失败不得被总体 GREEN 掩盖。首次 v4 生产命令漏原 ad-hoc 开关导致未签名候选，作为 producer 配置失败保留；v5 用原开关正常重产，不手工改包或重签旧候选。
