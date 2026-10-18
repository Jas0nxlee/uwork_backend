# 企业成员会话分享真实联动

2026-10-18。用户决定补齐自有发布、存储和访问接口，仅供已登录企业成员查看。后端及客户端私有通路已落地，本机实际 Electron 生产构建和独立 Chromium 浏览页都已运行；真实企微、外部 MCP、网盘及三平台安装不在本轮验收内。

后端存储、租户与成员/IP 判定、幂等、正文/附件完整性、限额、撤销和过期清理由 301 项完整回归及额外四项独立内存探针核对。真实 TCP/文件库用例包含正常分钟 worker 的清理和关闭重开；以 SQL 控制到期时刻，不冒充七天真实经过。客户端原入口 49 项通过，跨仓真实 HTTP 三项通过。完整类型、Lint、架构和正常构建通过；完整后端格式检查仅被原有无关未暂存测试副本阻挡，该副本按原字节保留，自有变更格式通过。

修复了两个实际桌面入口问题：设置内“浏览插件”关闭后回到聊天，以及企业已认证仍因旧 OAuth user 为空而隐藏分享按钮。后者实际 Header、IdentityProvider 与 ShareMenu 浏览器回归为旧版 4 失败/4 通过，修复后同八场景全通过；退出、身份 owner 切换和残留旧 user 不能补回入口。Host 和后端继续持有最终发布权限，UI 显示不构成授权。

## Native 发布与身份、用量

新正式候选 `fff9f9a5…64b73` 的 146 来源、六入口及实际 6,631 文件/138,802,594 字节完整副本逐项核验，CLI 与 stage 精确复用正常 `b3859893…49124` 构建。通过正常工作区入口和真实按键发送一次短文本，主对话与现有标题各产生一次本机受控模型请求；实际 gateway/ledger 以 request_key 关联，身份、模型、application=uwork、succeeded 和金额核对。初始化两次/44 Credit，加上这两次/44，合计四次/88；是内部测试计量，不是实际供应商费用。

真实点击分享图标、下一步、organization 唯一权限、披露确认和一次发布按钮，出现“分享已创建”。原 ConversationShareService、真实 CLI 投影及私有 BackendSession 发出 prepare 201、confirm 200；测试 helper 没有直接发布或写分享表。后端新增 confirmed 恰一条，creator/tenant 为 Native 成员，三行包含 turnHeader、真实 userInput 和 assistantText，payload/projection/artifact-set 摘要匹配，附件为零，没有结构化凭据字段。发布过程没有新增模型或账本记录。

对同一 Native 产物，普通身份 API 创建的同企业无席位 reader 实际登录后 preview 200、can_revoke=false；匿名预览 401，continuation 403 SHARE_READONLY。实际退出 204 后旧 Cookie 预览 401。辅助脚本误将错误码写成 INVALID_SESSION，真实响应是 Source 定义的 SESSION_EXPIRED；原失败保留，针对原 stderr 与完成流量做严格离线重放通过，零新增 HTTP，没有恢复一次性随机密码、重建成员或重发/再发布。

成功面板不显示 URL 文本。本轮没有点击复制或打开浏览器，URL 只由独占后端记录与规范 origin 派生，不能称为 DOM 读取。该 fixture 的 wrapper 是否转发 `/share/` 页面未验，不将直接内部端口或另一个浏览器测试冒充 Native 链接已打开。

原始 Native 证据在 `evidence/client-native-member-sharing-20261018/`；关键入口为 `turn-verification.json`、`after-share-backend-facts.json`、`reader-offline-followup.json`、`final-backend-facts.json` 与 `share-published.png`。153 文件 manifest SHA 为 `541a324a756048c545b763e52ed4d031695c1943b9fc132f0cf37a96fc3b0744`，代理四文件 manifest SHA 为 `f45939a25384341f7afb9244ab1b2049425009f33f03131c1030a91c3ddb5bb2`。Root 在 `evidence/client-native-member-sharing-root-20261018/runtime-closure-independent.json` 独立确认十三个已知 PID 不存在、五端口拒绝连接。Native/BH/proxy 正常关闭；外部写 FD 下保留新目录 0700，独立 fixture 非优雅停止，不声称拥有完整 OS 流量或删除了该目录。

## 浏览页

独立 Chromium 148 的原页面按钮与 Cookie claim 实测五阶段通过：匿名无正文；同企业无席位成员查看与两个实际下载、字节/SHA 匹配；退出后附件 401；B 企业登录后访问 A 正文和附件 404；owner 取消及确认撤销后正文/附件 404。三个正常 claim 均有 HttpOnly、SameSite=Strict Cookie，JSON 无 token。320/768/1024/1440 无水平溢出，HTML 样例只作为文本，脚本异常及页面未知外网请求为零。企微 provider 是受控替身。

最终浏览页 80 文件封存于 `evidence/client-enterprise-sharing-viewer-live-final-20261018/`，manifest SHA `28b90848dc3e9f48aa28614aa76dff6716ecee7070d29ba3d2eb222e03cbcaf9`。前两轮请求/响应观察器错误原样保留，没有改产品代码去配合驱动。

这些证据支持本机生产构建、真实 Host/后端发布和同企业只读合同，不代表真实逐企业企微扫码、用户默认浏览器/剪贴板、附件的 Native 选择器、远程 authority、签名安装包或全部产品验收。
