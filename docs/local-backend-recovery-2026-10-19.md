# 本地后台恢复运行（2026-10-19）

19:12（北京时间）已恢复正常后台，地址为 `http://127.0.0.1:3000/`。新进程 PID 59926、PPID 1，启动时间 `Mon Oct 19 19:12:26 2026`，工作目录及数据库绑定到本仓库，监听 `127.0.0.1:3000`。它与客户端联测的独立后台分开。

此前的 PID 42125 已不存在，两个 loopback 的 3000 端口均拒连。恢复前对数据库及存在的 WAL/SHM 作严格零 FD 检查，十三类任务、自动化、投递、评测、沙箱、保留、账本和到期分享候选均为 0。使用现有环境解析器私下核验数据库、地址和端口，没有打印配置或凭据，也没有手改配置或实例 lease。

只读 online backup 已保存到 `data/recovery-backups/recovery-20261019-d1b66be4-f1aa-47ee-8ebb-a380e9deb50f/snapshot.sqlite`，目录 0700、文件 0600，581,632 字节，完整性通过，九张当前业务表与备份一致。旧基线中的两张配置表漂移没有回滚或改写。

后端按原 `build:server` 命令编译通过，随后使用 Node 24 和原 `.env` 正常启动 `dist/server.js`，stdin 为 DEVNULL，日志保存在新的 0700 私有运行目录。未重建管理端或客户端产物，未执行主库管理员登录、模型请求、真实企微、MCP 或网盘操作。正常启动仍包含产品自身的 schema、lease 和运行期生命周期写入，不称全库零写。

19:12:51 的独立核验确认：九张业务表均匹配本次恢复前备份，四个管理端资产 SHA 未变；首页、JS、CSS、品牌资源及 `/health` 均为 200；匿名 `/api/auth/me`、`/api/client/models`、`/api/client/shares/capabilities` 均按合同返回 401。这里只验收运行与实际访问路径，不把它当作主库登录或模型调用的重复验收。

收据：[基础预检](../evidence/client-post-g04j-boundary-audit-20261019/main-recovery-readonly-preflight.json)、[补充预检](../evidence/client-post-g04j-boundary-audit-20261019/main-recovery-additional-preflight.json)、[当前备份](../evidence/client-post-g04j-boundary-audit-20261019/main-recovery-current-backup.json)、[启动记录](../evidence/client-post-g04j-boundary-audit-20261019/main-restored-start.json)、[独立复核](../evidence/client-post-g04j-boundary-audit-20261019/main-restored-current-verification.json)。
