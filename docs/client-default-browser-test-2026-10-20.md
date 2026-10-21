# 原生默认浏览器外链联测（2026-10-20）

签名 macOS ARM64 Preview v4 真实通过六项检查：原包 Renderer/Main/Host/CLI 启动，恢复隔离企业身份，原发送与记账，原分享发布，原应用内浏览器地址导航，原“更多→在默认浏览器中打开”。没有替换 shell 或产品 IPC。

## 实收证据

- [原探针结果](../evidence/client-native-packaged-external-browser-v2-20261020/probe-result.json)：六项通过、十个原界面动作、fixture exit 0。当前成员两次模型调用、44 Credit；外链浏览无额外调用，另一成员基线不变。
- [默认浏览器证据](../evidence/client-native-packaged-external-browser-v2-20261020/default-browser-proof.json)：NSWorkspace 只读确定默认 Google Chrome 155；内置 Electron guest 的请求为 Chromium 146、Electron=true；原外链菜单点击后，自有页面收到 Chrome 155、Electron=false 的真实请求。
- [自有页面回执](../evidence/client-native-packaged-external-browser-v2-20261020/external-page-receipts.json)：新外部页 history.length=1、window.close 接受。独立原生 AX 完整扫描证明唯一测试标签从 0→1→0、窗口测试标题也消失，不仅依赖页面自报关闭。
- [独立复核](../evidence/client-default-browser-independent-verdict-20261020.json)：9 个已知应用子进程和 1 个 browser-harness daemon 均不存在，5 个端口拒连，原证据文件 SHA 固定。自有 HTTP server thread 已结束。

正式动作前，先以已安装 Chrome 的独立可见 profile 完成[自关闭预检 v6](../evidence/client-external-page-preflight-v6-20261020/preflight-result.json)。正式测试未附着个人 Chrome DevTools/profile；AX 跳过网页区域，仅匹配本轮唯一原生标签/窗口标题，不记录其他标题或页面内容。默认浏览器配置不变，protocol-only 守卫未访问系统剪贴板。测试根保留，不声称零系统索引 FD 或已删除根。

## 失败与修复

第一轮在地址输入阶段失败，尚未点击外链，业务前五项已通过且资源清理完成。[原失败](../evidence/client-native-packaged-external-browser-20261020/probe-result.json)保留。第二轮增补焦点/选区诊断证明：输入框已聚焦，Meta+A 后选区仍为 18..18；标准 CDP 编辑命令 `selectAll` 后变为 0..65，后续输入完整等于自有 URL，导航及外链均成功。修复的是自动化驱动，没有修改产品。

预检早期保留三类失败：blank→navigate 留下 history=2；Chrome 不稳定发出 pagehide；AX 叶节点 NoValue 被错误当成读取失败。正式判据改为页面 close-accepted 加原生标签消失，未以超时或不完整树扫描冒充消失。按已安装 SDK 的 AXError.h 修正原生驱动错误名映射，-25212 为 NoValue、-25204 为 CannotComplete；后者必须失败。两项纯合同通过，Python 编译和 diff whitespace 检查通过。历史 AX 证据的原始错误码保持不变，旧文字标签不作为正确名称引用。

此项覆盖真实默认浏览器出口及本轮自有页生命周期，不覆盖外部企业 HTTPS 登录。真实企微、外部 MCP、网盘继续排除；全范围目标仍 active，系统服务注册及逐能力终审继续推进。
