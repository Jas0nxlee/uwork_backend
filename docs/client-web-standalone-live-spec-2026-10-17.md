# Standalone Web/Server 真实联测契约

2026-10-17。对应生产 Web 静态入口及 Server HTTP/WS RPC 的两个真实场景。驱动为 `scripts/client-web-standalone-live-smoke.ts`，只验证现有行为，不修改产品实现。

## 入口与构建前提

测试父进程只驱动网络；Server 必须由独立子进程运行本仓库正式 tsup 产物 `clients/uwork/packages/server/dist/entry-http.js`，静态根为正式 Vite 产物 `clients/uwork/packages/web/dist`。RPC 使用现有 `ws`、`SocketProtocol`、`connectViaProtocol` 和 `RemoteServiceAccess`，不能手造 ServiceCollection、以内联 Server 或仅 101 握手替代业务联动。

构建使用 Node 24.14.0、pnpm 10.33.2。在可能覆盖 `server/dist` 的客户端 `tsc -b` 完成后，再正式构建 Server 与 Web；随后到测试结束不得并发覆盖产物。驱动拒绝小于 100 KB 的入口，以防误用 tsc 输出，但该检查不能替代正式构建日志和哈希。

构建必须设置 `ZCODE_ENV=production`、两个 base URL 为受控 `.invalid` 地址，并清空 telemetry/ARMS 端点。必须通过已审查的 `build-env-guard.mjs` 排除**客户端根目录全部 `.env*` 文件的读取**，不修改原文件；守卫缺失即停止，禁止移除守卫后直接构建。主 `.env`、主数据库及主服务实例均不参与。

每个 Server 的 child env 显式隔离 realpath 临时 HOME、USERPROFILE、Desktop home、data、storage 和 workspace；仅继承必要的运行条件。Server token、credential secret 和 Host capability 均为本次合成值，不记录 token URL、Cookie 值或 ticket header，不下发供应商 Key 或企业会话。

## 两个验收场景

1. **HTTP、普通 Web RPC 与重连持久化**：无 token/错误 token 的 `/api/server-info` 为 401；一次 query bootstrap 返回具有 HttpOnly、Path=/、SameSite=Lax 的 Cookie；正确 Cookie 返回 200，工作区与协议版本符合实际 Server。生产 HTML 和其引用的 JS 通过实际 HTTP 返回 200。无 Cookie 的 `/ws` 拒绝；认证后实际调用身份 getView/restoreSession、Gateway getView/sync、模型选择和任务列表，再经文件 RPC 读取自有哨兵、写入 `.zcodeignore`，核对真实磁盘内容。关闭第一条 WS 后建立新 WS，必须读回同一文件与任务列表。
2. **Host capability 与普通客户端权限边界**：未认证不能签发 ticket，正确 Cookie 但无 ticket 的 `/ws/host` 为 401。普通 `/ws` 即使设置旧 `x-zcode-rpc-client-mode: desktop-continuous`，调用 Provisioning target 仍必须由实际 Host 明确拒绝。正确认证取得的一次性 ticket 首次连接 `/ws/host` 后必须完成真实文件 RPC；同 ticket 重放为 401。另发 ticket，等待实际 30 秒 TTL 到期后使用必须为 401，禁止替换时钟或缩短生产 TTL。全程不写入 Key 或伪造企业配置。

当前 standalone 的身份 getView/restoreSession 实际为 `signed-out`、`configured=false`、`error=unconfigured`；Gateway 无身份时保持 signed-out，sync 的 committed=false，且无 user/endpoint/key/models；当前隔离目录的模型 providers 与任务列表为空。取得 trusted-host transport capability 后，企业身份仍未配置。这些结果证明 standalone 的拒绝边界，**不构成 managed enterprise 登录、Desktop 身份传播或企业模型授权成功**；不能为测试强行设置 desktop-local 或注入企业上下文。

## 复跑命令与证据

从后端根目录开始，先确认上述精确工具版本及现有守卫。以下值均为测试隔离配置：

```sh
UWORK_WEB_BUILD_GUARD="$PWD/evidence/client-live-20261017/build-env-guard.mjs"
test -r "$UWORK_WEB_BUILD_GUARD" || exit 1
(
  cd clients/uwork || exit 1
  export NODE_OPTIONS="--import=$UWORK_WEB_BUILD_GUARD"
  export ZCODE_ENV=production
  export ZCODE_BASE_URL=https://web-no-external.invalid
  export VITE_ZCODE_BASE_URL=https://web-no-external.invalid
  export ZCODE_TELEMETRY_REPORT_ENDPOINT= VITE_ZCODE_TELEMETRY_REPORT_ENDPOINT=
  export ZCODE_ARMS_RUM_ENDPOINT= VITE_ZCODE_ARMS_RUM_ENDPOINT=
  pnpm --filter @zcode/server exec tsup && pnpm --filter @zcode/web build
) && /Users/ljp/.cache/uwork-client-toolchain/node-v24.14.0-darwin-arm64/bin/node --import tsx --test scripts/client-web-standalone-live-smoke.ts
```

驱动内的 Server Node 路径同样固定为上述本机 Node 24.14.0；此命令不声明跨平台可用，也不重建 CLI。最终检查为后端 `tsc -p tsconfig.verify.json`、新增脚本的 ESLint 与 Prettier。

2026-10-17 实际结果为 2/2 通过，31.084 秒；过期场景实际等待 30,100 ms。ignored `evidence/client-web-standalone-20261017/` 保存构建日志、测试日志、逐场景返回与清理 JSON、源码/Server/Web/CLI 哈希及 validation.json。初次驱动 ws CommonJS 导入错误的失败记录保留在 `fixture-import-red/`，不能算作产品缺陷或通过场景。

## 清理与验收边界

finally 必须关闭自有 WS，TERM 自有 detached 进程组并有界等待，必要时 KILL；确认监听端口关闭、进程组不存在后删除精确临时根。发送信号或固定 sleep 不等于进程已退出，失败场景也必须清理并留证。不能操作其他 UWork 进程、Native CDP、外部客户端 checkout 或主 3000 实例。

此切片验收 HTTP/static、真实普通/受信 Host WS RPC、文件跨 WS 重连持久化与 ticket 一次性/时效规则。浏览器渲染 UI、模型执行及任务快照恢复、server-cli lifecycle、真实企微、外部 MCP、网盘、手机/云/远端 attachment 和三平台安装仍各有独立验收边界。
