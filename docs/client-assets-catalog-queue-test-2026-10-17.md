# 同 Host 资产 catalog FIFO 修复与验收

2026-10-17。修复生产 Host 后台维护与 CLI 首次专家目录装载的 selection 自冲突。产品改动只在现有 `EnterpriseAssetsHost`；CLI、协议、授权规则、磁盘锁和跨 Host CAS 均未修改。

Native 第四代的真实 CLI 日志在 `15:14:03.361Z` 记录 `Enterprise expert catalog denied / enterprise_asset_selection_changed`。同一 Host 的另一路 select 在之前成功推进 revision；专家缓存正文与批准 checksum 相同。FS=false 曾是缺失前置，但发布 FS=true 后仍发生该冲突，不能把权限准备当作完整根因。该 catalog 拒绝发生在正文读取之前，没有证实 `crypto` 缺失。

既有 runtime 只在启动时装载企业 profile，拒绝后保留空快照；后来另一个 catalog 成功不会自动补装专家。原 CLI 专项没有同时挂载 production identity maintenance，因而不能覆盖这次 Native 并发。

## 修复边界

沿原 `storeFor(scope)` 为同 Host、同 store 的完整 catalog 事务排 FIFO：从 revision 读取，到 HTTP/物化/重验，再到第二次 select。队列只存 pending tail，不存目录或允许结果。每项保留进入时的私有 scope，出队前校验原 owner、配置和取消；没有按新身份重捕旧请求。

等待取消可立即拒绝，但内部 slot 仍在前驱之后退休，后继不能越过正在执行的事务。失败不毒化 tail。dispose 先关闭并取消，再等待原调用与内部尾链结束。不同 store 不共用队头；不同 Host 继续由原磁盘 revision 拒绝过时选择。没有忽略 CAS、TTL allow cache、无界重试或错误转 empty-ready。

## 实际验证

| 层次                                | 结果                                 |
| ----------------------------------- | ------------------------------------ |
| 新实际 CLI/TCP/disk 专项            | 9/9                                  |
| 原独立 Host/CLI 与 SIGKILL 恢复专项 | 3/3                                  |
| 完整 enterprise-policy Core         | 109/109                              |
| 完整 enterprise-policy Host         | 288/288                              |
| Root、Services 严格 noEmit          | 均 exit 0                            |
| Client lint / 定向 Root lint        | 113 既有 warnings、0 errors / exit 0 |
| 架构、定向格式                      | 0 violations / 通过                  |

RED 使用真实后台 TCP、独占磁盘、production identity/assets lifecycle、原私有 bridge 和正式 staged CLI，只暂挂真实 manifest 响应，不伪造数据或异常。旧实现真实产生 selection 冲突和零专家 child。最终 GREEN 核对父 session 的成功终态、标题与账本完成，4 次受控供应商调用全部 settled，实际专家子请求恰好 1 次且 system 包含批准正文。CLI source/staged SHA 始终是 `39175fd59577db9c2e80519170ab33e96e622f22c8cb86f18bf3241e2507d43c`。

其他新场景包括：排队取消且后继不能越过队头；原 identity 注销/重登；原配置更换；真实 HTTP transport 不合作取消时的 dispose；两个私有 profile store 并行；独立 Host 的旧 CAS 拒绝；版本替换后旧事务拒绝、新事务成功；损坏字节持续拒绝且不自动下载修补。每项都使用实际 backend/私有 scope/磁盘，不注入 selection 错误。

原三项专项另证实准备超时回收真实 Host/CLI、较新独立 Host 的选择不被旧 Host 清理，以及 SIGKILL 发生在物化过程中后通过新 Host/CLI 恢复。原有撤权与权限拒绝测试保留在完整 Host suite 中。

## 证据与交接

`evidence/client-assets-catalog-queue-20261017/source-freeze.json` 记录精确文件 SHA、命令和 stdout；`summary.json`、`metrics.json`、`outer-cleanup.json` 记录接受结果。`red/` 与最终 `green/` 分开；原跨 Host/崩溃脚本使用独立 CWD，历史证据未覆盖。准备阶段一次误将 maintenance 的第二次 manifest 自锁、一次在 Fastify ready 后安装 gate，均以 driver preparation 单独保存；中间重复 GREEN 不叠加到最终九项。

所有自有 CLI、Host worker、backend/代理/供应商端口及临时根均按各 fixture 清理并由外层复核。未操作当前 Native/浏览器，未读主 env/DB/Vault，未构建或覆盖正式 out。完整客户端 `tsc -b` 会产生声明文件，故本切片使用严格 noEmit；正式 Desktop 构建由 Root 统一执行。

本轮不声称 Native 已通过。Root 仍需用新 Host 产物和同版 39175 CLI 重走真实冷启动/新 task，验证专家 child 与 context 排除；SWR 修复的 Native 导航验收独立保留。
