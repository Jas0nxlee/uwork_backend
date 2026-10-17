# 终端凭据真实管理界面验收

本切片只补此前尚未提交的“签发终端凭据”入口。用户、角色、基础用量等既有验收不重复计入；现有 `admin/src/Settings.tsx` 提供签发和元数据查看按钮，没有吊销按钮，因此本次边界明确为 **UI 签发、API 吊销**。

## 隔离与凭据边界

以 `scripts/admin-ui-fixture.ts` 的 `createApp`/`bootstrap` 模式派生独立夹具；使用独占 0700 临时根、SQLite、动态 loopback 端口、合成身份和内存随机主密钥。使用当前 `admin/dist` 正式构建资源，记录入口及 JS/CSS 的哈希、相关源文件时间与构建资源包含现有入口的证明，不重建客户端产物。

浏览器采用自有官方 Chrome 进程、独占 incognito/headless profile、动态 loopback CDP 与短路径 BH_HOME。显式 `BU_CDP_URL`/`BU_NAME`、`BH_RECORD=0`、关闭 harness telemetry；不得附着用户现有浏览器或别的 agent 的 profile。根 Node 使用当前后台 Node 24.19.0。

完整终端 token 只在正常产品签发响应与浏览器 DOM、夹具内存中短暂存在。夹具 onSend 仅观察未修改的真实登录/签发响应，在内存持有本次 interactive/device token 以完成后续真实 HTTP。不得输出、截图、写证据、写环境文件或记录完整 token；DOM 采集只返回字段名、存在性、数量与时间，元数据 ID 也脱敏。一次性签发结果弹窗关闭之前禁止截图、page_info 全文、AX 全树输出或 DOM 全文输出。

不读取主 `.env`/主 DB/主 Vault，不操作主 3000/PID 37266，不创建模型、不请求模型生成、真实企微、外部 MCP 或网盘。不得重试已被安全拒绝的 remote model/Provider/command 探针，不替换 fetch、API 响应、React/store 或注入业务状态。

## 验收事件顺序

1. 真正 DOM 邮箱/密码表单登录，进入“企业与企微”页面。通过 AX/DOM 定位与 CDP 原生鼠标、键盘操作，打开“签发终端凭据”，将有效小时设置为 2 并点击“保存”。后台必须实际收到 `POST /api/auth/device-tokens`，返回 201，且只签发一次。
2. 对一次性结果只读取安全布尔与字段名，确认 token 仅在该结果中出现；关闭结果弹窗。通过真实“查看我的终端凭据”按钮打开元数据列表，必须只有 `id` 哈希、创建/到期时间，不得返回 token 字段或完整凭据。实际 UI 没有字面星号掩码时，按“哈希 ID 元数据、无 token 明文”记录，不伪称星号掩码。
3. 夹具使用刚才 UI 签发的同一终端 token，通过真实 HTTP `GET /api/client/configuration` 读取本人组织的普通客户端配置，返回 200、租户匹配。该操作是 API 使用验证，不算 UI 提交。
4. 使用同一 UI 登录交互会话通过真实 `DELETE /api/auth/device-tokens/:id` 吊销，返回 204；同一终端 token 对同一路径再请求必须返回 401。再由 UI 打开元数据列表，实际显示为空。

失败保留 RED 和脱敏 DOM/HTTP 收据；本轮不改生产源码，发现产品缺陷只报原因与最小修复位置。驱动错误单列，不能覆盖首个失败或用模拟响应变为通过。

## 文件与清理

- `scripts/admin-device-token-ui-smoke.ts`：拥有后台、浏览器和 BH 生命周期；在内存观察真实 token，执行一次普通配置读取及 API 吊销，不增加测试业务 HTTP 端点。
- `scripts/admin-device-token-ui-browser.py`：browser-harness 内真实 DOM 驱动，分别执行签发/元数据阶段和吊销后空列表阶段；只输出脱敏结果。
- 每次新建 ignored `evidence/admin-device-token-ui-20261017/<run>/`，保留资源哈希、UI 安全证据、按通道区分的 HTTP method/route/status、API 使用结果与清理结果。

结束先关闭自有 Chrome 和精确 BH daemon PID，再关闭 app；逐 PID、进程组、后台/CDP 端口、临时根、BH_HOME 校验已退出或删除。不能以“已发信号”代替关闭证明，不能操作不属于本次运行的进程。Node/TypeScript、目标 ESLint/Prettier 与 Python 语法检查使用当前仓库工具；客户端 out、CLI 和生产配置不在本切片写入范围。
