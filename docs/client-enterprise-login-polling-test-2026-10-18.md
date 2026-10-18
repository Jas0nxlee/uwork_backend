# 企业登录轮询与窗口迟到结果回归

2026-10-18。当前真实 React Provider/Hook 在独立浏览器一次通过 **25/25**：新增两个交付顺序场景及原有 23 项回归。身份、Native 和 Gateway 为有限合成端口，未运行真实 Native、企微或模型服务。

新场景先从原按钮进入：`openEnterpriseLogin` 保持未决，原 waiting effect 已发起 poll；仅结算该 poll 为 authenticated，不广播认证事件。真实 Hook 自然关闭窗口一次、发起 `startup` 同步一次。随后分别交付旧 open 的 null 与 `ERR_ABORTED`，持续观察超过原 1500ms 轮询周期，两例均保持 authenticated、poll=1、cancel/complete=0、无重复关闭/同步、无运行错误或外链打开。没有复现新的产品缺陷，生产 Hook 保持原字节。

运行器同步修复全局进程查询、继承错误 CDP/debug 配置、无期限等待和失败时删除临时根的问题。PID 查询只沿本次已知 PPID/birth 树；daemon、driver、Vite 完整关闭分别有 5 秒、180 秒、3 秒截止。未知 FD、失败或探测不确定均保留本次两个根 0700，只有完整成功且 scoped FD 为零才删除。有限模型保留原缺口，安全合同和实际短截止验证按各自层次记录，不与 25 项界面场景相加。

实际 runner exit 0；完整 Vite close、已知资源及两根 FD 检查均通过，临时 Chrome/BH 根已移除。Root 独立核对 90 个记录过的进程身份不再存在、两个端口拒连，以及两个新场景的投影/计数。

原完整 `pnpm typecheck`、Lint、架构和改动文件格式检查均 exit 0；Lint 保留 113 项既有警告、0 错误。类型检查前按批准白名单保存并隔离正常 out，之后恢复 6,631 文件、138,807,291 字节，全部 SHA 一致、0 writer；本次检查未生成新的 canonical out。Root 再独立核对正常构建的 156 份来源，仅四份已批准 test/spec 改变，产品输入均保持原哈希，无需因测试变动重建 Desktop。

运行基线为 `572236a`，测试期间八份 test/spec 尚未提交，最终由 `62308bb` 保存。原失败、准备 v1/v2/v3、最后一行首次失败停止规则、格式修正和资源收口分别保留，没有业务重试或改写旧证据。

证据为 `evidence/client-native-primary-login-hook-live-20261018/`，核心 manifest SHA `6f244a6d5732c75f741c688f04134e064c37ba196223df0bc2b7c1c9ade571c3`；十份关键收据和八份当前来源已独立校验。Root 收据位于 `evidence/client-sharing-followup-root-review-20261018/primary-login-hook-*.json`。

本项证明当前组件交付顺序。客户端空身份→原生登录→Host 私有 claim/存储→后台配置、模型及用量→冷恢复与退出仍在独立接线和运行验证，不能据此勾为完成。分享 guest 的受控成员登录已另行通过，见[原生分享联测](client-native-member-viewer-test-2026-10-18.md)。真实企微、外部 MCP 和网盘继续排除。
