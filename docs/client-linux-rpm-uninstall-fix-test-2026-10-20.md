# 原 RPM 最终卸载：真实 RED → 项目钩子修复 → 真实 DNF GREEN

2026-10-20，Fedora44/AArch64 专用 VM 容器中完成。修复只涉及项目 RPM 配置/模板；不修改 vendor、现归档或 Desktop Main。不是 fresh install、跨版本升级或新包 GUI 全链通过。

## 原产品 RED

原包 `1045042df11d28b080436ce7b538e5f617447d0c01e345e76e08332701df0a31` 经真实 dnf install 后，原 GUI 的十项业务检查已通过，但系统 URI 未达 native 确认，整体仍 FAILED。随后两个独立 writable clone 分别执行原默认 `dnf -y remove zcode-preview`：命令 exit0，包数据库查询 exit1，原清单全部非目录文件删除，仍留下：

- `/usr/bin/zcode-preview` → `/etc/alternatives/zcode-preview`。
- `/etc/alternatives/zcode-preview` → 已删 `/opt/UWork Preview/zcode-preview`。
- `/opt/UWork Preview` 下29个空目录；没有剩余文件。

原 native RPM scriptlet 安装注册的是 `/opt/UWork Preview/zcode-preview`，卸载模板错误传入 `/usr/bin/zcode-preview`。完整两次实际失败：[v1](../evidence/client-linux-distro-fedora-uninstall-v1-20261020/lifecycle-result.json)、[v2](../evidence/client-linux-distro-fedora-uninstall-v2-20261020/lifecycle-result.json)。v2 包含 lstat、链接目标、完整残留目录和用户 MIME 注册；container 均已删除。

## 最小修复与永久回归

`rpm.afterRemove` 指向项目自有 `scripts/linux-rpm-after-remove.tpl`，使用原 FpmTarget 配置渲染，生产/Preview 实际 target 各自独立。最终 RPM `$1=0` 才处理，升级/非零剩余实例数保持新包资源。成功 `--list`/`--display` 确认组及精确目标后，删除安装时同一 target；缺组/缺目标继续本应用 AppArmor/空树清理，真实查询/remove 错误保留非零与 stderr。没有一概忽略 exit2。

直接 launcher fallback 只删指向本产品的链接；find 仅删除本产品安装根的空目录，不跟 root/内部 symlink、不动非空自定义内容。原 AppArmor 最终清理保留。RPM 原 fpm 追加 `-d findutils`，不覆盖默认 Requires。其他平台/包格式保持。

原4项永久 RED 为原模板实际实参与预期 installed target 不同、upgrade 清理及空树残留。Root 另用真实 Fedora alternatives 私有 adm/alt 证明缺组 exit2；补的 missing-registration/查询错误单位 RED 为6PASS/2FAIL。最终11项全部 GREEN，涵盖两个 flavor、升级、非空内容、缺组/目标、list/display/remove 错误、根/内部 symlink、无工具的 owned/foreign launcher。单位 shell 路径明确映射自有 tmp；不将单位映射当实际生产事务。

证据：[原4 RED](../evidence/client-linux-rpm-remove-unit-red-20261020.log)、[absence RED](../evidence/client-linux-rpm-remove-absence-red-20261020.log)、[最终11 GREEN](../evidence/client-linux-rpm-remove-expanded-green-20261020.log)、[独立 peer 11 GREEN](../evidence/client-linux-rpm-remove-peer-expanded-green-20261020.log)。[spec](../clients/uwork/specs/linux-rpm-uninstall.md)。

## 原 producer 与不变载荷

以原 `uwork-linux-native-packager:20261020-v10` 为 base，仅 COPY 新项目 builder config 和新模板。原 input 的 desktop.tar.gz、expected.json、native-package.sh 三 SHA 全部保持。沿原 `native-package.sh rpm` → 原 electron-builder26.8.1 `--prepackaged /app --publish never`，正常生成，未手改归档或重压缩补钩子。

v3 首次选择 network none，原 builder 缺少 FPM cache，下载前失败，原记录保留；没有产品故障结论。v4 使用原正常 bridge 网络，由原下载器获取官方 FPM 工具后自然 exit0；唯一 container 限2560MiB/cpu1，非 OOM，终态 removed。

新原 RPM：109362213 bytes，SHA256 `65844f4036b4fb44e01b6c5dd15f99ef6b81b56ec01b29074553fbdef88b3d47`。旧包完整保留。[producer 机器结果](../evidence/client-linux-rpm-remove-producer-v4-20261020/production-result.json)。

实际 app payload 仍为原1db59c77的 cdf/3658：

- Agent `cdf781ecf004b9639157fae25e6e96e558b95faefaee7aab09488d5dc650ecac`。
- app.asar `3658e4731d2f23977b0bf0ecdf0a7378fa05d0bab531b12100904353b850fd4e`。

不包含后续 Mac renderer263146f4 的改动；没有读取/改写当前 Mac out。

## 真实同版重装与默认卸载 GREEN

为避免另保留一个大 consumer image，在原 Fedora9c4 的独立 writable clone 执行原 `dnf -y reinstall /input/candidate.rpm`。这是相同3.16.0-1 NEVRA 的新构建重装，不是 fresh install 或跨版本。没有 force/replacepkgs/nodeps/手写 DB。

1. 原 RPM file header `--requires` 实收 findutils。
2. 真实 DNF reinstall exit0。
3. installed DB 的 POSTUN 与新原 RPM file POSTUN **逐字相同**，SHA256 均为 `6d11dabeb9ec42e840558e923feff57de5794a95687180f82b96f65b518ac108`，证明不是保留旧包或同版跳过；installed Requires 同样含 findutils。
4. 原 lifecycle probe 实算五个核心运行时文件的 SHA/大小/公开权限，全部与原 expected.json 相同；真实 launcher/desktop/包数据库均正确。
5. 原默认 `dnf -y remove zcode-preview` exit0，原 RPM query exit1，原 manifest 非目录全部消失。
6. `/opt/UWork Preview`、`/usr/bin/zcode-preview`、`/etc/alternatives/zcode-preview`、system desktop 四项全不存在，`afterDetails={}`。
7. 该 PM clone 没有运行 GUI/注册用户 MIME，不把其空用户注册结果用于覆盖旧 GUI 的用户注册残留。clone 自然 exit0、非OOM、removed；无新 image 导出、无主服务/VM生命周期变更。

完整证据：[事务结果](../evidence/client-linux-rpm-fixed-transaction-v1-20261020/fixed-rpm-result.json)、[原 lifecycle 严格结果](../evidence/client-linux-rpm-fixed-transaction-v1-20261020/lifecycle-result.json)、[host controller/资源闭合](../evidence/client-linux-rpm-fixed-transaction-v1-20261020/controller-result.json)。另有明确标记为自身重算的 [15项 evidence self-check](../evidence/client-linux-rpm-uninstall-fix-self-verdict-20261020.json)，不冒称独立 peer。

## 专门复跑入口与边界

从 backend 根指定新证据名，消费已保留的原新 RPM（不重跑 GUI/供应商）：

```sh
python3 scripts/tests/linux-distro/run-fixed-rpm.py \
  --name client-linux-rpm-fixed-transaction-next-20261020
```

原 Fedora9c4 image 为释放专用 VM 空间已在完整 OCI 校验后迁出；重跑前需由资源 owner 将 `/Users/ljp/Library/Caches/uwork-backend/client-linux-distro-image-backups-20261020/fedora-9c4bd298cc9234b2.tar` 原样 `docker --context colima-uwork-backend image load` 并核回原9c4 imageId。备份完整SHA为 `d2b9ae44dce9d030969f7df37c54ec4e7f928a09bc2165bbfaabfa8fc4fa7775`，不是重新构建另一个 Fedora 环境。

脚本核实际 producer metadata/RPM SHA，绑定原同 imageId 的私有 PM clone，完整原 DNF 命令、native RPM/installed DB metadata 和文件残留断言均保留。每次独立名称拒绝撞已有资源。

本轮正常 `pnpm typecheck`、`pnpm lint`、architecture 前后、格式/`bash -n` 均已执行通过；相关初4项+既有配置/发布测试16/16通过，后来11项由 Root/peer独立再核；最终 findutils 与其他并行源码由 Root 统一 typecheck/lint/architecture 再核，均 exit0（lint114warnings/0errors）；Root另独跑11项。四个生产源/spec/永久测试已本地原子提交 `220ba514`。

未关闭：Fedora xdg-utils1.2.1 generic 对合法带空格 Exec 的兼容失败；v3 一次重载 CDP 超时；RPM 实际跨发行版本/完整升级事务、非 Fedora/RHEL-style alternatives CLI 的其他 RPM 发行版；物理 Fedora/RHEL/Wayland/GPU。Arch 独立进行，不与本修复 GREEN 混算。

通用Linux测试preparer的源码白名单原未包含`.tpl`，会漏掉新已tracked钩子。按Root明确授权仅追加该后缀，离线AST读取原allowed set并对原git ls-files结果验证模板入选、`.env`后缀未加入；没有运行preparer或重压包。证据：[filter proof](../evidence/client-linux-native-preparer-template-filter-20261020.json)。本轮独立producer显式COPY新钩子，所以既有真实GREEN不受此基础设施修复影响。

Root独立对原新RPM/installed POSTUN与Requires、原5core、真实DNF0→remove0→query1、四系统残留/manifest及PMclone闭合重核，13项通过：[独立verdict](../evidence/client-linux-rpm-fixed-transaction-v1-20261020/root-independent-verdict.json)。该独核与上述自身15项分开，未将旧Fedora GUI改名为新RPM全链通过。
