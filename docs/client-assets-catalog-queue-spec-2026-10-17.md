# 同 Host catalog 首次装载与后台维护

本轮修复现有 `EnterpriseAssetsHost` 内部 catalog 生命周期，不改 CLI、协议、磁盘 CAS、权限或已冻结 Native 产物。生产合同见 `clients/uwork/specs/uwork-enterprise-assets.md` 的同 store FIFO。

Native 第四代的真实证据位于 `evidence/client-native-experience-live-20261017/expert-catalog-selection-race-readonly.json`。FS 已经通过真实 API 发布为 true，专家已发布且正文 checksum 正确；运行时 trace 的 catalog 因另一条同 Host 读取推进 selection revision 而被拒。bootstrap 正确不接受该失败为允许，却因此在该 runtime 内保持空企业专家快照。后续 catalog 成功不等于该 profile 已重新装载。此前 FS=false 是额外缺失前置，不能作为本轮完整根因。

先以实际后端 TCP、独占临时磁盘、真实身份/lifecycle、现有 private bridge 和同版 staged CLI 复现：后台维护的真实 manifest 响应暂挂；首次 CLI catalog 同时进入；仅 gate 原响应，不伪造响应或异常。旧实现出现 selection CAS 拒绝且实际 Agent 子请求不含批准专家；FIFO 后两者独立重新准入，真正子请求含批准正文。使用现有 `UWORK_GATEWAY_EVIDENCE_RUN=red` 区分独占 RED/GREEN 证据目录，不覆盖历史。

另验证排队取消、原 owner 退出/替换、dispose、失败后后继任务：等待中的调用有界拒绝，零旧 scope 新 HTTP/缓存写入，后继当前任务可完成。两个独立 Host 仍依赖原磁盘 CAS，使旧读取不能删除新选择；版本替换、撤权、损坏和 crash 原拒绝合同保持。所有新等待只持有 pending 操作，不合并允许结果，不无界重试。

实际 probe 使用自有 backend/cache/CLI/端口并清理，主 `.env`/DB/Vault、当前 Native 与浏览器不在范围。源码验收后由 Root 统一 Desktop 构建和真正 Native 重测；不由 Node/source 或本机 CLI 测试冒充 Native 已通过。
