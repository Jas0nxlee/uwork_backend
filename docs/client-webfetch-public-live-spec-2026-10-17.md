# G07 公共 HTTPS WebFetch 真实补测契约

2026-10-17。驱动 `scripts/client-webfetch-public-live-smoke.ts` 沿用真实联测 fixture 的独立临时后端、HTTP 配置发布、私有 Host model relay 和正式 staged CLI。仅本机受控供应商返回真正 WebFetch 工具调用及正文提取响应，不访问真实付费模型。

每次记录当前 source/staged 一致的 CLI SHA256，并在结束时再次核对两份产物均未变化；不把首轮历史 SHA 固定为下一次修复后的预期值。首轮产物为 `8663d7207b3701afe3df50f894fe63c881d8b177a24932fd272203d010af6eba`。驱动不重建或修改产品、既有 builtin smoke、共享 fixture，每次运行只创建一个 CLI/session。

一个有界场景包含两个阶段：

1. 通过实际后台 HTTP 发布 `allowNetwork=true`、`allowedDomains=["example.com","127.0.0.1"]`；本机域名用于受控模型供应商，仍受后台策略约束。受控供应商在真实主模型响应中下发 `WebFetch`，目标为无需账号的 `https://example.com/`。CLI 保持原生 DNS、TLS、公共地址与 SSRF 检查；不使用自定义解析器、替换 fetch/响应或代理制造成功。成功必须有实际私有 `network_request` 帧，正文进入 WebFetch 的提取模型请求；提取后的短 marker 必须作为本次 tool_call_id 的工具结果进入后继主模型。只记录正文长度、SHA 和少量语义布尔，不额外落盘完整响应。
2. 保留同一 CLI/session，通过实际 HTTP 发布 `allowedDomains=["127.0.0.1"]`，移除公共目标但保留本机模型上游，再次下发相同 URL 的实际 WebFetch。后继模型必须收到本次工具结果 `enterprise_domain_denied`；该阶段必须存在实际工具准入请求，但没有目标 URL 的私有 `network_request` 帧，也没有新正文提取请求。此边界说明工具在 Host 准入处被拒绝，不声称持有公共站点的访问日志。不能用 `allowNetwork=false` 代替此场景，因为它先阻断模型上游，无法生成实际后续工具调用。

只尝试一个公共目标一次；公共读取沿用产品默认有界超时。若真实 DNS、TLS、路由或公共站点响应阻断，仍完成撤权拒绝阶段、保留准确工具错误和清理证据，然后将公共成功项保持失败/开放，不能把网络环境限制认定为产品缺陷或改成跳过通过，也不反复重试。

执行命令（后端根目录，Node 24.14.0）：

```sh
/Users/ljp/.cache/uwork-client-toolchain/node-v24.14.0-darwin-arm64/bin/node --import tsx --test scripts/client-webfetch-public-live-smoke.ts
```

证据位于 ignored `evidence/client-webfetch-public-20261017/`，包含两个阶段的短结果/正文哈希、真实 Host 授权帧、CLI SHA、模型调用与账本、CLI 退出及自有端口/目录清理。fixture 对本机 Host TLS 仅添加其自有 CA，并在退出时恢复；CLI 公共 WebFetch 的证书验证保持开启。不得读取主 `.env`、主数据库、3000 实例、真实企微、外部 MCP 或网盘，也不改变系统 DNS/代理/证书设置。

本轮实际结果：1/1 通过，3.069 秒；170 字符公共正文进入提取模型，55 字符工具结果进入后继主模型。同 runtime 撤销域名后的目标网络请求帧与提取请求均为 0，拒绝码为 `enterprise_domain_denied`。CLI 正常退出，三个自有端口关闭，临时目录移除；6 次本机模型调用对应 6 条 settled 账本。此结果不扩展为任意网站、带身份网页、浏览器渲染或跨平台验收。
