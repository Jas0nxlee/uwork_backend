# 同一 Native 后台的 Admin DOM 联动记录

本控制器已完成 Root 逐条授权的 5 个配置操作，随后只关闭自己的 Chrome/BH。父 Native、后台、父 root 和 `browser-login.json` 均由 Root 保留处理。没有修改原 20 项 Admin freeze、主 `admin/dist` 或客户端产物。

## 实际 TLS 和 DOM 边界

Chrome 以同一 fixture 的 `https://127.0.0.1:52561` 实际加载、登录并进入客户端定制，确认 tenant=`9b40fa3bedea2fc5459f8274a9651bd1`。页面实际加载 `/assets/index-BSU_WPEH.js`，初始 desktop v0/r0。冻结 helper 的可选 SPKI 本轮已获得正向运行证据：Chrome 主进程存在精确 `--ignore-certificate-errors-spki-list=InO6vuVW+18wKhV6TYF8XtdCaiPIzrREfPiCB1IfnUs=`，无全局 `--ignore-certificate-errors`。

凭据仅从父 fixture 的 0600 文件读入内存并正常 DOM 输入；没有 token/API 配置写入、fetch/React/store 注入或合成 input/change。所有配置动作通过 browser-harness 原生 CDP，JS 仅只读 DOM。未截取登录表单，BH_RECORD/telemetry 关闭；就绪和 5 次操作的安全截图均已视觉复核。

## 5 个操作的实际顺序

时间为 ack 文件写入时间（UTC），版本/修订来自实际 DOM。每次操作前后均核对同一 origin、tenant 和目标 kind。

| 序号 | Ack 时间 UTC | Root 指令       | 实际版本/修订                 | 结果                                                         |
| ---- | ------------ | --------------- | ----------------------------- | ------------------------------------------------------------ |
| 1    | 14:43:25.115 | desktopDraftOn  | desktop v0/r0 → v0/r1         | context=true；trace=true、0.2、[settings]；仅保存草稿        |
| 2    | 14:46:05.866 | desktopPublish  | desktop v0/r1 → v1/r2         | 发布上述已保存草稿，未编辑字段                               |
| 3    | 14:49:15.644 | desktopOff      | desktop v1/r2 → v1/r3 → v2/r4 | false/false/0/[]，先保存后发布                               |
| 4    | 14:56:45.277 | sceneDraftTitle | scenes v1/r2 → v1/r3          | 第一条中文标题从“企业联动推荐”改为“企业后台更新推荐”；仅保存 |
| 5    | 14:58:56.523 | scenePublish    | scenes v1/r3 → v2/r4          | 发布该草稿，未继续编辑                                       |

未执行 sceneDiscard，未修改 help/plugin。共通过 6 次实际保存/发布按钮提交；每条指令完成后停下等待 Root 下一条指令，未自动推进。

Native/supplier/collector 由 Root 独立操作和观察，以下只记录 Root 转报的对照结果：desktop 草稿后的同 task 请求没有 Desktop 段；发布后的同 task 请求有该段；0.2 采样下 54 次 settings 导航得到 2 批 14 spans 且均为 settings；关闭发布后下个请求无 Desktop 段，同样导航不再增加导出。scenes 草稿后真正冷重启仍显示旧发布标题；发布后原 consumer 经原 30 秒轮询显示新标题，没有重启或 RPC 注入。这些 Native 侧结果不计为本控制器直接复核。

## 驱动与通信

PTY session 14445 仅创建它的 agent 可操作。Root 跨 agent 的 `Unknown process id` 是工具会话边界错误，未触发 UI 动作；之后 Root 经协作消息逐条发有限 op，由持有该 PTY 的 agent 转为单行命令并代发。实际 5 项配置操作均 ACK passed。

| 新增文件                                            | SHA-256                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------ |
| scripts/admin-native-experience-ui.ts               | `b181de3d4f64355a118f7d12d0ff930bc8aafff71625dbfa0d4f7ab7d7431455` |
| scripts/admin-native-experience-ui-browser.py       | `b30cddf5d73091993b7693d5d8a810b0a1192b205f78f4ad3e6d4534239b152e` |
| docs/admin-native-experience-dom-spec-2026-10-17.md | `1c79f8f4e7d7312a8da76112448160a2bb9173b55082468e77422e067b940e8c` |

三项 SHA 与 ready 时的 source freeze 一致，root noEmit、定向 ESLint、Python AST 和格式检查通过。既有 OwnedAdminBrowser 与通用 browser driver 未修改，原 Admin 20 项 SHA 和主 7 个静态文件 SHA 在本增量前后均匹配。

## 清理

15:01:34 UTC 实际 close，runner PID 200 正常 exit 0。helper 确认 19 个已记录 Chrome/BH/driver PID 全退出，daemon PID 246 身份已验证，CDP 59126 已关闭。关前 `bu.sock` 是真实 socket；外层再次确认 PID 原身份不在运行、CDP 不可连接、socket 与 `admin-browser` 子 root 已删除。

父 root 和父登录文件仍存在，登录文件权限保持 0600；外层没有发送信号或探测父服务端口。本次只删除了自己的子目录。

证据目录：`evidence/client-native-experience-live-20261017/admin-browser/`。`000-ready.json`、`001` 至 `005` 的操作 JSON/PNG、`007-close.json`、`pre-close-owned-processes.json`、`outer-cleanup.json`、`operations-timeline.json` 和 `manifest.json` 共同记录本增量；原 `source-freeze.json` 保留 ready 时状态。父 fixture 的 Native 与后台最终清理由 Root 另行记录。
