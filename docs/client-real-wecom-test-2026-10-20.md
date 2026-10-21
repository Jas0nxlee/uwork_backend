# 真实企微当前验证

可信 IP 配置生效后，真实 gettoken、department/list、user/list、agent/get 均 HTTP 200 / errcode 0；当前可见范围为 1 个部门、10 名有效成员。配置与 Vault 凭据的内存比对通过，没有保存 Secret、token 或通讯录正文。

在主库一致性备份的独立副本，通过原 HTTP 同步入口实际调用企微两次，均返回 200，第二次没有新增或改变身份数据；已有角色/席位保留、外键校验通过。主库身份数据逐行摘要保持不变，测试副本已清除。此前 60020 拒绝和失败无写入的证据另保留，不覆盖历史失败。

真实扫码页先返回 40300020。现有授权管理会话确认「企业微信授权登录」的授权回调域为空，agent/get 的 redirect_domain 属于另一项网页配置，不能替代该项。localhost 被企微表单拒绝；空项最终保存为本机服务的 127.0.0.1:3000（包含端口），并只将本机 PUBLIC_URL 主机对齐到 127.0.0.1，原协议/端口和其他环境变量保持。环境已在 0700 缓存目录中备份，文件 0600；无执行中的任务，只重启本任务拥有的后端。服务健康及原授权 URL/state/取消/领取拒绝复测通过。

新真实授权页的域名错误已消失，出现正常登录/扫码界面及已有账号的快捷登录界面。尚未取得授权回调成功和真实成员会话，不能宣称完整 SSO 或 Native 企微登录通过。随后 Computer Use 明确拒绝当前浏览器 URL 的自动操作；浏览器流程已停止，没有改用其他工具继续此页面。本次待登录尝试已取消，未要求用户操作。

证据位于 evidence/client-real-wecom-readonly-v4-20261020、client-real-wecom-sync-clone-v2-20261020、client-real-wecom-live-config-v3-20261020、client-real-wecom-oauth-browser-v4-20261020 及 client-real-wecom-browser-stop-20261020.json。后续仍须验证真实授权成功、Native 登录、普通用户权限与完整客户端消费；外部 MCP、网盘继续排除。目标保持未完成。
