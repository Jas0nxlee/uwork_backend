# Linux 系统协议与异步工作区确认

当前状态：正常原AppImage完整11项真实联动通过；同源普通UID已安装deb在允许user namespace的临时容器环境中通过3项系统协议切片。默认Docker外层seccomp拒绝仍单列，整体测试目标未完成。

## 已确认的问题与修复

原系统 xdg-open 到达 SingletonSocket 后，Main 同步确认阻塞 Electron notification 返回，第二进程约20秒后误杀原实例。初步 setImmediate 放开首次 ACK 后，v13 的原 Main 与对话框已存活25秒，但8秒后发送的并行 URI 对应另一个 Electron 仍等握手。该快照不能证明额外进程已获得锁或越过 ready。

修复继续由 Main 持有协议入口：通知只安排下一轮事件处理并返回；外部工作区确认使用异步 Electron showMessageBox，单个 Promise 尾链串行显示确认。协议 consumed 布尔值仍同步返回，只有确认成功后才能探测文件系统并沿原 IPC/renderer-ready 入口投递。冷启动 bootstrap await 相同确认，取消/null 保持默认启动回退。URL/UNC 前置拒绝、locale、默认取消和 additionalData 优先级不变。

确认绑定最初业务窗口，在队列前后和最终消费点重验窗口/webContents与原退出屏障。微任务间隙的窗口销毁已取得2个确定性RED并修复；过期允许不能转交其他窗口。未持单实例锁的进程不得进入 ready bootstrap。不是通过增加等待时间、删除安全确认或改写发行归档解决。

## 已执行回归

- 初始新合同旧同步实现13 RED；异步消费窗口销毁再取得2 RED；最终新增17项全部通过。
- Desktop纯单测44/44、原renderer-ready集成10/10；共71项，无skip。最后格式、typecheck、Lint、架构均成功；Lint113项既有warning、0error。
- 正常 build:no-runtime-assets 和原 electron-builder Linux ARM64 dir 打包均成功，未复制真实环境文件。新Agent归档仍与原产物一致。
- 独立评审重新执行新增17+原ready10=27/27，未将受控Electron端口冒称原生窗口验收。

## 原生产物与终测

正常构建manifest：`evidence/client-async-confirmation-linux-package-manifest-20261020.json`。使用原配置生成AppImage/deb/rpm/pacman，独立消费者核对真实格式、元数据、五核心文件和普通用户读取/遍历权限。第一次builder人为禁网而缺公共GitHub工具缓存，退出1且没有发行包，保留设施失败日志；第二轮允许原工具正常下载，AppImage和deb已完成，但RPM压缩被专用VM内核OOM killer终止；内核证据保留，不能写四格式全通过。两份已完成包继续各自核验，RPM/pacman待释放GUI资源后按原配置单独补产。不修改产品配置或压缩规则。

真实原生终测尚进行：普通UID1000、实际桌面注册与xdg-open、完整窗口管理器、自有工作区。确认至少停留25秒，期间另发未知自有URI；两通知自然握手退出，始终只有原Main。取消保持原目录，确认才切换含空格/中文路径，模型与账本增量为零。AppImage和实际dpkg安装的deb分列，不拿一种代替另一种。

已保留RED：`client-linux-desktop-appimage-primary-v13-20261020`，详情见独立 [时序分析](client-second-instance-analysis-2026-10-20.md)。提取目录并发删除假设已被实际runtime反证，没有添加NO_CLEANUP环境绕过；缓存清理观察与本次握手修复分开。

## 边界

本次Linux ARM64自有容器测试不代表物理Linux GPU/FUSE、Windows或macOS原生验收。Electron41在macOS无父窗口的showMessageBox仍可能同步，Linux结果不能外推macOS冷启动全部异步。真实企微相关浏览器页面已有工具安全拒绝，不换工具重试；企微OAuth仍未闭环。外部MCP和网盘仍排除。整体测试目标尚未完成。

### 组合驱动观察修正

v14/v15的新包均通过10条业务检查（含真实PTY/UID1000、两次供应链调用及44Credit结算、撤席位拒绝）并通过25秒确认期间并行URI且唯一Main。整体仍为failed：驱动把有任务的页面当成空白草稿，先读取不存在的composer工作区按钮，又误把workspace-title任务标题当工作区名。原UI仍留在原project且确认已取消，失败原因在观察器。根据原WorkspaceHeaderSections源码，活动任务的工作区显示来自workspace-path按钮aria-label，workspace-title是任务标题；驱动现分别观察草稿按钮或该原aria-label，维持目录、PID和账本断言。原失败不改写为成功，完整v16复测另列。

### AppImage v16 最终通过

`evidence/client-linux-desktop-appimage-async-v16-20261020/result.json` status=passed、45.075秒，11检查/21原UI动作。原AppImage SHA256为 `4bcbeefa49c232f7c3bb3bbfa145b0a8db79c5798c5c648e5cb99f8abf0c8f47`，与实际镜像输入一致，四份Main/gate源码SHA与正常构建manifest一致。

原Main55持有确认25.231秒，8秒后并行未知URI launcher正常exit0，等待后Main列表仅[55]；原可执行文件和Singleton owner未替换。Escape取消保持原任务工作区project；下一次原系统URI经原生确认才切换至protocol space 测试。协议过程相对原业务基线零模型/账本增量。

同组还完成原文件预览、reload恢复、真实PTY输入与文件副作用、隐藏重开同PTY、Desktop/Host/Agent/PTY均UID1000、真实供应商链两调用及两笔44Credit结算，撤席位后再次发送拒绝且无新增调用/计量。原shutdown ACK、隧道退出、容器exit0、容器/卷/网络均消失，最终业务proof与运行中一致。root已独立解析并断言以上结果。

实现已原子提交 `2cd3fb4e`（仅4份Main/gate源、2份永久测试与规格）。Server归档属主和组件manifest原文修复分别为 `1a0e2c93`、`63121013`，见相应Server报告。deb默认Docker安全边界触发启动拒绝的原因，已由下一节同包userns环境对照进一步区分；没有更改desktop Exec、持久化no-sandbox或复制二进制规避。

### deb 原包环境对照通过

`evidence/client-linux-desktop-deb-userns-v5-20261020/result.json` status=passed。相同deb SHA `f7f25e0279d045b069fa879ec224aacdce630a30edaed57b0c655b7e00dce68a`、相同原desktop Exec及原参数，只临时允许自有容器user namespace；UID1000/cap-drop ALL/no-new-privileges不变。原Main68确认停留25.109秒，两个launchers自然exit0、仅原Main，取消project、确认含中文空格目录，全程模型/账本0，原容器exit0及网络/卷/隧道闭合。五core与AppImage同源expected一致，原dpkg purge另验通过。

默认outer seccomp下的v4仍failed且原日志保留：无法建立user namespace会回退SUID sandbox，Chromium对带空格的chrome-sandbox prefix拆为/opt/UWork，尚未触发Main确认便失败。对照没有通过修改desktop、安装路径或持久化no-sandbox求绿。首实例由原测试fixture显式带no-sandbox，不能用本次主renderer Seccomp0称sandbox正例；无no-sandbox的secondary namespace样本与独立sandbox v6证据分列。

### 最新四格式独立验证完成

重压缩空档释放后，原helper顺序RPM、pacman各单target自然exit0，四格式原消费者也exit0。AppImage/deb字节与已验原包完全相同；新RPM/pacman使用同一正常预打包输入和原配置，未改压缩参数。`evidence/client-linux-native-formats-async-v1-20261020/independent-verdict.json` 与 `data/sandbox-verification/linux-native-validation-async-v1-20261020/work/result.json` 均passed：4种真实格式/架构/版本元数据、20核心文件SHA、20公共权限条目全部通过，3具名容器均不存在。root已独立解析核对。

这不是先前失败all-target命令整体成功，也不代表完整更新feed：最后单target生成的latest-linux-arm64.yml仅有pacman一条，其size/SHA512已独核正确，另三格式不在该文件中；没有签名、发布或远端CI验收。
