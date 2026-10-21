# 企微真实拒绝的处理指引

真实 API 已实收 gettoken 成功，而 department/list、agent/get 返回 60020，errmsg 表明来源 IP 未允许。原 Provider 统一建议检查可见范围和接口权限，缺少该错误实际所需的可信 IP 指引。

沿既有 createWecomProvider.get 的错误出口，仅为 60020 选择应用可信 IP/服务出口 IP 指引。保留 502/WECOM_REJECTED、实际上游 errcode 和有限详情；60011 等原可见范围/接口权限指引保持。不改变任何授权检查、白名单或上游响应，不尝试通过降低校验取得成功。

真实测试不保存 Secret/access token/人员数据。错误指引的合成传输回归先 RED 后 GREEN，并复跑后端既有套件。src/wecom.ts 中此前用户已有的改动必须保留，不能为本增量回退或覆盖。
