# R05 已注册 Linux 用户服务 update：准备计划

状态为 **只读审计与输入准备完成，实际 update 未运行**。没有联系 VM、启动服务/容器/HTTP server、改 unit 或产品状态。准备回执为 `evidence/client-linux-systemd-update-plan-v2-20261020/preparation.json`；不是可执行服务驱动已经完成的声明。

## 已有证据与真实缺口

`client-linux-systemd-user-v2-20261020` 原七项证明专用 VM 的 PID1=systemd、UID501 用户 manager=running 下，原3b50包真实注册、重复daemon幂等、SDK File/Setting、restart、stop12秒、双确认uninstall及资源闭合。其原结果与peer均保留；没有调用 update、catalog 或 Terminal。当前 NEW/OLD/NEW SDK 6项虽实测更新/PTY，明确使用 service registration opt-out，不能替代已注册服务更新。

普通 `linux-server-release-probe.mjs` 同样显式设置 opt-out；`run-linux-server-release.py` 还复用历史已编译 driver，不会因修改源码自动取得新的编译字节。其旧 sentinelRpc 的 HOME 断言也不能冒作当前 Core profile 隔离合同。因此本轮应薄派生现有 **linux-user-service-probe.py + linux-user-service-sdk.mjs**，不扩展 Docker release runner 去模拟 user manager。

## 原产品路径依据

原 `serve --daemon` 写稳定 root/bin launcher和本轮hash label descriptor，再原 `systemctl --user daemon-reload` / `enable --now <descriptor>`。unit ExecStart 是稳定 root/bin/zcode 加原 `serve --supervisor --service-entry --server-root`，Restart=on-failure。应保持正常用户的 HOME、XDG_RUNTIME_DIR/DBus 会话及原 manager；不能设置 skip-registration、修改 manager 全局环境或手写 unit。

原 update 的 catalog URL在 **调用 update 的 CLI** 中由 prepareOnlineUpdate读取；因此私有 loopback catalog 只需放进该 CLI 的局部环境，不能为此给 unit/global manager注入环境。CLI真实准备候选、原Supervisor applyUpdate完成stopCore→原事务current→新Core ready；Supervisor不因成功update退出。故应观察新Core PID/generation、原unit仍active/registered、同一Supervisor MainPID/birth，不误要求整个systemd MainPID更新。稳定launcher按current选择release，unit无需改写。此最小切片不宣未来登录/manager重新拉起或新Supervisor二进制已实跑。

## 输入与复用边界

| 输入            | 原归档 SHA256                                                    | 原 native SHA256                                                 |
| --------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| OLD Linux3.16.0 | 3b50dc19d24183435fa02fcb379f264642920172fe5276b675eb3c96b2843361 | d8314caa682827c0bcab6a7a2ef121a17065605e830d5eac55de3245333b3ad8 |
| NEW Linux3.16.0 | f55dbc60c412a735a05fb3be4c10beb5d8f858a16eef0127a51e2371744eae89 | c192e560428e778842fdbbe72f14032824b03373ed49ad3efcdbcf9eb249b75b |

自有workspace input已逐归档SHA复制并读取真实tar manifest、launcher、Node、CLI/Core、Agent和native成员；两包Agent仍同cdf，不重建或改字节。源controller/SDK及原产品路径源已按SHA只读快照。OLD原native五参拒绝此前实收，不能在此称OLD新PTY正例；本轮只在NEW启动真实终端。

可复用原controller的 unit/descriptor归属、CLI、SDK调用、12秒stop和双确认uninstall；只把原restart段替为局部catalog + 原CLI update、新Core等待和更新后unit复验。SDK沿原公共 connectViaWebSocket/File/Setting 扩展新PTY切片。可复用已有Terminal slice的公开方法/stty机制，但其Docker UID1000断言不能原样用于这里：必须读实际VM正常UID501并在真实shell OS身份上核对；映射native路径也必须指向新current release。原成功snapshot不可改。

## 最小实际步骤（待资源窗口与派生驱动）

1. 只读核真实PID1、UID501、user manager running；新VM原生 `/tmp/uwsysd-*` scratch mode0700，精确hash label不存在。禁止Docker/systemctl shim、VM生命周期动作、操作其他unit。
2. OLD3b50原launcher serve --daemon真实注册，ready/serviceRegistered=true；同时核descriptor内容、正常用户unit symlink的realpath、原ExecStart、MainPID/Supervisor/Core birth/exe/PPid与本root。
3. 实际Core七profile字段（含ZCODE_SERVER_ROOT）和SDK homedir在写入前均为本root。原SDK seed私有workspace ignore及locale/terminalInheritSystemProfile，先回读。不直写设置或DB。
4. VM内127.0.0.1临时端口仅提供原catalog/new归档；原update CLI局部manifest URL，保原size/SHA/schema/target检查、无force。记录原JSON/下载请求；预期一次catalog和一次新归档，禁止供应商路由。
5. 原旧SDK socket自然关闭，Core新PID/generation、serviceRegistered仍true。复核unit active/running、相同Supervisor MainPID/birth、FragmentPath realpath/ExecStart/ControlGroup；只读current的f55d身份，新Core运行路径与后续已映射native必须是本轮release/c192。
6. 原SDK reconnect，文件字节与Setting保留。NEW public create/onDynamicData/resize/write/dispose，两次真实shell stty得到37×91及44×113；同终端/shellPID/TTY/cwd、实际UID501和本轮root，dispose后shell消失。不宣活PTY迁移。
7. 原stop，实际等12秒后仍stopped/unit inactive/MainPID0、原进程不重拉。原双DELETE uninstall自然exit0；精确descriptor、unit、control socket及正常用户目录直接/wants两链接都消失（用lexists防悬空链接遗漏），全部owned PID birth/port/catalog闭合。
8. 先记录原保留 `.uwork` 和设置digest。另行归属守卫通过才清本轮scratch，不把测试清理误写为产品卸载删除数据。失败保原case，不盲重试。

## 环境能力与限制必须实收

前v2 **没有保存capability/cgroup字段**。不能从Docker SDK场景继承cap0/NNP，也不能据用户manager running推断。新轮只读取本轮Main/Core/shell `/proc/status` 的Uid/Gid/CapInh/CapPrm/CapEff/CapBnd/CapAmb/NoNewPrivs/Seccomp、`/proc/<pid>/cgroup`，及unit ControlGroup/Slice/MemoryMax/CPUQuota/NoNewPrivileges；以正常UID501原条件运行，不加cap/不改unit cgroup或NNP去求绿。只保存这些字段，不能输出完整env；Core环境只保7个明确profile字段。

本机macOS没有Linux PID1与原用户systemd manager，无法诚实执行这条注册链。可本机完成的有限切片只有静态源合同、原归档/member SHA、source anchors与后续纯bundle/syntax准备；这些已准备部分不算R05更新通过。现有专用VM历史环境可行，但须本轮fresh读验与Root调度，当前没有联机操作。

准备入口（仅host文件操作，不执行服务）：

```sh
python3 scripts/tests/prepare-linux-user-service-update.py --name client-linux-systemd-update-<fresh>
```

旧准备v1在substring anchor统计把清理分支stop也算入时失败，保存 `failure.json`；改为完整行唯一计数后fresh v2准备通过，无产品/VM行为。上述v2为历史设计准备；随后新派生driver已完成下节静态准备，仍未执行已注册update。

## 新薄派生 driver 已冻结，仍未运行

当前最终候选是 `client-linux-systemd-update-driver-v4-20261020`：[prepare](../evidence/client-linux-systemd-update-driver-v4-20261020/preparation.json)、[静态质量](../evidence/client-linux-systemd-update-driver-v4-20261020/quality-result.json)、[6项纯contracts](../evidence/client-linux-systemd-update-driver-v4-20261020/pure-contracts-green.log)。v3早期静态候选不改；v4额外锁住stop后MainPID0、原update后旧Core已无、PTY最终birth与起点相同。两个候选均没有VM或业务执行。

新增 `build-linux-user-service-update.py` 和三个明确 `.py.tpl` 从原user controller/SDK及已验证Terminal模板按唯一anchor薄派生。原注册/重复daemon、SDK File/Setting、原12秒stop和双DELETE有限确认/卸载段保留。只把restart段替为原CLI update、同unit/MainPID新Core、实际current/new Core执行路径与新SDK/PTY验证；catalog URL只加入update子CLI局部env。SDK原20秒总deadline保持，新增独立旧socket只读watch模式有连接ready和有界自然close；不是socketclose时任意错误都算通过。新Core/同Supervisor/cgroup与原descriptor SHA必须一致，旧Core确已退出。

写前Core七字段由实际/proc核验，SDK先info私有root再workspace写；新PTY复用原公开Terminal/stty，不使用侧路resize或另造PTY，普通VM UID501严格核四Uid栏、实际cwd/tty/birth；Main/Core/PTY status capability/NNP/seccomp/cgroup只读实收，不修改权限/隔离配置。原uninstall两提示交互完整保留，正常用户目录两symlink用lexists防悬空遗漏。独有HTTP及watcher均在清理中独立收口，再核所有owned PID/port/unit/socket/userLinks；原保留用户数据合同不变。

生成 `input/vm.py` 与 `input/sdk.mjs`（esbuild目标Node22），实际执行入口由prepare的 `vmRunPreview` 给出。VM driver在注册前先核这两个文件SHA和OLD归档SHA、真实PID1/manager/UID；仍需要Root先审这份冻结candidate、按原正常用户VM会话调度。Host preparer没有run选项，不会自行启动VM、user unit、HTTP或容器。

已通过：新driver Python编译；完整SDK source和bundle的Node --check；三个Python文件Black check；6项纯path/catalog/parser/anchor/UID501 regex contracts。16个源码快照与当前源一致、原v2 user controller/SDK仍等于既有peer SHA，生产12源/lock不变。纯contract的受控临时symlink/Node正则不是实际systemd或PTY验收。当前R05真实已注册服务update仍为未运行，不能关闭缺口。
