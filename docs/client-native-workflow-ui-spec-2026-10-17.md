# Native 动态工作流 UI 追加验收规格

2026-10-17。沿既有 Native 工作流中枢、SaveWorkflow 交互批准和正式 V4 命令补足 UI 证据，不新增后台产品配置或工作流能力。

## 边界与所有者

使用当前正式 CLI、Main、Host、Renderer out 字节，拷贝到独占 appRoot 运行。此 Electron 是未打包 runtime，必须在 Main 导入前记录真实 `app.isPackaged=false`；夹具仅以显式 `UWORK_NATIVE_DYNAMIC_WORKFLOW_MODE=alwaysOn` 映射仓库已有 `ZCODE_DYNAMIC_WORKFLOW_MODE`，由原 Main/Host 灰度 owner 决策，不修改 app.isPackaged、React/store 或业务 RPC。

当前打包正式 production 会删除环境覆盖，而现用 CodingPlanSubscriptionService 已不读取旧远端 configs，故正式安装包没有已接通的启用来源。此缺口单独保留，不用未打包 UI 联测或既有 CLI 10/10 结果替代。

后台发布版本和当前企业权限仍是准入事实；Main 拥有启动环境，Host 拥有灰度快照、身份与私有模型端口；CLI runtime/run service/journal 拥有会话、运行、取消与恢复。UI 只经 DOM/AX 与真实鼠标键盘发既有操作。测试供应商只对明确独占提示返回 SaveWorkflow 或两步 actor 文本，可暂停本机第二步的 HTTP 响应，不能代替权限服务、写 journal 或注入 workflow 事件。

```text
Native 对话 → SaveWorkflow 原确认 UI → 已批准 project 定义
Native agents 菜单 → 工作流页签 → Run → 原 V4 创建会话/启动 run
运行详情 → Cancel → 原 stopped(user) → 冷退出/原存储重启
原父会话/运行详情 → Resume → 原 run ID、完成步骤回放、未完成步骤当前准入
```

## 验收场景

1. 在 Native 对话输入独占测试提示，受控模型经正式 SaveWorkflow 返回合法 project 两 ask 脚本；实际 UI 显示路径、脚本和批准，点击允许后才保存，工作流中枢真实发现定义。可另以拒绝证明零新保存，不把最终模型文案当作保存证据。
2. 实际点击内置企业 agents 菜单、工作流页签和运行按钮；按工作流所属 workspace 创建新 parent session，真实 actor 第一 ask 完成，第二 ask 在所拥有供应商暂缓。记录实际 run/session ID、UI 状态和供应商请求。
3. 运行中从真实 UI 取消，观察原 `stopped(user)` 终态。已到供应商的被取消请求保留 uncertain 结算事实，不假称零派发、自动退款或事务回滚；终态后不再把 Cancel 当作一次有效取消。
4. 停止所拥有 Electron/Host/CLI，保留独占后台、身份和存储；冷启动同一 profile，再从原父会话/运行详情点击 Resume。必须恢复同一 run ID，第一 ask 零模型重跑，未完成第二 ask 重新派发后真实完成；不把再次点击 Run 创建新 run 算作恢复。
5. 已保存定义在中枢可见后，真实后台发布 filesystem=false，再点击 Run。原 V4 owner 应拒绝 `enterprise_filesystem_denied`，没有新 run/actor/供应商派发；旧定义和合法历史保留。记录空 session 回收的实际结果及 UI 提示，不仅检查按钮存在。

## 运行约束与证据

只使用独占 fixtureName、CDP、BH_HOME、数据目录、本机 HTTPS/backend/供应商和合成 email identity；保留源目录 `.env*` 读取守卫。不读主 `.env`、主 DB，不解密主 Vault、不碰外部 checkout，不 build/替换 CLI 或 Desktop out，不使用远端模型、付费供应商、真实企微、外部 MCP 或网盘。

每个场景保存 DOM/AX、截图、实际供应商/账本、运行标识和终态。测试结束核对自有 Electron/Host/CLI PID、端口和目录关闭/删除，清理专属 browser-harness daemon；测试证据保留。若入口不存在或能力拒绝，记录实际拒绝和阻断依赖，不发明新入口。

原生目录选择器若因 macOS 锁屏不可操作，保留该阻断，不绕过锁屏。可使用正式 Main 已支持的 `--open-workspace <真实目录>` 冷启动路径；路径只能是所拥有夹具根内新建的空目录，不能预写 settings/store 冒充 UI 选择。运行中的同参数 second-instance 若停在 renderer-ready 队列，只记录实际观察，不把已接收参数当作工作区已打开。此启动入口不替代原生选择器或深链确认验收。

测试快照逐目录使用真实 readdir(withFileTypes)，创建新 owned app/out；常规文件以最多 8 个并发、COPYFILE_FICLONE|COPYFILE_EXCL 复制。保留全部文件（含 map 和隐藏文件）、空目录；符号链接不跟随，按原 fs.cp 缺省语义将相对目标解析到源父目录。拒绝特殊文件和源树内目标。首次失败后停止新 job，等待所有已发 job 完成再报错，避免清理与写入竞争。Native 启动前对全部常规文件验证源/目标字节 SHA，对符号链接验证语义；验证失败不能启动 Main。此工具只用于测试快照，不修改产品构建或分发语义。
