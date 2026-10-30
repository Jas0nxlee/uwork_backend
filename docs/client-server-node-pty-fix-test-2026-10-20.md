# Server node-pty 一致性修复与验证

当前已完成生产源修复、完整门禁/独立审查、锁安装与两种正常原Server归档及逐成员hash读回；macOS ARM64原SDK本地PTY/resize/update完整链已真实通过；Linux ARM64在原生私有volume中完成新包首次/旧包已知ABI拒绝/原更新回新包完整对照；旧Mac bind轮次失败仍原样保留。49项单位/打包fixture检查与正常产包仍独立列示。原3b50 Linux真实模块RED、旧新Darwin模块GREEN保留在[前置审计](client-server-node-pty-abi-audit-2026-10-20.md)。

## 原行为RED

先新增[规格](../clients/uwork/specs/server-node-pty-native-compatibility.md)和新原producer测试，再运行未改的source，四项全部RED：Server未精确pin1.1；Agent忽略flat1.1并保留旧Beta目标；prepare-prebuilds按文件存在skip旧缓存；Server stage硬找nested导致官方flat1.1 ENOENT。原源码通过esbuild装进私有临时fixture，只对原private copy函数增加测试可见性，函数算法/main guard不替换，不执行remote main或任何provider/模型。[原RED日志](../evidence/client-server-node-pty-producers-red-20261020.log)。初始路径/TS loader设施失败单列，不充当该四项RED。

## 唯一事实源与原writer

根`scripts/node-pty-prebuild-assets.mjs`与声明提供只读canonical计划：显式JS/native两个包root+目标，核名称、非空精确同版、os/cpu、ELF64 little-endian machine或Darwin64 Mach-O CPU，唯一flat/nested布局；Darwin helper必须同布局存在且架构正确。计划不复制、不运行native、不保存缓存。保留Desktop构建入口同步合同，其余异步producer仍用原异步复制API。

三个现有writer保持职责：Server stage每次按匹配计划更新目标，不再接受已有native即成功；Agent先核四组再写自己的stage；prepare先核四组，重建自己的平台缓存，并从同一验证函数取得组件semanticPrefix，原content hash按最终字节生成。Darwin helper落盘0755。Windows原路径/Terminal API/第三方源码/远端authority/原cdf Agent均不改。

Server JS及四平台声明精确1.1；Root已统一完成lock-only与frozen install，两步0且scripts disabled，实际Desktop3/Server5解析均1.1。Desktop既有helper转调用共同解析器，非Linuxskip不变。原24测试中前23未改，最后历史“ServerBeta隔离”按新需求改为更强的JS及四native均1.1；旧24绿色日志和1a8历史source保留，没有删测试或放宽门槛。旧Desktop规格也注明Server独立后续，不再把Beta描述成当前事实。

## 已执行结果

格式后49/49通过：25个新增检查+原Desktop24。覆盖四平台flat计划、三个原producer、旧Beta已存在target强制更新、Darwin同源helper及只改目标执行权限、名称/版本/os/cpu/架构/双布局拒绝、Agent和remote全组失败不半写、重建旧cache额外文件、组件v1.1.0+真实新sourceSha、Server失败不产生成功manifest。相关fixture只有受控文件，不执行伪native或把它们当真实ABI测试。[49项原日志](../evidence/client-server-node-pty-formatted-green-20261020.log)。扩展测试初次误用了旧版本格式假设，原失败单列；改为既有v1.1.0+hash合同，未改产品格式求绿。

workspace freshness/architecture pre/context/post均0；context报告该目录未管理，未增加runtime跨模块依赖。目标文件oxfmt与diff whitespace通过。Root统一typecheck/lint/architecture/unit全部0、49/49、lint114warnings/0error，12source前后SHA相同；独立peer无must-fix，deep YAML独核仅Server五项importer声明、四Beta移除与两Darwin1.1加入，其余Desktop/CDF严格相同。源11文件SHA已[冻结](../evidence/client-server-node-pty-fix-source-freeze-20261020.json)。Root已按最终12文件原子提交`a1a924fc995d9497cebc1a0262e5842c6e01bed9`。

专用回归入口（Node24）：

```sh
node --test clients/uwork/scripts/test/server-node-pty-assets.test.mjs clients/uwork/packages/desktop/test/nodePtyPackageVersion.test.mjs
```

生产源修复/门禁阶段未触真实主backend/生产主库，未启动新Server/GUI或发送供应商调用。下述实际SDK阶段仅使用自有Core/私有根、本地归档catalog；不把模块探针替代真实终端。

## Root 独立门禁与原正常producer

[Root质量汇总](../evidence/client-server-node-pty-fix-20261020/quality-result.json)、[锁隔离](../evidence/client-server-node-pty-fix-20261020/root-lock-isolation-verdict.json)、[实际依赖](../evidence/client-server-node-pty-fix-20261020/effective-dependencies.json)、[独立peer](../evidence/client-server-node-pty-linux-sandbox-static-peer-20261020.json)、[Root五轴审核](../evidence/client-server-node-pty-fix-20261020/root-review.json)。没有因隔离实际install而执行第三方生命周期脚本；原cdf仍不变。

在Root授权host窗口，仅正常`pnpm --filter @zcode/server-cli build`一次，然后顺序原`pnpm exec tsx packages/zcode-server-cli/src/packaging/stageCli.ts --target <target> --skip-agent-build`，均0。各target完成立即冻结到独立Library/Caches子目录后才生产下一个，避免共享.components writer冲突，未读取/改写Desktop out或sealed1a8候选。

| 原新包       |     字节 | SHA256                                                           |
| ------------ | -------: | ---------------------------------------------------------------- |
| Darwin ARM64 | 68020819 | 4665dc6b284f5eaf12aadb1d05f260025a330357b26baa9139e0fdb0c2dc8d57 |
| Linux ARM64  | 78212232 | f55dbc60c412a735a05fb3be4c10beb5d8f858a16eef0127a51e2371744eae89 |

原tar实际成员逐hash与冻结树相同，manifest仍各自正确target/3.16.0，原JS1.1/公开三参，Darwin native128593...0811及Linux nativec192e5...b75b分别与原registry1.1精确相同；Darwin同目录helper0755。实际Agent均cdf，旧1d3/3b50归档和12个source/lock前后全等。[正常命令/产物](../evidence/client-server-node-pty-release-a1a924fc-20261020/producer-result.json)、[成员读回](../evidence/client-server-node-pty-release-a1a924fc-20261020/archive-readback.json)、[Root独立原tar读回](../evidence/client-server-node-pty-release-a1a924fc-20261020/root-archive-readback.json)。不把正常包SHA差异写成真实跨版本升级。

正常producer阶段没有启动SDK/Core/PTY、GUI或容器。随后Root已授权下述原本地SDK实际链路；不发送任何Provider/model命令。

## 原本地 SDK / update 实际链路

新增薄派生入口 `scripts/tests/run-server-local-pty-update.py` 和 Terminal slice：直接复用原 `server-update-stateful-probe.mjs` 的 HTTP catalog、CLI/ready、真实 `connectViaWebSocket`、endpoint 与清理段，只替换不属于本轮的 Provider/Task 业务段。七项 Core exec 环境字段和 SDK `systemService.info().homedir` 在任何 File/Setting/Terminal 写入前校验；首次启动仅接受精确 bootstrap native 路径，更新后仅接受私有 releases 路径，读取实际 Core 已映射 native 字节 SHA。没有改 current/pending 或业务 DB。

Darwin v5 原 NEW4665 → 原 update OLD1d3 → 原 update NEW4665，三段各实际 public SDK `create/onDynamicData/resize/write/dispose`，shell 内 `stty size` 得到 37×91 和 44×113。每段终端 ID、shell PID、TTY、cwd 不变，OS lsof 独立核 cwd/tty，dispose 后 shell 消失。两次原更新自然关闭旧 SDK socket、换 Core，原 File ignore 字节和 Setting locale/terminalInheritSystemProfile 保留。各阶段 7 环境字段/SDK 根一致；新 native128593…0811、旧 nativee6457d…fc9a 实际映射 SHA 正确。原 stop 后12秒仍 stopped，原 uninstall 双 DELETE 且 exit0。总6项检查，7 PID/4 port/control socket 全闭，HTTP收据恰两 catalog+两原归档，零 inference。

[Darwin实际结果](../evidence/client-server-local-pty-darwin-v5-20261020/result.json)、[冻结输入/源与路径守卫](../evidence/client-server-local-pty-darwin-v5-20261020/preparation.json)、[控制器](../evidence/client-server-local-pty-darwin-v5-20261020/controller-result.json)。这是同版3.16.0构建替换，不宣跨版本升级；每段先dispose再update，不宣活跃PTY迁移。CLI使用原跳过服务注册环境，因此本轮不重复宣launchd服务验收。

设施失败均保留whole FAILED：Darwin v1归档路径漏runtime（未启Core），v2顺序替换导致launcher ENOENT（未启Core），v3初始native误要求releases导致停止，v4三段真实PTY/持久化均过但uninstall双prompt同行JSON解析为undefined。后三轮都有实际清理记录；v4原双确认和卸载exit0不被改称whole PASS。v5仅修自有fixture的精确初始路径/专用uninstall parser，并先离线验证实际生成parser的prompt同行JSON及普通updateJSON；实际lstat检查launcher/runtime/native/metadata、Node --check通过后才启动。

Linux v1 新包真实两次stty、原更新旧3b50及File/Setting保留已过，旧ABI实际拒绝后fixture误写includes数字5（原完整Usage没有数字5），因此whole FAILED并收口，未完成回新包。v2仅将其改为原完整 `Usage: pty.resize(fd, cols, rows, xPixel, yPixel)` 签名，先用原历史RED回执离线验证；容器absence改复用已有exact Docker inspector，移除前核独有name/image/entry/cmd/UID/3mount/cap0/NNP/netnone/1GiB/CPU1，未知错误不能算已闭。Linux v2新包初始SDK两次stty通过，原update旧包在真实GNU tar `Cannot utime: Operation not permitted` 退出1，未到旧ABI对照/更新回新包。工作目录为Mac bind、实际UID1000，当前不能把这次错误归因为产品或直接改归档/校验绕过。完整错误保留原result，并有[去重摘要](../evidence/client-server-local-pty-linux-v2-20261020/failure-summary.json)。3PID/2port/socket闭合；cleanup实核精确容器身份/配置/mount后移除，并由既有exact inspector确认absence，driver与两归档SHA前后相同。专用VM窗口已释放。后续若换VM原生私有volume只属于隔离设施变化，需明确保留本轮失败，不算同条件复跑成功。

可重现入口（必须新name；拒绝重跑已执行case）：

```sh
python3 scripts/tests/run-server-local-pty-update.py --target darwin-arm64 --name client-server-local-pty-darwin-<fresh> --run
python3 scripts/tests/run-server-local-pty-update.py --target linux-arm64 --name client-server-local-pty-linux-<fresh> --run
```

不带 `--run` 只准备；可用相同name加 `--execute-prepared` 核原controller/slice/driver/归档SHA后执行一次。Linux输入复制到workspace自有data目录后readonly bind；不是把Library/Caches路径假定为VM共享。全部仅local authority，未执行Provider/model/AgentTask/remote。

### Linux 原生 volume 完整对照与收尾

Root另行批准一次明确设施差异：自有 local volume 带 owner/case labels、volume-nocopy，root cap0/NNP/netnone/read-only 辅助容器只chmod空volume根0777；随后UID1000原Node fs mkdir/utime自测exit0，才开始原完整case。实际业务全程UID1000、cap0、NNP、netnone、1GiB/CPU1，原归档/Node/API/tar flags不变，readonly source/bootstrap bind。不是提升业务权限或剥归档xattrs求绿。

Linux v3完整6项通过：NEW f55d/c192首次public resize→实际stty37×91与44×113；原update OLD3b50/d831，原公开SDK实际返回精确 `Error: Usage: pty.resize(fd, cols, rows, xPixel, yPixel)`，清楚列为历史已知RED；dispose后原update回NEW f55d/c192，两尺寸真实恢复。两次File/Setting保留、三Core七环境字段与SDK私有根、实际mapped native SHA、每段原shell identity和dispose后PID关闭均实收。原stop后12秒stopped、双DELETE卸载exit0。7PID/4port/socket全闭，无OOM，恰4个catalog/archive HTTP请求，零inference。

主case原result已先docker cp到evidence（`volume-result.json`与`result.json`相同）；原run.log/per-CLI stderr保留。原uninstall完成后尝试copy `/work/server/logs` 得不存在exit1，收据如实保留，不声称这份Core日志已取得。此非业务断言，也没有用缺日志遮盖错误。随后实际inspect核容器exact ID/name/image/entry/cmd/user/只读两bind+唯一volume、限制/安全参数，才remove；辅助容器同样核entry/cmd/mount后移除。最后volume标签/Driver再次核验、无任何consumer后remove，exact inspector证明所有owned容器/volume absence。没有network对象/其他VM资源创建，专用VM窗口已释放，不再操作VM。

[Linux实际结果](../evidence/client-server-local-pty-linux-v3-20261020/result.json)、[冻结输入/路径](../evidence/client-server-local-pty-linux-v3-20261020/preparation.json)、[原result拷贝](../evidence/client-server-local-pty-linux-v3-20261020/volume-result.json)、[容器/volume完整收据](../evidence/client-server-local-pty-linux-v3-20261020/controller-result.json)、[两平台离线自核与12源稳定](../evidence/client-server-local-pty-update-self-verdict-20261020.json)。后者是执行者自核，非独立peer。此轮通过不解释或关闭v2 Mac bind utime根因。

Linux原生volume入口须另加 `--linux-native-volume`；旧默认bind模式仍保留可复现失败，不暗改历史输入。所有生产12源/lock与Root门禁后SHA保持相同；本轮仅新增两个测试文件与本报告，未再改产品源。

### Root 独立验收及驱动质量收尾

Root 已对实际结果再独核：[Darwin 13项](../evidence/client-server-local-pty-darwin-v5-20261020/root-independent-verdict.json)、[Linux 17项](../evidence/client-server-local-pty-linux-v3-20261020/root-independent-verdict.json)，包括当前精确PID/port关闭、Linux exact container/volume absence，均通过。当前实际验收为本地两平台6+6，Linux历史旧ABI拒绝属于明确对照，并非原旧包无错误。

为避免将构建片段冒作可执行ESM，当前片段改名为 `server-local-pty-update-slice.mjs.tpl`，preparer只从一个SLICE路径常量读取；历史case input、sourceSHA与evidence里的旧源快照不改。Python经Black25.1.0格式化，AST与旧源仅明确模板路径常量变化后严格等价；模板经Prettier格式化，追加临时语法闭合后的esbuild normalized代码前后相等。该临时闭合仅用于模板语法/格式验证，实际生成仍复用原controller cleanup，不重写事务。新fresh prepare-only v6正常bundle及Node --check通过，没有重跑Core/PTY/业务或VM。

真实Root `npm run typecheck` exit0。首次完整 `npm run lint` exit1，10项错误如实保留：旧clock preload CJS require2、distro observer CJS require1、distro拼接片段未使用声明2、原invalid-FD CJS require5。没有忽略或放宽规则来隐藏错误，待协调历史文件owner的合规收尾。新增两driver的Python语法/Black check、模板补闭合Node syntax/Prettier check、实际生成driver Node --check均0；生产12源/lock SHA仍相同。[质量收据](../evidence/client-server-local-pty-driver-quality-20261020/quality-result.json)、[Root类型日志](../evidence/client-server-local-pty-driver-quality-20261020/root-typecheck.log)、[Root原Lint红色日志](../evidence/client-server-local-pty-driver-quality-20261020/root-lint.log)。

### 历史10项 Lint 根因收尾：真实 ESM 迁移

Root随后明确授予四个历史fixture的源/调用者owner。已将clock preload、distro reload observer、invalidFD探针从CJS真实迁移为ESM，usage拼接片段改为明确 `.mjs.tpl`，一次同步全部live引用。preload静态fs/crypto import并由原NODE_OPTIONS `--import /input/clock-preload.mjs`预载；observer原node -e调用显式增加 `--input-type=module`，其roles仍取argv[1]、立即一次+每秒采样不变。invalidFD用静态builtin import、标准dynamic import原UnixTerminal和其原utils导出的同一native loader；没有module.require/createRequire绕法或自建addon loader。所有旧input、sealed snapshot和历史CJS证据均未改。

新增9项永久contract在原归档Node22.16.0和Node24.14.0真实执行：两版本均证实预加载先于CJS entry改Date/拦stdout，在原ready帧返回前恢复；wrong entry不触发、坏SHA在entry前拒绝；observer原-e argv1、绑定role/birth及真实一秒timer正常；原Darwin无效FD ABI断言不变且无PTY/命令child。clock/observer测试私有副本仅映射元数据/输出或proc/cgroup路径至自有fixture，未把模拟proc当Linux GUI观测。首轮4失败是Mac测试tmpdir `/var` 与真实 `/private/var` 的路径不等，保留日志后仅canonicalize测试目录，原exact realpath guard未放宽。最终9/9。

移除import风格差异后，clock和observer原body经esbuild normalized比较严格相同，usage模板字节不变；正常新prepare-only v7生成/bundle/Node --check通过。Root真实 `npm run typecheck`、完整 `npm run lint`（最终格式后再核）全部exit0，不增加suppression或修改规则。针对ESM的Prettier/Node语法、Python compile、主preparer Black check通过；原生产12源/lock仍SHA全同。本阶段没有VM/GUI或原SDK业务重跑。

[9项GREEN](../evidence/client-test-fixture-esm-quality-20261020/contracts-green.log)、[原首轮失败](../evidence/client-test-fixture-esm-quality-20261020/contracts-first.log)、[body/模板等价](../evidence/client-test-fixture-esm-quality-20261020/body-equivalence.json)、[Root类型检查0](../evidence/client-test-fixture-esm-quality-20261020/root-typecheck-green.log)、[Root最终完整Lint0](../evidence/client-test-fixture-esm-quality-20261020/root-lint-final-green.log)、[汇总与当前源SHA](../evidence/client-test-fixture-esm-quality-20261020/quality-result.json)。先前10errors红日志原样保留，未回写成绿色。
