# Native 夹具配置布局与 Help 本地回退实测

2026-10-17。夹具布局修复通过；产品远端 configs/scenes 404 仍为 RED。本轮只改测试夹具和文档，没有构建产品或实现远端 API，旧证据未改写。

## 实际变更

`client-native-enterprise.mjs` 将 appRoot 移到独占 root/runtime/app，调用原 snapshot helper 时传 ownedRoot=root/runtime；helper API 未变。正式公开 `clients/uwork/config/default.json` 用 COPYFILE_EXCL 复制到独占 root/config/default.json，源/目标 SHA 一致。真实未打包 Main 的 `app.getAppPath()/../../config/default.json` 因此落在本次 root 内。没有修改 app.isPackaged 或 app.getAppPath。

onResponse 继续保留旧 path 的 route template 含义，同时新增 routeTemplate 和 pathname。pathname 只取 raw req.url 的路径部分，不记录 query/fragment；未匹配路由的 template 为 null，实际 404 路径仍可识别。

## 预备验证

独占 profile `client-native-layout-prep-20261017` 未启动 Native。所有可写路径在 owned root 内；公开配置 341 字节，SHA256 为 `05356d1513238e10c1823fd4ba9003e5d814f2f166c5c989044670489310af6f`。正式 out 的 6,656 个文件、138,699,726 字节全部逐文件核对双端 SHA。固定未知测试路径的一次 GET 返回 404，记录 null template 与正确 pathname；临时合成 query 值未输出或留存。该诊断与产品真实 404 分开记录。

证据：[prep 断言](../evidence/client-native-layout-prep-20261017/prep-assertions.json)、[路径诊断](../evidence/client-native-layout-prep-20261017/http-path-diagnostic.json)、[清理](../evidence/client-native-layout-prep-20261017/outer-cleanup.json)。

## 一次真实 Native 运行

独占 profile `client-native-help-layout-live-20261017` 使用正式 755 CLI / 517 Main 冻结字节，全部产物 SHA 见 [artifacts.json](../evidence/client-native-help-layout-live-20261017/artifacts.json)。真实 Main PID 68715、app.isPackaged=false，appPath 与本地回退路径分别位于该 profile 的 runtime/app 和 config/default.json；没有启用 workflow 模式。

通过独占 CDP/BH_HOME，以实际 DOM/AX 跳过三步 onboarding，打开“帮助”菜单，观察“资源管理器”；再用 Cmd+Shift+P 打开命令面板，观察并滚动显示“用户社群”选项。没有执行该命令或打开外部链接。UI 的该选项由真实 platform.canOpenCommunity 返回值控制；Main 本次远端 Help 读取失败 404，但本地配置读取错误为 0，所需能力仍实际出现，证明本地回退可读。不能把“用户社群”描述为 Help 弹层内的菜单项。

源码依据：`desktopCommandHandlers.ts:156-172,221-243` 的正式路径和回退；`electron-builder.config.js:563-564` 的公开配置资源复制；`App.tsx:973-1000` 和 `quickPickCommands.ts:251-259` 的能力控制。证据：[真实 runtime](../evidence/client-native-help-layout-live-20261017/native-runtime-info.json)、[回退断言](../evidence/client-native-help-layout-live-20261017/help-fallback-assertions.json)、[DOM 断言](../evidence/client-native-help-layout-live-20261017/help-read-dom-proof.json)、[实际命令面板截图](../evidence/client-native-help-layout-live-20261017/help-community-command-readable.png)。

## 保留的缺口与清理

本次真实产品请求 `/api/v1/client/configs` 共 7 次 404，`/api/v1/client/scenes` 共 1 次 404。8 条均保存 null template、明确无 query 的 pathname 和 HTTP 状态；Host 也实际记录 scenes 失败。这些产品接口没有在本轮补齐。完整记录见 [remaining-404-red.json](../evidence/client-native-help-layout-live-20261017/remaining-404-red.json)。受控供应商仅有夹具初始化的 2 次请求，没有 Native 聊天或真实付费模型调用。

结束后只读 CUA inventory 可读，10 个运行应用均返回 0 个原生窗口；工具未提供明确的当前锁屏状态，不能据此推断仍锁屏。没有激活应用或发送输入，且该复核发生在 profile 清理后。原生目录选择器保持未验收，未重新启动 profile。

预备 PID 67156、live 父进程 67906 与 7 个 Native/子进程均已退出，两组各 4 个端口均拒绝连接，两个 owned root 已删除，live BH daemon 已停止且其目录已删除。fixture cleanup 均无错误；主 PID 37266 的启动时间与命令观察值未变。详见 [live 清理](../evidence/client-native-help-layout-live-20261017/outer-cleanup.json) 与 [冻结清单](../evidence/client-native-help-layout-live-20261017/freeze-manifest.json)。
