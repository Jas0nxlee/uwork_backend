# Native 企业成员分享页登录、阅读与退出联测

2026-10-18。通过原 Native 界面完成发送、发布、打开分享、成员登录、只读阅读和退出各一次，无业务重试。分享浏览页的实际 preview 依次为 **401 → 200 → 401**，退出为 204。

| 原界面阶段               | 实际结果                                                                                                    |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| 正常发送与发布           | 主流式请求、自动标题请求各一次；prepare 201、confirm 200；confirmed 一条、三行投影、零附件，摘要和身份吻合  |
| 成功面板打开             | 原按钮创建应用内 guest，独立 embedded partition；同源页面、JS/CSS 成功加载                                  |
| 匿名访问                 | preview 401、正文为空、原企业微信登录入口可见                                                               |
| 原登录按钮与受控身份兑换 | 原 attempts/claim、一次原 TLS callback 及一次 provider identity 兑换成功；由原浏览页取得会话，不注入 Cookie |
| 同企业成员阅读           | 当前普通 member、无模型席位；同一 guest/session/导航显示问答，退出可见、撤销不可见                          |
| 原退出按钮               | logout 204，正文清空、登录提示恢复，随后 preview 401                                                        |

模型基线是两次初始化、44 内部 Credit。Native 对话新增主/标题两次、44 Credit；最终四次、88 Credit。发布、登录、阅读和退出四个阶段的模型请求、账本行、Trace ID 集合均与发送完成时相同，没有新增调用或费用。witness 最终 14，pending/drop 为零、未饱和。

此次验证使用本机受控身份兑换和模型服务；官方企微页面、二维码和扫码仍按约定排除。Native 发布者身份沿原加密存储恢复；本项补齐的是分享 guest 的成员登录，客户端从空身份点击登录的成功链路仍独立待测。附件、撤销操作、系统默认浏览器和三平台安装继续保留各自验收边界。

认证开始后永久锁住截图、AX、原始 DOM、链接及网络明文提取，只读取固定布尔/公开文本投影并输入原控件。原记录的 ready `status` 字段读到了隐藏子节点的旧文字；生产成功分支已隐藏其父区域，没有残留可见加载提示。后续仅修正测试投影，两个 DOM 合同先 1 RED/1 PASS、修正后 2/2，加原八项隐私回归通过；见[取证合同](client-native-viewer-evidence-spec-2026-10-18.md)。该修正没有重写本轮原始证据或改变产品源码。

准备轮 v1 的快照过期、v2 的 secondary 覆盖通用 PID 记录、v3 的 CDP Target 查询选错接口均保留实际失败。驱动分别改为同一次调用内刷新快照、每 PID 独占记录，以及公开 `current_tab()` 绑定当前页面；原截止、来源、隐私和动作预算保持。

Native、BH、代理及独立 fixture 已结束，五个已知 PID 不存在、五端口拒连。Native 事件 code 为 null，fixture 经 Root 精确身份核验后 SIGKILL，原 PTY exit 1；业务验证命令 exit 0，各层结果分别保留。新私有根因八个外部写 FD 保留 0700，未递归删除或查询外部持有者详情。总生命周期约 333 秒，低于 900 秒预算；主后台保持运行。

Root 收尾只读核对主后台 health 200、原 PID 42125 和启动时间不变；九张业务表及四份已部署管理端资源保持原哈希，主库分享/附件仍为零。相邻客户端 checkout 干净，无关未跟踪测试保持原字节。没有进行主实例管理员登录、模型调用或环境/Vault 读取，收据为 `evidence/client-sharing-followup-root-review-20261018/main-protection-after-v4.json`。

测试候选为正常 Desktop 构建 `dde4ede5a7ee5f167f1cf83a1cc9b1f0a8991cefed8c71146df74c3232df5725`，构建 HEAD `bbf3572`、当时源码 dirty；运行验证 HEAD `5188df8`。Root 在运行前后核对 252 份来源，运行结束时仍为原 SHA；完整 out 为 6,631 文件、138,807,291 字节。该冻结在后续取证脚本修复前结束。

证据目录及 manifest SHA：

- 实际 Native：`evidence/client-native-viewer-authorized-v4-20261018/`，110 文件，`3e5adf40ec8a188a8f4ebc13ead9c7c57fd5b04a090cd85dc65dfe2432df209d`。
- 独立代理：`evidence/client-native-viewer-authorized-v4-proxy-20261018/`，3 文件，`c4df8ae58114b7e508bf888ac1e7494c7045b742da4494a42d64aaeba6a42952`。
- Root 独立业务、来源、进程及封存核验：`evidence/client-sharing-followup-root-review-20261018/native-viewer-v4-*.json`。
- 观察器回归：`evidence/client-native-viewer-projection-fix-20261018/`，保留原失败、实际退出码、修复和十项通过记录。
