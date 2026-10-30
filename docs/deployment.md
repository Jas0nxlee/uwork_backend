# 运行、部署与恢复

## 本机

```sh
npm ci --ignore-scripts
npm run init
npm run build
npm start
```

需要 Node 24.13+（本轮 24.19.0），npm 11.12.1，依赖锁定在 package-lock.json。安装不执行依赖脚本；esbuild/rollup 使用平台可选包。首次 init 创建 32 字节主密钥和随机初始密码，不打印秘密；凭据在 `data/bootstrap-credentials.txt`（0600），数据目录 0700。重复 init 不覆盖现有用户。可在环境中提供 BOOTSTRAP_EMAIL/PASSWORD/ORGANIZATION，不写到命令行。

首次初始化先独占创建并持久化受保护登录凭据，再提交初始账户；已有凭据文件或无效输出目录会在创建账户前拒绝。账户提交前失败只清理本次新建凭据文件；账户提交后若 Tenant ID 注记写入失败，保留已持久化的 URL/Email/Password，避免丢失随机密码。已初始化数据库不会重置用户或凭据。

默认 PUBLIC_URL 为 http://localhost:3000，HOST 为 127.0.0.1。管理端与 API 同源；前端开发 `npm run admin:dev` 代理至 3000，写入 Origin 需与 PUBLIC_URL 一致，所以完整操作验证使用构建后的同源入口。

`.env.example` 只放占位值：MASTER_KEY 必须是 64 位十六进制（`openssl rand -hex 32`），不能沿用开发实例的密钥；BOOTSTRAP_EMAIL/BOOTSTRAP_PASSWORD/BOOTSTRAP_ORGANIZATION 只被 `npm run init` 读取，可不填，也不写入命令行；SANDBOX_HOST_SOCKET/SANDBOX_SOCKET_GID 只被 `compose.sandbox.yaml` 读取，应用本身不解析这两个变量。

## 生产与容器

Dockerfile 为固定基础镜像摘要的多阶段构建，Compose 仅绑定 loopback 端口、只读 root、去除 capabilities，数据使用持久卷。已在独立 Colima `uwork-backend` 实例实际构建镜像，使用独立数据卷验证初始化、登录、配置发布和重启持久化；不修改用户默认 Docker context。

1. 在目标主机准备 `.env`，MASTER_KEY 为 64 位随机 hex；PUBLIC_URL 为实际 HTTPS origin。不要沿用开发实例密码/密钥。
2. 数据目录必须归运行 UID 所有；镜像 node UID/GID 为 1000，bind mount 下应提前准备权限。Linux 主机的现有用户目录不能直接假定适配容器 UID。
3. `docker compose build`；首次在可写数据目录运行 `docker compose run --rm backend node dist/cli.js init`；再 `docker compose up -d`。需要隔离代码执行时叠加 `compose.sandbox.yaml`，并在执行前设置两个仅 Compose 使用的变量：

   ```sh
   export SANDBOX_HOST_SOCKET=/run/uwork-sandbox.sock
   export SANDBOX_SOCKET_GID="$(stat -c '%g' "$SANDBOX_HOST_SOCKET")"
   docker compose -f compose.yaml -f compose.sandbox.yaml build
   docker compose -f compose.yaml -f compose.sandbox.yaml run --rm backend node dist/cli.js init
   docker compose -f compose.yaml -f compose.sandbox.yaml up -d
   ```

   两个变量都是必填，缺失时 Compose 直接拒绝；SANDBOX_HOST_SOCKET 是宿主专用 engine 的 Unix socket 路径，SANDBOX_SOCKET_GID 是该 socket 的实际组。不要把 socket 权限改成 world-writable，也不要挂载共享或生产 engine 的 socket。

4. 反向代理提供 TLS；PUBLIC_URL 必须与浏览器访问 origin 相同。不要开放管理服务的明文公网端口。
5. `/health`、实际 `/` 登录与业务调用分别验收；健康不等于上游生成、企微登录或投递成功。

单实例约束：SQLite WAL 只用于本机持久卷，禁止 NFS/共享卷和多副本写入。服务和初始化命令均须先持租约再迁移/恢复。租约使用宿主启动身份及 PID 命名空间，15 秒心跳；同命名空间检查进程存活，其他命名空间必须等待 120 秒失联才能接管，不能用本地 PID 不存在推断远端死亡。未知旧版租约必须先正常停止旧实例释放。失去租约的进程停止工作器、拒绝 HTTP 请求，写入在 SQLite 写事务内校验归属。跨宿主/容器共享临时库已验证拒绝接管且保留运行记录。扩展到多实例仍需迁移 PostgreSQL/共享工作队列并完成并发测试。

生产上游默认必须 HTTPS 且为公网地址；每次 DNS 检查后固定连接地址，不跟随重定向。内部模型可由服务器管理员在 `PRIVATE_MODEL_ORIGINS` 中列出精确 HTTPS origin，逗号分隔，包含实际端口，不能包含用户信息、查询、片段或非根路径。仅模型生成与探测可使用其 RFC1918/IPv6 ULA 例外，回环/链路本地/其他保留地址仍拒绝，其他出口不消费该清单。保持 `ALLOW_PRIVATE_UPSTREAMS=false`；旧开发开关仅在明确接入受控内部服务时开启，会扩大所有已授权配置的网络出口边界。

## 备份与恢复

```sh
npm run backup -- /absolute/protected/backups/uwork-snapshot.sqlite
```

使用独立只读连接调用 SQLite 在线 backup API，包含一致 WAL 状态，不迁移源数据库；以 0600 独占创建目标，已存在则拒绝覆盖。主密钥 `.env` 中的 MASTER_KEY 必须另行受保护备份，丢失后无法恢复 vault、任务和缓存密文。备份不是把运行中的 sqlite 文件单独复制一份。

恢复：先停止服务并保存当前数据快照，在新目录恢复 snapshot，保持 0600/0700 和正确 UID，用对应 MASTER_KEY 启动，验证登录、vault 解密、已发布配置和账本。快照自带旧实例租约；同命名空间旧进程已停止时可回收，跨命名空间须等待其心跳过期。未知旧版租约应在确认所有实例都已停止后由管理员离线清除，禁止在线删除。不要同时运行源实例与共享副本。备份恢复测试已使用独立临时目录执行。

升级/回滚：先备份数据库与主密钥、记录代码 commit，停止旧实例后启动新版本；失败时停止新实例并恢复对应版本的数据库快照。不能只回滚代码并假定未来 schema 可向后兼容。当前 schema 为 v6：v2 增加隔离 Runtime，v3 增加命名空间租约，v4 增加父运行取消意图、工具记录及按 run 的沙箱绑定，v5 增加 MCP 冻结版本、分派标记和父运行会话绑定，v6 增加会话分享存储（`conversation_shares`、`conversation_share_artifacts`）；没有生产迁移历史。

## 隔离代码执行

默认关闭。专用 Docker engine 应与其他生产负载隔离；后端持有 socket 等同拥有该 engine 管理权限，不能复用承载其他业务的 Docker socket。执行容器不会挂载该 socket、宿主目录或后端凭据。

本机 Colima 的项目共享目录已收缩为 `data/sandbox-verification`，只用于跨命名空间锁的受控临时数据；平台自带的 Colima 镜像缓存挂载保留。不共享项目根目录、`.env` 或业务数据库，不转发 SSH agent，也不改用户默认 Docker context。已以 guest root 验证后端 `.env` 和 `data/uwork.sqlite` 不可见，并再次通过跨命名空间拒绝与真实 Agent 闭环验证。

```sh
docker --context colima-uwork-backend build -f Dockerfile.sandbox -t uwork-sandbox:local .
```

本机后端配置 `SANDBOX_DOCKER_SOCKET=/Users/ljp/.colima/uwork-backend/docker.sock` 和 `SANDBOX_IMAGE=uwork-sandbox:local`；此路径为本机专用环境，不是生产通用路径。生产 Linux 容器可使用 `compose.sandbox.yaml`，先设置 `SANDBOX_HOST_SOCKET` 为专用 engine 的 Unix socket、`SANDBOX_SOCKET_GID` 为该 socket 的实际组，再以两个 compose 文件启动；不要把 socket 权限改为 world-writable。macOS 的宿主 socket 转发路径不能当作 Linux engine 上的 bind mount 路径。

管理员创建 Runtime 并指定范围；执行还要求成员有效、席位、订阅、助理入口和安全策略 `allowSandbox=true`。沙箱始终无网络；`network=false` 不阻止已明确允许的离线代码计算。执行 UID 1000 与保护 TTL 的 watchdog UID 999 分离，防止用户代码终止过期计时器。取消/超时/输出超限会停止整个 Runtime，其 tmpfs 不承诺持久化。

真实验证命令（均使用独立受控数据，自动清理自身容器）：以 `node --import tsx` 运行 `scripts/docker-smoke.ts`、`scripts/sandbox-driver-smoke.ts`、`scripts/sandbox-api-smoke.ts`、`scripts/sandbox-crash-smoke.ts`、`scripts/lease-namespace-smoke.ts`。Agent 闭环另运行 `scripts/agent-sandbox-smoke.ts`、`scripts/agent-container-smoke.ts`、`scripts/agent-crash-smoke.ts`；最后一个再设置 `UWORK_AGENT_CRASH_MODE=ready` 验证工具已完成、等待下一轮模型时的 SIGKILL。Docker context 默认 `colima-uwork-backend`，可通过 `UWORK_DOCKER_CONTEXT` 显式改到专用验证 engine；驱动脚本 socket 使用 `UWORK_SANDBOX_SOCKET`。打包镜像闭环的 engine 内 socket 默认 `/var/run/docker.sock`，可通过 `UWORK_ENGINE_SOCKET` 指定；自动确认 backend socket GID，并验证 engine ID 一致。

Agent 隔离代码默认关闭，需发布 Agent 的 sandbox 开关并同时满足模型/企业策略许可。SDK 仅使用自有 GatewayAgentModel，不使用 OpenAI 默认客户端或外部会话状态，每轮调用单独入账；SDK tracing/exporter 禁用，自动模型重试为 0。SDK 版本与锁文件固定。真实浏览器端到端验证使用独立 `uwork-verification.localhost:3002` 实例和受控 HTTP 模型，不覆盖主实例 Cookie、凭据或组织数据；验证后进程、标签页及容器均已清理。受控 MCP 工具及已配置供应商的文本、工具调用、视觉消息和思考参数已实际验证；外部 MCP、其他供应商与供应商账单对账仍待验收。

## 生产仿真与远端 CI

`npm run preflight -- --production` 只解析环境变量并以只读方式检查既有数据库，不启动服务、不取得写租约，失败返回非零退出码，输出不含主密钥、租约 owner 或凭据内容。`npm run production:simulate` 在系统临时目录用合成主密钥和合成账号执行无 Docker 的端到端编排：初始化、online backup、停止源实例、在独立目录恢复，再调用 `npm run verify:restore` 核对 schema 6、登录、vault 解密、已发布配置和账本状态；`verify:restore` 拒绝覆盖已有目标，也不修改源数据库。三条命令都不读写生产 `.env`、`data/` 或真实凭据。

远端 `Backend Verification` 的 `verify` job 在无 Docker 的 runner 上执行依赖安装、客户端 pnpm 声明构建、typecheck、lint、format、ledger、全量测试、crash smoke、build、audit，以及脚本存在时的无 Docker 生产仿真；`docker` job 只做 `docker compose config`（compose.yaml 与 compose.sandbox.yaml 叠加）和隔离临时项目名、临时 `.env`、临时数据目录下的合成 Compose 构建、init、`/health`、重启持久化与清理，使用随机合成主密钥，不读取任何 secrets。两个 job 都不推送镜像、不执行 SSH 部署、不读取 production environment。

本地 Docker/Colima、合成账号、受控 MCP、备份恢复仿真和远端 CI 结果都不能替代真实生产主机、HTTPS 域名/TLS、异地备份、真实企微 OAuth、外部 MCP 和供应商账单验收；当前没有镜像仓库、Actions secrets 和专用 Linux 沙箱 engine，这些仍是上线前的独立阻塞项。

## 外部接入

企微：在自有企业应用配置回调域名/应用可见范围，将 Secret 存入 vault，绑定成员或同步后分配席位，逐企业测试新扫码、取消、过期、重复认领和停用。

模型：创建 provider vault 凭据、配置一个模型及范围，先 probe 再真实生成，确认计量与对账。probe 成功不代表生成成功。

UWork：本仓库 `clients/uwork/` 工作区公开配置显式增加 `backend: "uwork"`，apiBaseUrl 设为部署 HTTPS origin，组织 orgId 对应后端 tenant id，回调为同源 `/api/auth/wecom/callback`。Secret/Token 不能进入公开配置。

当前托管模型使用 `enterprise-session`：Gateway 同步公开目录，CLI 经 Host 私有会话转发 JSON/SSE，后台从会话派生用户并鉴权/计量；登录 Token 和供应商 Key 不进入 CLI/Renderer/Provider 配置。旧终端 Key 在迁移成功后吊销，device API 保留兼容。该链路已通过真实 HTTPS、SDK、打包 CLI 和独立原生 Electron 联动；菜单、资产与本地安全继续复用既有 Host 所有者。后台成员页支持企微 UserId 展示和行内绑定，角色/部门/席位/状态、模型范围、限量和用量沿用原管理页。正式企微仍需自有 HTTPS 域名、应用配置与逐企业扫码验收；本机合成登录初始化不替代它。已安装发行包、远程/手机与三平台仍单独验收。详见 `docs/client-live-test-2026-10-17.md`；2026-10-15 后端整体实测保留于原报告。

2026-10-17 补充：`/api/auth/me` 增加当前租户成员映射，`/api/client/entitlement` 增加综合限制下的 `effectiveAllowance`，旧个人额度字段保留。客户端从私有 Gateway writer 更新非秘密 `enterpriseModelIds` 候选快照，实际调用权限始终由后台重新判定；公开 Provider 写入不能伪造该字段。有效额度刷新、撤权清投影和首次自动选模已完成 Native 联动复测，见 `docs/client-user-journey-test-2026-10-17.md`。当前主后端已更新，补充镜像为 `uwork-backend:user-journey-20261017`；未替换用户已安装的客户端发行包。
