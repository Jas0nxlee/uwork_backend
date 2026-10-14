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

Dockerfile 为多阶段构建，Compose 仅绑定 loopback 端口、只读 root、去除 capabilities，数据使用持久卷。**本轮本机 Docker daemon 不可用，镜像构建/启动未执行。**

1. 在目标主机准备 `.env`，MASTER_KEY 为 64 位随机 hex；PUBLIC_URL 为实际 HTTPS origin。不要沿用开发实例密码/密钥。
2. 数据目录必须归运行 UID 所有；镜像 node UID/GID 为 1000，bind mount 下应提前准备权限。Linux 主机的现有用户目录不能直接假定适配容器 UID。
3. `docker compose build`；首次在可写数据目录运行 `docker compose run --rm backend node dist/cli.js init`；再 `docker compose up -d`。
4. 反向代理提供 TLS；PUBLIC_URL 必须与浏览器访问 origin 相同。不要开放管理服务的明文公网端口。
5. `/health`、实际 `/` 登录与业务调用分别验收；健康不等于上游生成、企微登录或投递成功。

单实例约束：SQLite WAL 只用于本机持久卷，禁止 NFS/共享卷和多副本写入。数据库实例租约在进程存活时拒绝第二个 worker，防止第二个启动恢复程序修改仍在运行的任务。扩展到多实例需迁移 PostgreSQL/共享工作队列并完成并发测试。

生产上游必须 HTTPS 且为公网地址；每次 DNS 检查后固定连接地址，不跟随重定向。ALLOW_PRIVATE_UPSTREAMS 仅在明确接入受控内部服务时开启，会扩大所有已授权配置的网络出口边界。

## 备份与恢复

```sh
npm run backup -- /absolute/protected/backups/uwork-snapshot.sqlite
```

使用 SQLite 在线 backup API，包含一致 WAL 状态；目标已存在则拒绝覆盖。主密钥 `.env` 中的 MASTER_KEY 必须另行受保护备份，丢失后无法恢复 vault、任务和缓存密文。备份不是把运行中的 sqlite 文件单独复制一份。

恢复：先停止服务并保存当前数据快照，在新目录恢复 snapshot，保持 0600/0700 和正确 UID，用对应 MASTER_KEY 启动，验证登录、vault 解密、已发布配置和账本。快照自带旧实例租约；若原进程已停止，启动会回收。不要同时运行源实例与共享副本。备份恢复测试已使用独立临时目录执行。

升级/回滚：先备份数据库与主密钥、记录代码 commit，停止旧实例后启动新版本；失败时停止新实例并恢复对应版本的数据库快照。不能只回滚代码并假定未来 schema 可向后兼容。当前 schema 为初始 v1，无生产迁移历史。

## 外部接入

企微：在自有企业应用配置回调域名/应用可见范围，将 Secret 存入 vault，绑定成员或同步后分配席位，逐企业测试新扫码、取消、过期、重复认领和停用。

模型：创建 provider vault 凭据、配置一个模型及范围，先 probe 再真实生成，确认计量与对账。probe 成功不代表生成成功。

UWork：适配副本 `/Users/ljp/Desktop/uwork_backend-client` 公开配置显式增加 `backend: "uwork"`，apiBaseUrl 设为部署 HTTPS origin，组织 orgId 对应后端 tenant id，回调为同源 `/api/auth/wecom/callback`。Secret/Token 不能进入公开配置。

当前身份、模型、终端凭据和 Credit 用量服务适配通过实际源码合同联调；菜单/资产与路径/命令等本地安全 enforcement 仍需接入现有 Host 所有者并进行真实桌面验收。后端 `UWorkBackendClient` 提供这些端口合同，不新增 Renderer 身份所有者。
