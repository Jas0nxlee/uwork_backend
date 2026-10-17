# 原生个人技能管理追加联测

2026-10-17。独占 Native profile `client-native-management-20261017`、真实 email HTTP 会话/生产加密 store、真实后台文件 DB/TLS 与 production Main/Host；未调用真实企微、外部 MCP、网盘或付费模型。个人技能是自有初始输入，不冒称本次创建/导入成功。

## 实际缺陷与修复

旧 Main `15610678…` / Host `29ed78ea…` 下，允许列表显示技能后，通过真实后台发布 `personal.skills=false`，再点击旧可见开关。实际 `.uwork/cli/config.json` 从不存在变为该技能 `enable:false`，UI 随后却因列表刷新拒绝而显示权限错误。这是已发生写入，不是只有错误提示或源码推断。

源码探针进一步复现排队开关、复制/删除在等待点撤权后仍产生后续副作用。管理六入口现在共用原私有 session 的单 scope，内部共享 list，不重入授权；原唯一写队列保留，并让提前准入失败的后继等待其前驱结束。读取出口保留原取消语义，mutation 等真实 I/O settle 后才释放队列。正文、配置/审计写入、copy/rm 前后复核；已获准派发的 OS 操作可以完成，不承诺回滚。

共享 runner/copier 与导入器采用同一个实现，生产旧 decorator 已删除。API、RPC、身份 owner、默认 UCAS 行为不变。详细合同见 `clients/uwork/specs/enterprise-skill-management.md`。

## 新产物实际 UI 结果

| 入口                           | 观察与持久化结果                                                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| 先列表、再撤个人权限、点击开关 | 明确企业拒绝；配置 SHA 完全不变                                                                                                       |
| 恢复权限后开关                 | 实际启用成功；原存储规则将默认启用项归一化删除，配置为 `{}`，不是要求显式保存 `enable:true`                                           |
| 删除确认打开后撤权再确认       | 明确拒绝，自有技能文件仍在                                                                                                            |
| 主动取消删除确认               | 文件 SHA 不变                                                                                                                         |
| 恢复后确认删除                 | 自有目标目录真实消失，另一技能保留，列表剩 1 项                                                                                       |
| 撤危险技能权限                 | 明确拒绝，配置不变                                                                                                                    |
| 撤文件权限                     | 实际拒绝、配置不变；当时 UI 显示原始 `enterprise_filesystem_denied`，exact-code 本地化已 unit RED→GREEN，最终新 Renderer 仍需单列复测 |
| 可访问名称                     | 旧 AX 两个 switch 均无名称；新 AX 分别为各自技能名，原 `aria-checked` 继续表达状态                                                    |

取消/确认和开关均使用 DOM/AX 与原生 CDP 输入，未注入 React/store 或直接调用业务 RPC。两次驱动假设修正单列：首次新 profile 尚在引导页时快捷键不会打开设置；启用配置沿原规则可归一化为空。没有据此修改产品行为或写入假的成功证据。

## 产物、验证与清理

本阶段 CLI/staged 仍为 `a684e40751e1f9bf7e8e7e3710f8518001451ec33d74964e5502a297a1d23d0c`；Desktop-only 构建后 Main 为 `5d28e6e2075ad32605ddc2491bd5f868925cd650e345aade8bcffa604d417d09`，Host 为 `8bb5f4d9953f01320451ca257edc55a5271eaa2c6ec235c163c591a903985b07`。同一阶段的 RendererReady 修复另有实际 second-instance 证据，不用本管理测试替代。

Source 聚焦 112/112、services 回归 266/266、严格测试类型、客户端/后台类型、Lint/格式与架构通过；独立 reviewer 重跑重点 112/112 并核对真实文件等待点、取消与三次排队场景。完整 enterprise-policy 的 Core 106、Host 266 通过。并行 build 时 lint 曾包含临时 tsup 配置产生的既有 unused 警告，最终数目按干净构建后的 gate 记录，不将其当新增产品错误。

Native 管理测试没有成员模型生成；供应商/账本均为另一成员初始化 2 次、2 settled。最终 Electron code 0、fixture errors 0；外层核对 7 个自有 PID 消失、4 端口关闭、数据根与专属 browser-harness daemon 删除。原始旧 Main 的 6 个进程已先单独退出。主后台未重启，未读取主 `.env`/主 Vault，相邻客户端仓库未改。

证据：`evidence/client-native-management-20261017/` 中 `native-toggle-write-red-proof.json`、`native-toggle-write-green-proof.json`、`native-toggle-allowed-proof.json`、三组 `native-delete-*-proof.json`、`native-toggle-other-denials-proof.json`、AX/DOM/截图与 `outer-cleanup.json`。Source 证据及构建 hash 在 `evidence/client-skill-management-20261017/`。其他个人/项目/插件范围、跨平台和手机仍各自验收；本切片不关闭整个目标。
