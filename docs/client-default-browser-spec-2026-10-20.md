# 原生默认浏览器外链验证

从原 UWork 应用内浏览器地址栏导航到本次新建的 loopback HTTP 页面，再点击原“更多→在默认浏览器中打开”。沿原 platform IPC 和 Electron shell 调用，不替换 shell、不注入业务调用。

默认浏览器必须只读确认是已安装的 Google Chrome。预先以该 Chrome 可执行文件启动独立可见 profile，验证同一自有页面的 self-close 协议；不连接个人浏览器 profile。正式验证不附着用户 Chrome DevTools，不读取 Cookie，不改默认浏览器。原生 AX 只将标签/窗口标题与本轮唯一测试标题比较，跳过 AXWebArea，不保留其他标题或读取页面内容。服务器只记录固定字段和 UA 的 Electron 标记/Chrome 主版本，不保留 Cookie、Authorization 或任意请求头。

页面先在 Electron guest 中产生 embedded-ready 回执。控制器随后将该一次性页面切为 external 阶段，原菜单打开同一 URL，要求真实默认 Chrome 的网络请求及 ready 回执，其主版本与默认浏览器一致且没有 Electron 标记。新页面 history.length 必须为 1，调用 window.close 后要求 window.closed=true，并由独立原生 AX 完整扫描确认本轮标签先出现、再消失。Chrome 预检未稳定发送 pagehide，因此它仅作附加证据，不作为关闭判据。

关闭机制依据 [Chromium DOMWindow::Close](https://chromium.googlesource.com/chromium/src/+/cc011a493c09f9d3c5ccb2f73a299c22aef6dd1d/third_party/blink/renderer/core/frame/dom_window.cc)：单条历史的新页面允许自行关闭，接受关闭后会设置 closing 状态。最终仍以实收回执判断，不能仅凭规则推测关闭。

原生应用仍用独立数据和受控后台；使用 protocol-only OS 守卫，不读取/写入系统剪贴板。正式点击限一次；要求没有额外模型计费、窗口/后台资源关闭。此项证明默认浏览器导航出口，不声称真实企微、外部 MCP、网盘或外部企业 HTTPS 登录验收。
