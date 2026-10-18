# 自有插件 Native 生命周期验收

2026-10-18，macOS 上实际 Electron 生产构建窗口、正式 CLI 与独立后端。测试使用自有静态插件，仅包含 manifest 和 Skill 文本，不执行插件技能、命令、Hook 或外部 MCP。

12 个业务阶段通过：实际安装 1.0.0；User 禁用并保存 label；更新 2.0.0 后配置保留；移除 Source 后成为 orphan；第二代冷启动保留版本/禁用/label；从设置点击“浏览插件”回到可见商店；重添原 Source 恢复关联；取消卸载后安装记录、两个版本缓存、数据、配置和 Source 字节不变；确认卸载后清退此 ID 的全部版本缓存、数据、安装记录及 User 保存配置；第三代冷启动没有复活。合法的未安装候选卡仍可出现，Source 输入保留。新 Workspace 没有建立覆盖，不能据此声称遍历清除了所有 Workspace 配置。

这次实际窗口验证了缓存归属修复（`820d008`）和设置退出导航修复（`87179c0`）。候选为 `cc09aacf…17296`，146 个来源、6 个正式入口；CLI 与 stage 均为正常构建 `b3859893…49124`。启动时完整实际副本 6,662 文件、138,815,881 字节逐项核对，不能用该初始副本证明运行后的整个源目录未变化。

15 份完整模型请求正文及账本快照均与本轮初始化的 2 次请求、2 笔 settled、44 Credit 一致，Native 增量为零。第三代冷启动 witness 为 83/128，停窗口后为 86/128，pending、drop、saturation 均为零。代理有两次实际验证 TLS 的公开目录连接、六次公司目录拒绝，未知连接与记录丢弃为零；这不代表官方插件安装、外部工具执行或 OS 全流量抓包已验收。

Root 独立重放进一步确认取消前后完整 FS 记录除观测时刻外字节相等。确认卸载后与第三次冷启动相比，`known_marketplaces.json` 的原文件 SHA 有变化，有限 Source 投影、其余记录及清退状态一致；没有读取保留目录分析该文件的具体变更内容，不能声称冷启后每个原文件逐字节相同。独立回执为 `evidence/client-plugin-owned-final-root-20261018/functional-independent.json`。

保留了三类执行器问题：首次遗漏 TS loader、第二次启动的 stdin 未连接真实 PTY，以及第二代冷启动在库存就绪前点击管理按钮。前两次初始化正常或精确终止，原记录归档后才重建；库存等待与嵌套失败保存修正仅改变测试驱动，经纯测、冻结和独立复核后在同 Main/target 续行，没有改产品事实或重演更新。

三代 Native、BH 和代理均正常退出。Root 独立核对 34 个已知 PID（本轮 31 个与失败初始化 3 个）均不存在、五端口均拒绝连接。测试目录仍有八个外部写 FD，因此保留 0700，不读取或删除；仅精确复核后的独立 fixture 被 SIGKILL，退出码 1，没有完整 desktop-traffic 终档。首次导入失败没有捕获 PID，以执行器 terminal exit 1 为其终态，未夸大已知 PID 的覆盖范围。

运行后源 out 新增 6,251 个副本，原 6,662 路径仍在、146 来源和六入口哈希保持。额外文件内容读取阻塞后中断，未声称全量额外哈希完成，也未推断来源。Root 将整个 12,913 文件目录原样隔离，重新正常构建；新的准确树为 6,631 文件，少了十五个重复 ready 标记及十六个旧 scheduler 输出。新树用于后续分享测试，历史插件证据仍绑定原候选。

原始证据在 `evidence/client-native-plugin-owned-final-20261018/`，326 文件 manifest SHA 为 `d67c898ec45aafbf66d54745907ce882932482cafe0d3b9669b86450bf83587f`。Root 独立收口见 `evidence/client-plugin-owned-final-root-20261018/runtime-closure-independent.json`。后续干净构建与未完整内容哈希的隔离目录边界见 `evidence/client-native-share-runtime-candidate-20261018/README.md`。

真实企微、外部 MCP、网盘、官方插件的 Native 安装/运行及三平台安装包仍未由本轮覆盖。
