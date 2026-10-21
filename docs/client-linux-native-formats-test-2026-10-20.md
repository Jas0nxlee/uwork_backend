# Linux 原生四格式验证

最新异步确认Main载荷的四格式已由[独立补产与消费验证](client-linux-native-formats-async-test-2026-10-20.md)完成：原AppImage/deb保持SHA，RPM/pacman在GUI退出后分别原单target补产，20core/20权限和四包独立摘要通过。原all-target禁网失败与后续RPM OOM保留，不写成同一all-target命令全绿；最后生成的YML仅列pacman，不称完整更新feed或签名发布。以下保留先前v6格式修复与历史证据。

原 electron-builder 26.8.1 完整配置在 ARM64 Linux 工具链执行 `--linux --arm64 --prepackaged --publish never`，AppImage、deb、rpm、pacman 四项生成和消费验证通过。没有发布安装包。

原始失败均保留：pacman 文件名为 `.pkg.tar.zst`，内容却是 xz；默认 legacy ARM64 AppImage runtime 执行标准 `--appimage-offset` 时缺少 `libz.so`。修复由原配置唯一控制：FPM 显式使用 zstd，Linux ARM64 AppImage 选择当前 builder 已支持、固定校验的 1.0.2 工具集（builder 标记为 Beta）。没有安装开发库掩盖错误，也没有修改 vendor 或手工重压缩产物。

四种产物都验证了原格式元数据、版本 3.16.0、Preview 身份和五个核心文件的 SHA256；共 20 项内容比较一致。AppImage 原 runtime 的 offset/extract 成功，pacman 为真实 zstd 魔数 `28b52ffd`。另行从宿主重算四文件大小/SHA256/SHA512，全部与消费记录和 latest yml 一致。生产器、消费者容器均已消失。后续普通 UID 补测发现旧 macOS staging 目录 0700 被带入旧 deb，故消费者又增加核心父目录可遍历/文件可读/程序可执行权限断言；同批四格式的 20 个文件及其父目录全部通过，见同目录 `permissions-result.json` 和 `client-linux-native-validation-v5-20261020.log`。

证据：`evidence/client-linux-native-packaging-v6-20261020.log`、`evidence/client-linux-native-validation-v4-20261020.log`、`evidence/client-linux-native-formats-20261020/result.json` 和同目录 `independent-verdict.json`。历史 v4/v5 生产器及 v1–v3 消费者失败记录继续保留。

配置已通过客户端类型、Lint、架构与改动格式门禁（113 既有警告、0 错误）。该历史轮次只关闭格式、原runtime解包和内容一致性，当时的AppImage GUI、普通用户sandbox与实际URI未由解包代替。后续已分别取得[普通UID sandbox](client-linux-sandbox-test-2026-10-20.md)与[AppImage/deb系统URI](client-second-instance-confirmation-test-2026-10-20.md)的限定范围证据；FUSE、rpm/Arch实际安装、物理平台和整体发行边界仍分列。
