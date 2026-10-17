# 原生设置页与分享入口追加联测

2026-10-17。G04/G06/G08 追加使用 production Electron/Main/Host、正式 staged CLI、独立 HOME、真实后台文件 DB/TLS 和自有 MCP HTTP 端点。真实企微、外部 MCP、网盘、付费模型均未调用。此报告只关闭以下指定切片，整个持续测试目标仍在推进。

## 实际发现与修复

| 问题                               | 原生失败证据                                                                           | 修复与最终结果                                                                                                                                                                             |
| ---------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| MCP status lane 被误判过期         | 权限关闭和开放时均 `enterprise_runtime_obsolete`，受控端点零帧                         | 原企业准入桥识别三条既有 ProcessManager 的精确当前 client；新 Host 实际连接并发现 1 工具，再次撤权为准确策略拒绝、零新增帧；旧 client、workspace 与 disposed fence 保留                    |
| 技能权限失败被误诊为平台不支持     | 真实桌面得到 `enterprise_personal_skills_denied`，同时显示“仅支持桌面端”               | 能力未知/失败不推断平台；技能页和导入页复用完整稳定码的本地化提示，未知错误与日志原诊断保留                                                                                                |
| 导入对话框的旧选择绕过当前技能策略 | 允许时选择 Copy，后台发布 `skills=false` 后仍实际复制到旧目录，并显示已导入 1          | 整次含技能调用复用一次原 backendSession scope；内容 I/O 前后、每次写入前后检查当前策略和原 owner。最终 Native 同样先选后撤权，两个 canonical 目标均不存在；恢复权限后同一选择实际导入 2 个 |
| 导入成功却不可见                   | importer 写 `~/.zcode/skills`，当前 reader 从 `.uwork/skills` 读取；恢复权限刷新仍为 0 | global 导入和去重统一原 `getUworkUserStorageRoot()/skills`，project 原路径保留。最终 2 个导入立即显示，文件完整字节和源 SHA 一致；旧目录文件不迁移、不删除、不覆盖                         |

再次撤销个人技能权限后，实际刷新被拒、已有导入文件字节不变。页面保留的是先前合法列表快照，不代表新的内容读取获准。最后在该拒绝状态完成普通企业模型对话，两个实际模型输入没有新导入技能的正文 marker，也未携带私有 owner proof 字段。

受管 Copy 不再把不可插准入的递归 cp 当作写入屏障；窄 copier 保留独占目标、软链不解引用、mode 和自复制/源子目录拒绝。目录扫描复用既有 walker，扫描整体前后复核；不声称每个内部元数据 syscall 单独授权。已获准派发的 OS 写入可能完成，后续派发与结果受 fence 约束，不承诺回滚。

## 其他真实入口

后台发布自定义 HTTPS 菜单后，实际侧栏点击交给原浏览器 owner 打开 Example Domain，核对 URL、正文 SHA 和页面没有 Node/产品桥接对象。这是一次实际导航，未由菜单出现推断成功。

企业登录恢复并完成对话后，实际 AX 和“更多”菜单没有分享入口。源码仍以旧 `user` 控制分享按钮，旧 OAuth Repo 当前不恢复登录态。没有注入旧 OAuth 用户或替换 shareClient 制造成功；Native 分享成功链继续保留缺口。当前登录恢复使用真实 email HTTP 会话与生产加密 store，**不是真实企微扫码**。

## 产物、计量与验证

最终 CLI/source 与 Desktop staged 均为 `a684e40751e1f9bf7e8e7e3710f8518001451ec33d74964e5502a297a1d23d0c`。技能导入修复只重建 Desktop；提示收尾只重建 Renderer，Main/Host/CLI 字节未再变化。

| 最终产物      | SHA256                                                             |
| ------------- | ------------------------------------------------------------------ |
| Main          | `15610678767611a3efeefaacafc84a0749df7818aed9c70fdfbb995e9c20b899` |
| Host          | `29ed78eadf5f9529ad4909502aa777e8ecaec27f0c543fa8fa90bb0e041312b5` |
| Renderer HTML | `4fe6392039081d8227398cc3b8f1e607f2349f262c191cbb9fce770dc719062b` |

本隔离夹具共 8 次本机受控供应商请求、8 条 settled：另一成员初始化 2 次、旧 Native 产物主调用/标题 2 次、首轮 a684 产物 2 次、最终 Host 主调用/标题 2 次。设置页测试不增加模型调用。MCP 两轮实际握手/发现及一次正常心跳共 9 帧，工具调用 0；发现 1 工具不冒称执行工具。

专项源码 runner 39/39（含父分组）、独立真实 FS 探针 3/3、现有 services 回归 234/234 通过；最终完整 enterprise-policy 为 Core 106、Host 197 全通过。提示三组 9 项、严格测试类型、客户端完整类型、后端/admin 类型与 lint、客户端 lint/格式/架构通过；保留客户端 114 条既有 warning、0 error。

证据在 ignored `evidence/client-native-settings-live-20261017/`：原始 RED、`skills-fixed-import-revoked-proof.json`、最终友好提示/导入结果/列表截图、`skills-final-import-proof.json`、`mcp-final-host-*.json/png`、`final-artifacts.json`、`final-pre-cleanup-proof.json`、`outer-cleanup.json`。源码规格为 `clients/uwork/specs/enterprise-settings-sync-skills.md`，其他入口规格见 `docs/client-native-settings-sharing-spec-2026-10-17.md`。

## 隔离与收尾

生产 out 字节一致地复制到自有 appRoot；Main 导入前的守卫排除源目录 `.env*`，最终守卫有效且阻止次数 0。浏览器只用 DOM/AX 与原生鼠标/键盘，不注入 React/store/业务 RPC。隐藏窗口曾暂停渲染，实际检查 `document.hidden=true` 后才激活该自有测试页；等待/点击失误单独按驱动观察记录，不当产品失败。

最终 Electron 正常 code 0 退出，外层实际核对 9 个自有 PID 消失、5 个端口关闭、自有数据根和专属 browser-harness daemon 删除。原始旧产物阶段一次 SIGTERM 后强制退出有独立记录，未混同最后正常退出。官方 Electron 依赖缓存保留。主后台未重启，未读取主环境文件或解密主 Vault；相邻客户端仓库未改。
