# Read 返回前的企业权限复验

2026-10-18。原正式 Read 已进入文件端口等待后，同一企业权限被撤销，返回正文仍进入模型结果序列化；定向合同先保留失败，再修复并复测。

正式 builtin Read 在执行前绑定原授权端口和账号 owner，读取返回后再次检查当前权限及相同 owner。撤权、换账号、管理模式变化、端口消失或替换均扣留正文，随后不执行成功结果序列化、PostToolUse 或成功事件。读取和复验共用原工具期限；取消或不合作的授权端口不能令执行永久悬挂，迟到 allow 也不会再发布终态。错误明确说明读取已完成、正文未释放。Write/Bash 的副作用语义不因本次修复改变。

验证包括正式 Core 119/119、Host 292/292、根及 CLI 标准 typecheck、Lint、改动格式和架构检查。Lint 为零错误，根保留 113 条既有警告，CLI 的 Core 保留 11 条既有警告。产品修复提交为 `3147fb838fd861cbbb10992160ca6f851ae1eee4`，原失败及最终合同保存在 `evidence/client-read-result-fix-20261018/`。

新正常 CLI/Desktop 构建的 7,323 个客户端来源在构建前后逐 SHA 相同；CLI 与实际 staged CLI 相同，完整 6,631 个桌面文件及副本均已校验。构建清单为 `evidence/client-read-result-build-20261018/artifacts.json`，SHA `21e46cbd3f21e74a7363fe47a5a6825b8d235fadab490025b8c014a4582771fb`。

首轮新打包 CLI 实测经真实本机后台、Host relay 和 OS 文件完成五阶段：禁读、禁写、允许读取正文进入指定工具结果、允许写入、同会话撤权后禁写。收到 10 次主请求及 1 次标题请求、11 笔 settled 账本；实际 Read 经过 before_hooks、before_dispatch、携带原 owner 的 before_result。会话和供应商凭据未出现在 CLI 流或 Host 模型 RPC 帧中。该轮 CLI 正常退出，三个临时服务端口关闭，临时目录移除。

首轮测试记录遗漏 Token 字段：管理端 usage API 返回 `input_tokens`/`output_tokens`，旧夹具按驼峰读取，JSON 序列化静默丢弃了值。夹具现已直接读取正式字段并验证非负整数，随后在全新目录重跑五阶段实测通过：实际 usage API 的 11 笔 settled 账本合计 **55 input Token、22 output Token、99 Credit**，与 11 次供应商请求一致。CLI 正常退出、三个端口关闭、临时目录移除。首轮证据保留，未倒填 Token 或由金额推算；此处修复的是测试记录。

复测证据为 `evidence/client-read-result-packaged-v2-20261018/manifest.json`，SHA `4b0f08dddf96919be8c9187ec89c5d7989d1ebce920040e54ba60ae50e3f6b40`；首轮封存 SHA 为 `f0ee1e478a39b9cd48a4abd70a8827721cedab1eb3f9007166dabaf3d02ab615`，保留其 Token 字段缺失边界。

这份报告不代表 Native 界面的文件引用发送或空身份登录已验收。“文件端口等待期间撤权”由真实 executor/Read/serializer 加受控端口的定向合同证明；打包 CLI 实测使用真实 OS 读写及正常测试身份预种。后续 Native G07c 和 G04h 保留各自的原界面验收范围，真实企微、外部 MCP、网盘继续排除。
