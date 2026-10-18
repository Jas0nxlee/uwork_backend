# 本地后台恢复运行

2026-10-18 06:13 UTC 实测，本地后台已运行于 `http://127.0.0.1:3000/`，PID 29003，PTY session 72157；此进程为用户保留运行，不属于待关闭的临时测试进程。

原进程退出后，3000 端口不可达。恢复前已完成隔离联测、独立代码与操作计划复核，并核对十类启动副作用候选计数均为零：运行/排队任务、自动化、投递、评测、sandbox 恢复与执行、留存、reserved 账本，以及终态任务工具和连接器会话。reserved/uncertain 历史没有为恢复而改写，实例 lease 没有被强删。

普通 environment parser 在私有操作进程内读取现有配置，没有打印或复制 `.env`、Master Key、会话或凭据。通过原 readonly SQLite online backup 创建 `data/recovery-backups/recovery-8fe86f44-9cbf-4098-bdac-5d371040ad39/snapshot.sqlite`，目录 0700、文件 0600，完整性 ok，九张业务表 hash 与原基线一致。备份同时包含当前 canonical 编译文件和六个实际恢复的旧 admin 资产。

早先误覆盖静态资源后，仅六个原资产可按 SHA 精确还原，历史 `index 2.html` 原字节仍缺，未伪造。此次是经过备份的有意部署：独立 `envFile:false` 构建四个新 admin 资产，核对十个受保护来源及原已验 preview 完全一致；旧目录整体 rename 保存，专用新目录复制校验后再 rename 为正式 dist。不是宣称原七资产都恢复或从未改变。

正常 `node --env-file=.env dist/server.js` 启动成功，schema 6 的新增 sharing 表为空，九业务表仍完全匹配。实际 `/health`、根页面、JS、CSS、brand 均 200，内容 SHA/MIME 匹配；`/api/client/models` 与分享 capabilities 未登录返回 401。首个 smoke 错把 `/index.html` 当作已注册路径，得到 404；改用 Source 的真正根路由 `/` 完成核验，没有为测试增加产品路由。

06:19 UTC 另用独占 Chromium 148/browser-harness 实际访问同一根 URL。1440 和 320 两宽登录表单、JS、CSS、brand 正常，均无水平溢出；脚本异常、console error、网络加载失败和意外 HTTP 错误为零。每宽一次 `/api/auth/me` 401 是未登录合同预期，网络 error 日志按原样单列，没有把它抹成不存在。未填账号、点击企微或调用业务/模型。八个已知浏览器/驱动子进程及执行器正常终态，端口关闭、scratch 零写者后移除；主 PID/birth 保持，health 200。证据在 `evidence/main-backend-recovered-browser-20261018/`。

这证明实际访问路径、当前部署和私有接口拒绝正常，不代表再次完成了主库管理员登录、真实模型调用或真实企微验收。正常启动会使用原 Vault，并具有 schema/lease、身份过期或 Runtime 恢复等运行期写入；九表不等于全库零写。启动至 listen 不是单一事务，后续失败不会自动撤销此前所有恢复写入。

操作证据在 `evidence/main-backend-recovery-20261018/`，包括 backup/deploy 命令、四资产和十来源、新进程与 HTTP/业务表结果。有限恢复工具及检查记录在 `evidence/main-backend-recovery-tools-20261018/`；独立审核见 `evidence/main-backend-recovery-review-20261018/`。外部客户端原仓库仍保持干净。
