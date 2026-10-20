# Linux 原用户 systemd 服务真实验收

具名结果：`evidence/client-linux-systemd-user-v2-20261020/result.json`，7/7 通过，原 VM 调用 exit0；独立 `peer-verdict.json` 机械交叉核对通过。此切片在本项目专用 Colima VM 中执行，PID1 为 systemd、UID501 的原用户 manager 为 running。不是模拟 systemctl，也不是生产主机、登录重启或物理桌面验收。

## 原候选与来源

正常 `stageCli.ts --target linux-arm64 --skip-agent-build` exit0，使用已构建的 `a53f8930` Server profile 修复与原 Node22/Agent。新归档 78,213,243 字节，SHA256 `3b50dc19d24183435fa02fcb379f264642920172fe5276b675eb3c96b2843361`，原 Agent 仍为 `cdf781ecf004b9639157fae25e6e96e558b95faefaee7aab09488d5dc650ecac`，manifest 为 Linux ARM64 / 3.16.0。旧 `7774c7db…` 归档复制保留，新旧没有混称。构建日志和四个 runtime SHA 见 v1 目录的 `normal-linux-stage.log`、`normal-linux-release-provenance.json`。

测试使用原 bin launcher、CLI、Supervisor、Core、用户 systemd、HTTP 和公共 WebSocket SDK。新建私有 `/tmp/uwsysd-*`；未修改 user manager 的全局环境、其他服务或正常后台3000。SDK 写入前从实际 Core `/proc/<pid>/environ` 读取六个 profile 字段，逐项与本轮 root 匹配；只保存这些字段，没有输出完整环境。

## 七项实际结果

1. 新 label 事前不存在；原 `serve --daemon` 注册真实用户服务并返回 ready / serviceRegistered=true。
2. 原 unit 内容、ExecStart 与本轮 launcher/root 一致；systemd 正常用户目录 symlink 的 realpath 对应本轮原 descriptor。
3. 第二次原 daemon 保持 Core14087、generation1，未重复启动。
4. 公共 SDK `ensureConversationWorkspace`、`.zcodeignore` 写读及 Setting 更新全部位于私有 root；没有手写设置或 SQLite。
5. 原 restart 换到 Core14165 / generation2，公共 SDK 重新连接，文件、locale 与终端偏好保持。
6. 原 stop 后实际等待12秒，Core为空、用户 unit inactive，没有被 Restart=on-failure 拉起。
7. 原 uninstall 两次提示后分别输入 DELETE，自然 exit0；unit、用户链接、descriptor、control socket 消失，四个已知 PID 与两个端口关闭。

原卸载保留 `.uwork` 用户数据，驱动将此作为必过断言。随后 Root 独立核归属、unit/PID/端口/socket 全闭，再删除本轮两个私有 scratch，保留设置 SHA 与原卸载保留事实；见 v2 `vm-private-root-close.json`。这一步是测试资源清理，不能写成产品卸载删除了用户数据。

## 首轮失败与边界

v1 原服务真实启动 ready，但驱动误要求 FragmentPath 文本直接等于源 descriptor，未接受 systemd 正常的用户 unit symlink，整体为 FAILED。Root 先通过 realpath、原 unit 内容和 ExecStart 核明本轮归属，再执行原 stop/disable 收口；原始失败结果不改，另存 v1 `failed-case-resource-close.json`。修正仅限独立驱动的归属观测，v2 是同一原包、新私有根，不是产品修复或放宽归属检查。

没有模型、任务或终端工具测试；不关闭运行任务强制更新、跨发行版本升级、系统登录后自启、Windows 服务或所有 Linux 发行版边界。Mac 注册服务更新另见 `client-macos-server-service-update-test-2026-10-20.md`。

源规格 `client-linux-systemd-service-spec-2026-10-20.md`；驱动 `scripts/tests/linux-user-service-probe.py` 在专用 VM 中读取已固定 SHA 的 `--input`，公共 SDK 探针是同目录 `linux-user-service-sdk.mjs` 的正常 esbuild bundle。历史输入、原归档和日志保留在各 case 的 `data/sandbox-verification/` 与 `evidence/`。
