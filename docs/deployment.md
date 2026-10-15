# 运行、部署与恢复

## 本机

```sh
npm ci --ignore-scripts
npm run init
npm run build
npm start
```

需要 Node 24.13+（本轮 24.19.0），npm 11.12.1，依赖锁定在 package-lock.json。安装不执行依赖脚本；esbuild/rollup 使用平台可选包。首次 init 创建 32 字节主密钥和随机初始密码，不打印秘密；凭据在 `data/bootstrap-credentials.txt`（0600），数据目录 0700。重复 init 不覆盖现有用户。可在环境中提供 BOOTSTRAP_EMAIL/PASSWORD/ORGANIZATION，不写到命令行。

默认 PUBLIC_URL 为 http://localhost:3000，HOST 为 127.0.0.1。管理端与 API 同源；前端开发 `npm run admin:dev` 代理至 3000，写入 Origin 需与 PUBLIC_URL 一致，所以完整操作验证使用构建后的同源入口。

## 生产与容器

Dockerfile 为固定基础镜像摘要的多阶段构建，Compose 仅绑定 loopback 端口、只读 root、去除 capabilities，数据使用持久卷。已在独立 Colima `uwork-backend` 实例实际构建镜像，使用独立数据卷验证初始化、登录、配置发布和重启持久化；不修改用户默认 Docker context。

1. 在目标主机准备 `.env`，MASTER_KEY 为 64 位随机 hex；PUBLIC_URL 为实际 HTTPS origin。不要沿用开发实例密码/密钥。
2. 数据目录必须归运行 UID 所有；镜像 node UID/GID 为 1000，bind mount 下应提前准备权限。Linux 主机的现有用户目录不能直接假定适配容器 UID。
3. `docker compose build`；首次在可写数据目录运行 `docker compose run --rm backend node dist/cli.js init`；再 `docker compose up -d`。
4. 反向代理提供 TLS；PUBLIC_URL 必须与浏览器访问 origin 相同。不要开放管理服务的明文公网端口。
5. `/health`、实际 `/` 登录与业务调用分别验收；健康不等于上游生成、企微登录或投递成功。

单实例约束：SQLite WAL 只用于本机持久卷，禁止 NFS/共享卷和多副本写入。服务和初始化命令均须先持租约再迁移/恢复。租约使用宿主启动身份及 PID 命名空间，15 秒心跳；同命名空间检查进程存活，其他命名空间必须等待 120 秒失联才能接管，不能用本地 PID 不存在推断远端死亡。未知旧版租约必须先正常停止旧实例释放。失去租约的进程停止工作器、拒绝 HTTP 请求，写入在 SQLite 写事务内校验归属。跨宿主/容器共享临时库已验证拒绝接管且保留运行记录。扩展到多实例仍需迁移 PostgreSQL/共享工作队列并完成并发测试。

生产上游必须 HTTPS 且为公网地址；每次 DNS 检查后固定连接地址，不跟随重定向。ALLOW_PRIVATE_UPSTREAMS 仅在明确接入受控内部服务时开启，会扩大所有已授权配置的网络出口边界。

## 备份与恢复

```sh
npm run backup -- /absolute/protected/backups/uwork-snapshot.sqlite
```

使用独立只读连接调用 SQLite 在线 backup API，包含一致 WAL 状态，不迁移源数据库；以 0600 独占创建目标，已存在则拒绝覆盖。主密钥 `.env` 中的 MASTER_KEY 必须另行受保护备份，丢失后无法恢复 vault、任务和缓存密文。备份不是把运行中的 sqlite 文件单独复制一份。

恢复：先停止服务并保存当前数据快照，在新目录恢复 snapshot，保持 0600/0700 和正确 UID，用对应 MASTER_KEY 启动，验证登录、vault 解密、已发布配置和账本。快照自带旧实例租约；同命名空间旧进程已停止时可回收，跨命名空间须等待其心跳过期。未知旧版租约应在确认所有实例都已停止后由管理员离线清除，禁止在线删除。不要同时运行源实例与共享副本。备份恢复测试已使用独立临时目录执行。

升级/回滚：先备份数据库与主密钥、记录代码 commit，停止旧实例后启动新版本；失败时停止新实例并恢复对应版本的数据库快照。不能只回滚代码并假定未来 schema 可向后兼容。当前 schema 为 v5：v2 增加隔离 Runtime，v3 增加命名空间租约，v4 增加父运行取消意图、工具记录及按 run 的沙箱绑定，v5 增加 MCP 冻结版本、分派标记和父运行会话绑定；没有生产迁移历史。

## 隔离代码执行

默认关闭。专用 Docker engine 应与其他生产负载隔离；后端持有 socket 等同拥有该 engine 管理权限，不能复用承载其他业务的 Docker socket。执行容器不会挂载该 socket、宿主目录或后端凭据。

本机 Colima 的项目共享目录已收缩为 `data/sandbox-verification`，只用于跨命名空间锁的受控临时数据；平台自带的 Colima 镜像缓存挂载保留。不共享项目根目录、`.env` 或业务数据库，不转发 SSH agent，也不改用户默认 Docker context。已以 guest root 验证后端 `.env` 和 `data/uwork.sqlite` 不可见，并再次通过跨命名空间拒绝与真实 Agent 闭环验证。

```sh
docker --context colima-uwork-backend build -f Dockerfile.sandbox -t uwork-sandbox:local .
```

本机后端配置 `SANDBOX_DOCKER_SOCKET=/Users/ljp/.colima/uwork-backend/docker.sock` 和 `SANDBOX_IMAGE=uwork-sandbox:local`；此路径为本机专用环境，不是生产通用路径。生产 Linux 容器可使用 `compose.sandbox.yaml`，先设置 `SANDBOX_HOST_SOCKET` 为专用 engine 的 Unix socket、`SANDBOX_SOCKET_GID` 为该 socket 的实际组，再以两个 compose 文件启动；不要把 socket 权限改为 world-writable。macOS 的宿主 socket 转发路径不能当作 Linux engine 上的 bind mount 路径。

管理员创建 Runtime 并指定范围；执行还要求成员有效、席位、订阅、助理入口和安全策略 `allowSandbox=true`。沙箱始终无网络；`network=false` 不阻止已明确允许的离线代码计算。执行 UID 1000 与保护 TTL 的 watchdog UID 999 分离，防止用户代码终止过期计时器。取消/超时/输出超限会停止整个 Runtime，其 tmpfs 不承诺持久化。

真实验证命令（均使用独立受控数据，自动清理自身容器）：以 `node --import tsx` 运行 `scripts/docker-smoke.ts`、`scripts/sandbox-driver-smoke.ts`、`scripts/sandbox-api-smoke.ts`、`scripts/sandbox-crash-smoke.ts`、`scripts/lease-namespace-smoke.ts`。Agent 闭环另运行 `scripts/agent-sandbox-smoke.ts`、`scripts/agent-container-smoke.ts`、`scripts/agent-crash-smoke.ts`；最后一个再设置 `UWORK_AGENT_CRASH_MODE=ready` 验证工具已完成、等待下一轮模型时的 SIGKILL。Docker context 默认 `colima-uwork-backend`，可通过 `UWORK_DOCKER_CONTEXT` 显式改到专用验证 engine；驱动脚本 socket 使用 `UWORK_SANDBOX_SOCKET`。打包镜像闭环的 engine 内 socket 默认 `/var/run/docker.sock`，可通过 `UWORK_ENGINE_SOCKET` 指定；自动确认 backend socket GID，并验证 engine ID 一致。

Agent 隔离代码默认关闭，需发布 Agent 的 sandbox 开关并同时满足模型/企业策略许可。SDK 仅使用自有 GatewayAgentModel，不使用 OpenAI 默认客户端或外部会话状态，每轮调用单独入账；SDK tracing/exporter 禁用，自动模型重试为 0。SDK 版本与锁文件固定。真实浏览器端到端验证使用独立 `uwork-verification.localhost:3002` 实例和受控 HTTP 模型，不覆盖主实例 Cookie、凭据或组织数据；验证后进程、标签页及容器均已清理。MCP 工具和真实供应商生成验收仍未完成。

## 外部接入

企微：在自有企业应用配置回调域名/应用可见范围，将 Secret 存入 vault，绑定成员或同步后分配席位，逐企业测试新扫码、取消、过期、重复认领和停用。

模型：创建 provider vault 凭据、配置一个模型及范围，先 probe 再真实生成，确认计量与对账。probe 成功不代表生成成功。

UWork：适配副本 `/Users/ljp/Desktop/uwork_backend-client` 公开配置显式增加 `backend: "uwork"`，apiBaseUrl 设为部署 HTTPS origin，组织 orgId 对应后端 tenant id，回调为同源 `/api/auth/wecom/callback`。Secret/Token 不能进入公开配置。

当前身份、模型、终端凭据和 Credit 用量服务适配通过实际源码合同联调；菜单、资产与路径/命令等本地安全 enforcement 已接入既有 Host 所有者，并通过实际源码/stdio 合同测试。已安装桌面客户端、远程工作区与三平台仍需实际验收，不能由源码联调代替。后端 `UWorkBackendClient` 提供这些端口合同，不新增 Renderer 身份所有者。2026-10-15 后端整体实测另见 `docs/backend-system-test-2026-10-15.md`。
