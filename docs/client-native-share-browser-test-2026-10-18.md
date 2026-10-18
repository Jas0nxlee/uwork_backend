# Native 分享链接与应用内浏览页联测

2026-10-18。实际 Electron 生产构建通过原分享按钮发布一次会话，再通过成功面板原“浏览器打开”按钮打开同一产物；本轮已验证打开与匿名保护，登录后阅读和退出没有完成。

后续已在全新独立运行补齐成员登录、只读阅读和退出，见[新增联测](client-native-member-viewer-test-2026-10-18.md)。下文保留本次历史运行的原始范围与失败。

这次核实了打开入口的真实 owner：Desktop 的 `SessionPane → useAppPanels → UnifiedBrowserView` 打开应用内 webview，使用独立的 `persist:zcode-embedded-browser` 会话。它没有调用系统默认浏览器，也不能把 Host 私有企业身份当作浏览页已登录。

正常对话实际产生主请求和标题请求各一次，新增两笔 settled、44 内部 Credit；连同初始化共四次、88 Credit。原 ShareService/CLI 投影/私有 scope 产生 prepare 201、confirm 200，各一次，新增 confirmed 恰一条、三行投影、零附件，身份及摘要吻合。分享和浏览阶段模型与账本没有增量；供应商为本机受控服务。

原打开按钮实际创建新 guest，其 URL 与本次后台产物的同源中文路径一致。真实页面、JS、CSS 均 200，匿名 preview 401；DOM 正文长度为零、登录入口可见，416px 没有水平溢出。独立 guest 的 webContents/session 与固定 embedded partition 匹配，并有实际请求和导航摘要，不能用 defaultSession 的记录替代。

随后尝试经现有地址栏到同源管理页登录。第一轮旧输入未选中原地址而追加文本，第二轮完整选择闸门在输入前拒绝；最后正常三击已选中全行，但后续没有形成管理页网络导航。三组失败、原始驱动及两份有限 followup 全部保留。没有读取测试登录凭据、输入密码或执行登录；没有根据这些结果判定产品导航的根因。后续同版本 Electron 探针确认共享普通 Enter 驱动缺少表单默认提交所需的回车文本，修复和三表单复测单独见 `docs/client-native-test-driver-2026-10-18.md`，不能据此把本轮历史导航及授权阅读改写为通过。

发现配置 witness 达 97、超过软阈值 96 后停止全部业务操作，收尾终值 104/128、pending/drop 均零、未饱和。未重发对话或分享，没有复制链接、系统外链、用户 Chrome、真实企微、外部 MCP 或网盘操作。当前结论不覆盖登录后 Native 阅读/退出、附件、裸 canonical 路径变体、console 异常统计或三平台安装。

Native、BH 与代理均已结束，13 个有原始身份记录的 PID 及一个原已退出的 secondary 均不存在，五端口拒绝连接。新目录仍有十个外部写 FD，Root 精确复核独立 fixture 的 PID/birth/cwd/数据库 FD/三监听/无子进程后非优雅停止，保留目录 0700；未递归删除或读取保留目录，也未操作主后台 PID 29003。进程组 SIGTERM 的 Electron 事件 code 为 null，不能称为 exit 0。当前主后台运行证据仍独立记录于 `docs/local-backend-recovery-2026-10-18.md`。

原始证据四叶及 manifest SHA：

- `evidence/client-native-sharing-browser-20261018/`：163 文件，`a92a31a477a49862c89e2db1f82c3fe4d1903dfdc7b4104d3115502f5a81c8f6`。
- `evidence/client-native-sharing-browser-address-followup-20261018/`：14 文件，`3440da940c6090eeca1c6c665d77a31254ceeb54ea4bef8b2fdeac3f79eeee4e`。
- `evidence/client-native-sharing-browser-address-final-20261018/`：12 文件，`3aeaa2b958492d3ec78131b6e8eb94495b0eefdfdad587545e7ac506f23a9735`。
- `evidence/client-native-sharing-browser-proxy-20261018/`：4 文件，`79ce0ea8b9baf080da0bd6be5cd80d9e66940b866206f8160910302ef2e5debc`。

候选 60d4 明确复用正常构建，buildHead 9c56328 与 verificationHead 46b3a33 分列；146 当前来源、14 个新增 owner 来源、六入口及 6,631 文件完整副本分别核对。原 42aa 把 tracked clean 误作全树 clean，在任何 Runtime 前作废并保留；无关未跟踪测试一直保留。正式源码和产物在本轮结束、核验完成后才解除冻结，后续修复不改写这次历史候选。
