# 原 Native Read 在真实 OS 等待期间撤权

Linux 原安装包的真实 Read 等待→撤销 filesystem→结果正文扣留，以及相同机制允许态对照均已通过。最终v3六项检查、同原CLI两次真实内核等待、五条本人settled与完整资源收尾通过；没有产品代码修改。

## 实际路径与边界

固定原 `uwork-linux-desktop-installed:20261020-v4-async`、image ID `sha256:7615e2f3dca262a77a0936d8bdc776019764d11504962ca18d6cf6e4103b3cf3`，实际app.asar为 `4f716c13f57315ab5992a6ba1b831ee2665dc6ab2db8e0eda0d3e65ddbac5034`。原Renderer/Main/Host/包内CLI/Read及私有授权RPC均未替换。

沿已有隔离fixture：真实SQLite/HTTP/HTTPS、普通member及加密identity store；初始化用本地email会话桥，不冒称真实企微授权。受控本地供应商保留全部生产工具定义，仅各发一次正式 `Read(file_path)` tool call，再原样观察原CLI后继请求中的tool result，保存大小/SHA与具体拒绝码，不保存文件正文或凭据。原composer输入、Send、Settings/Skills/Back均由browser-harness在自有Electron CDP操作，没有调用假的Host授权或注入React状态。

新独立prepare通过单锚点esbuild变换扩展原fixture supplier与控制端；共享backend/probe、Main、Read及Host源码不改。目标文件位于本轮UID1000独占 `/work/project` tmpfs下的 `.pending-read`（已加入.gitignore），是普通文件，不是FIFO/FUSE或替换的FS端口。helper和原CLI均UID/GID1000、CapEff=0；没有增加cap或调大内核lease超时。

## v3真实证据顺序

| 阶段                 | 观测                                                                                                                                                                                                                                                             |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 拒绝组普通文件       | helper PID185、inode37/dev60持write lease；原供应商先交付唯一Read call `owned-pending-read-deny`                                                                                                                                                                 |
| 原CLI已在OS await    | 原生产spawn日志、包内exe及cwd绑定CLI PID167；其worker TID178的wchan=`__break_lease`，holder收到SIGIO，尚未释放，后继模型没有文件marker；没有其他本轮进程同样等待lease                                                                                            |
| 原后台撤权           | 原security GET→PUT，以草稿revision3提交publish为false；原发布响应摘要对应version2/revision4。不改身份、member状态或席位                                                                                                                                          |
| 原客户端消费false    | 原task-settings-button→Skills，私有member会话的真实authorize200返回allowFilesystem=false；原界面出现“企业已限制文件访问，无法读取或修改技能”；随后原Back返回任务，再解除lease                                                                                    |
| 原OS读恢复与结果扣留 | SIGIO后1,323ms显式F_UNLCK；原CLI读完成，before_result返回 `Read completed; content withheld (enterprise_filesystem_denied)`；63字节、SHA `bc32d2eb631a2e0f071554697faefac7ff612e895da72ca02ddf0c3399488bc6` 与原executor固定模板精确一致，后继供应商无文件marker |
| 允许组对照           | 原publish恢复true并经原Skills UI消费；全新inode38/新call `owned-pending-read-allow`，同CLI PID167/worker177实际再次\_\_break_lease；SIGIO后59ms显式unlock，49字节真实Read结果含该文件marker进入后继供应商                                                        |
| 迟到允许不回灌       | 恢复true和允许组后，所有后继请求仍没有前一拒绝文件marker；没有重放旧Read结果。这里不声称以后显式重读该文件也应被永久禁止                                                                                                                                         |

Skills UI的真实false收据是当前私有Host已消费新后台权限的可观察barrier，**不把它单独等同为Read内部某个缓存已更新**。Read本身使用 `uworkToolAuthorization` 当前backend scope重新POST authorize；本轮另记录OS释放后、供应商收到工具结果前的原授权收据，并由原before_result固定模板的完整SHA确认“Read已执行完成、结果被扣留”，排除仅在调度前拒绝、取消、退出或进程崩溃。

原错误后任务仍正常生成最终回复；允许态同一实现成功交付正文。SQLite离线只读复核普通member仍active/seat=true，五请求键各一条settled、五Trace，合计110 Credit、60 input/50 output Token；供应商认证拒绝0。这是本地受控供应商返回用量经真实后台结算，不冒称外部付费模型用量。拒绝组含原标题请求共3条/66 Credit；允许组再2条/44 Credit，不将一次UI发送错误写成“一次模型调用”。

## 收尾与证据

v3整体16.27秒。两个helper均显式release、closed、exit0，原Desktop exit0；backend原shutdown成功，容器与独立internal网络不存在，两个宿主转发端口关闭，SSH/BH的已知宿主PID不存在，私有BH socket关闭。project tmpfs随容器销毁。挂载工作根/随机合成账号数据库保留为私有证据，没有声称整个证据目录已删除。

- [最终结果](../evidence/client-linux-pending-read-native-v3-20261020/result.json)：六项检查、真实动作、按阶段权限收据、CLI/worker/lease、供应商结果大小/哈希及收尾。
- [离线独核](../evidence/client-linux-pending-read-native-v3-20261020/independent-verdict.json)：完整before_result错误模板精确匹配、原CLI两次等待、发布/消费/释放时序、SQLite五唯一请求键/五Trace、仍active/有席位、资源absence。
- [独立peer复核v1](../evidence/client-linux-pending-read-peer-verdict-20261020.json)：另一agent只读核对同机制、原executor源码/包内CLI哈希链、63字节模板及资源收尾；没有替代v3本轮独核。
- 同v3目录 `pending-read-final-state.json`、`backend-final-proof.json`、`harness-cleanup.json`、`final-ui.png`、`preparation.json`。
- 新脚本 `scripts/tests/linux-desktop/pending-read-{prepare.mjs,probe.py,lease.py}`；目标JS Lint/格式、Python编译及prepare-only通过。无产品改动，不重建安装包。

历史保留：v1同机制六项通过，但controller从Gateway薄驱动复制的mode/boundary文案误标且带无效expiry选项；prepare没有消费该多余参数、实际没有身份到期流程，不能按其旧文案理解业务。补具体错误码/handlerCompleted字段时，v2在创建GUI/容器前遇到残留mode变量NameError，仅属测试驱动问题；v3清掉残留字段并实际通过。旧记录不覆盖。

复跑须新profile，且由Root安排唯一GUI窗口：

```sh
python3 scripts/tests/linux-desktop/pending-read-probe.py \
  --name client-linux-pending-read-new-20261020 \
  --image uwork-linux-desktop-installed:20261020-v4-async \
  --expected-asar-sha256 4f716c13f57315ab5992a6ba1b831ee2665dc6ab2db8e0eda0d3e65ddbac5034
```

仅准备可加 `--prepare-only`，不启动GUI或容器。结果限定该原Linux包的具名Native等待/撤权切片，不替代macOS/Windows、全部Read竞态或受审Go/actor正式流程；真实企微浏览器安全拒绝保持，外部MCP/网盘仍排除。
