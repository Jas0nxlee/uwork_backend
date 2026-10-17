# Native 项目技能导入与撤权联测

真实项目 Copy 导入、W1/W2 隔离、三项独立撤权、取消与允许删除均通过。10 个阶段的文件和账本断言、8 次已发布权限的真实 HTTP 回读通过。本轮没有发现新的业务缺陷；界面操作使用当前控件和实际状态，测试驱动的错误假设单独归档。

## 执行范围与结果

使用本仓库的正式 Main `c3d27b…`、Host `9afc1a…`、CLI/staged `39175fd…`，独占 TLS 后台、SQLite、HOME 和 Electron profile。原 Main PID56414/birth02:25:57 及 Root CDP target `B3E33C38B672F80803B6525360ECF0B4` 保持；正式第二实例打开 W1/W2，实际侧边栏、项目选择器和 composer 对应目标项目。不是系统目录选择器或安装包验收。

| 实际操作                                                   | 观察结果                                                                                     |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 已选择技能后发布 personal.skills=false，再真实点击项目导入 | 明确拒绝；W1 技能父树没有新增，源/W2/user 文件不变                                           |
| 恢复三项权限，实际选中并以 Copy/project 提交               | 导入成功，W1 列表出现唯一技能行；仅 W1 新增目标，164+29 字节精确同源，两个目录0750、文件0640 |
| 正式打开 W2、选择 W2，再返回 W1                            | W2 sentinel 可见且 W1 技能及开关不存在；回 W1 原行存在；各技能树和账本不变                   |
| 确认框打开后单独撤销 personal.skills                       | 真实确认后拒绝，技能行及目标保留                                                             |
| 确认框打开后单独撤销 allowFilesystem                       | 真实确认后拒绝，技能行及目标保留                                                             |
| 确认框打开后单独撤销 dangerousSkills                       | 真实确认后拒绝，技能行及目标保留                                                             |
| 全部恢复后取消删除                                         | 行及精确字节保留                                                                             |
| 全部恢复后确认删除                                         | 实际行和 W1 目标先稳定消失，再保存文件快照；源/W2/user 不变                                  |

各负向删除均保持另外两项权限为 true，并经同一独立 owner HTTP 会话回读真实 published/version/revision；不是把 UI 显示或旧配置当准入。Trash 点击固定 W1/skill，确认后公开方法才捕获当前企业 authority。没有在模态框背后切项目/身份，也不冒称已捕获 owner 后的 Native I/O race。

基线和最终均为2次本机供应商请求、原2条 settled 账本；这两次来自夹具的另一成员初始化，业务操作模型与账本增量为0。没有真实付费模型、企微、外部 MCP 或网盘调用。

## 原始失败的准确归类

`driver-attempt1-archive-index.json` 保存了4个未实际提交 Copy 前误命名的快照/校验工件，原路径到归档路径的 SHA 一致。真正成功的 Copy 是 attempt2，后续比较仅使用其真实文件参考。重开导入保留已选状态、关闭动画尚未结束、第二实例打开项目正常退出设置，以及确认按钮 AX 名含快捷键，都属于驱动假设；未将这些记为产品失败或实际隐藏/禁用。

原样保留错误观察及新的真实输入。实际确认使用观察到的“删除 ⏎ / 取消 esc”，没有更改产品源码、注入 store/身份或直接调用业务 RPC 代替点击。

## 运行资源与清理

完整 out 快照为13,268文件、248,418,931字节，全部源/目标校验通过。准备耗时约32分钟，当前打开的新增资源副本实收 compressed/dataless 标记；此前同候选快照为6,659文件、约0.8秒。这里记录资源数量和文件系统 I/O 漂移，不断言某个同步服务的根因，也不记为业务失败。

16个已知自有 PID、4个端口及专属 BH 已全部关闭，独立 reader 正常 logout。系统 fileproviderd PID791 仍持有本次私有 R 的8个写句柄，所以 mode0700 的 `data/client-native-project-skills-20261018` 保留。没有终止该系统进程或修改同步设置。为避免 common close/TERM 递归删除仍有外部写者的目录，仅精确停止已验明的自有后台进程；这不是优雅 fixture close，也不是根目录已删除。原主服务37266和另一独占准备环境未被操作。

原 88 源/6产物、准备/驱动、旧 UI/observer 与历史证据共572项前后 SHA 匹配。252项本轮工件封存于 [run-manifest.json](../evidence/client-native-project-skills-20261018/run-manifest.json)，动作、文件和回读事实见 [run-summary.json](../evidence/client-native-project-skills-20261018/run-summary.json)，保留目录边界见 [cleanup-final.json](../evidence/client-native-project-skills-20261018/cleanup-final.json)。后续清理应写新 followup 证据，不改此批封存文件。

[独立终审](../evidence/client-native-project-skills-final-review-20261018/review.md) Required none：重新核验252工件与572保护项，直接回放10阶段、8次策略回读、完整模型正文和账本；明确保留非优雅停止、外部写句柄及根目录未删除的边界。

Root 后置只读检查：主服务 health200/PID37266，9张业务表、原7个静态文件、4个独占 admin 产物和10个相关源文件哈希均未变，相邻客户端 checkout 干净；见 [main-after.json](../evidence/client-native-project-skills-root-20261018/main-after.json)。未读取主 .env、解密主 Vault 或部署新管理页到主实例。

## 验收边界

本项调用现有 `settingsSyncService.importSelected` 和 `skillsService.deleteSkill`。`copyToCommon/removeFromCommon` 没有当前产品 UI caller，不能据本项勾为 Native 成功。多企业实际认证、会话分享、手机/managed remote、公开商店、系统选择器和跨平台发行继续单列；本项不关闭整体 U02/U03/U04/U05。
