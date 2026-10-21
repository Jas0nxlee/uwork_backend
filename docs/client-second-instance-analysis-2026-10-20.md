# AppImage v13 并行协议实例：只读分析

本分析读取 v13 已封存运行证据及其正常打包输入，不重跑 GUI、不修改 Main 或测试。结论是：PID 693 在断言时确实存活，是另一次 AppImage 启动的 Electron Main；但现有证据不能证明它已获得单实例锁或越过 ready 门禁。它很可能仍在等原实例处理第二次通知的 ACK，不能把这个快照直接写成“ready 门禁失败”。

## 已证明的事实

来源为 `evidence/client-linux-desktop-appimage-primary-v13-20261020/result.json`、同目录 `container.log`，以及对应 `data/sandbox-verification/.../work/protocol-cancel.log` 和 `protocol-parallel.log`。

| 事实                                       | 证据                                                                                                                                     |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 原实例在请求前持锁，随后显示确认           | 请求前SingletonLock指向 `2e23b8173feb-56`；真实确认框PID为56；原运行时50→Electron56。采样后未另取锁调用返回值，不能据此声称693取得了锁。 |
| 并行调用存在真实第二 Main                  | `ps` 显示 runtime 679（PPID1）→Main 693→zygote 695/696，693 状态 `Rl`，不是 zombie，不是 PID56 的 utility 子进程                         |
| 原实例未被替换                             | 主窗口/原生确认仍归 PID56；原 executable 仍存在；CDP 仍响应原实例                                                                        |
| 第二次 launcher 结束不等于 Electron 已退出 | `xdg-open` launcher 返回0，但 detached AppImage 679/693 仍在；系统 opener 的退出只能证明交给桌面入口                                     |
| 并行 URI 比第一个确认晚约8秒发送           | 测试在确认 hold>8s 后发 `zcode://unrecognized-owned-protocol-test`；hold 总25.169s，因此采样距第二 URI 发出约17秒                        |
| 693 未表现出创建应用窗口/Host              | parallel log 09:53:30.375–30.395 仅 crash capture、协议/图标注册；没有693的 `createWindow`、Host、ready或退出屏障日志                    |
| 693 的异步 shell prewarm 很晚才回调        | parallel log 下一条是09:53:47.163，报告 shell-free fallback after16785ms，与30.38启动相符；不是已经完成ready的证据                       |

失败后的测试 finally 会关闭原确认框并清理容器，因此日志末尾延迟回调与进程清理是故障观察之后的事件，不能倒置成采样时已完成锁握手。

v13 未记录 `requestSingleInstanceLock` 返回值、693线程栈或 singleton socket逐包轨迹；锁等待的具体位置/超时阈值仍需新证据确认。尤其不能凭“20秒”假定本轮约17秒样本已经超过真实握手期限。

## 正常产物中的门禁确实存在

v13 AppImage SHA256 为 `f2784e6ddd2899a510dd7286324d73bb9be16bf15360163d023c2e0e9bff1163`。对应 native packaging v8 输入 `expected.json` 指向 desktop package v4；其 Main 源输入 SHA 为 `6a04b211df2a5307e7eb36b287a18047501643d0fdf33808dea45c98df8259e2`。

只读提取该输入 `resources/app.asar` 内 `out/main/index.js`，bundle SHA256 `61c957a26210d151c1b150fea5705fdffd2778880f04ac898a9ac8e179db04ad`。其中实际包含：

- `requestSingleInstanceLock(...)`，失败后 `app.quit()`。
- `app.whenReady().then(async()=>{if(!gotTheLock)return; ...})` 的等价压缩代码。
- `dispatchSecondInstanceWorkspaceRequest` 的 `setImmediate` 延后分派。
- 外部工作区确认仍通过原 `dialog.showMessageBoxSync(...)`。

因此不是仅在当前源码里看见门禁、却未进测试产物。ready 门禁只能阻止已经得到 `false` 的进程建立完整窗口/Host，不能替原实例服务后续的 singleton IPC。

## 根因候选与最小方向

当前 `setImmediate` 能先放行触发第一个工作区请求的通知回调，再进入同步原生确认；但用户还未作出决定时，后续 URI 启动的另一进程仍需要原实例及时响应锁握手。同步确认仍可能阻塞这条服务路径。这与第一次 launcher 已结束、第二次693迟迟未退出、原实例仍活着的组合相符。

应优先把外部工作区的原生确认改为异步 `dialog.showMessageBox`，保持同一父窗口、默认取消、取消/确认语义及确认后再做文件系统探测。第二实例事件应立即完成通知分派，异步业务工作需显式捕获失败；同一原实例未决确认期间的后续请求仍必须可被握手确认。只增加第二个 ready guard、跳过用户确认、给外部路径默认信任、延长固定等待、关闭 sandbox 或直接杀第二进程都不能证明修复了这个问题。

主线复测应继续使用原 `.desktop`/`xdg-open`，在确认保持未决时发并行未知URI和另一个已知请求，观察每个对应原包进程真实退出，原锁/PID不变且只有一个业务窗口/Host；再分别取消和允许工作区切换并核对模型/账本零增量。必要时记录各 launcher对应的 runtime/Main PID、锁调用前后事件、单调时钟与实际退出，而不是把 opener返回0当进程退出。

本分析不宣布已修复；v13 的原始失败、35.616秒总时长与完整清理证据保持。
