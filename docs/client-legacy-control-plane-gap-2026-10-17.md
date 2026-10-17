# Native 旧控制面配置接口缺口

2026-10-17，来自新 `755438` CLI / `5170a7` Main / `d717e0` Host 的真实 Native 日志。当前模型、技能和工作流的指定联测通过，不代表下面配置入口已接通。

| 现有读取者                       | 实际路径                                                          | 当前行为                                                               |
| -------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Main desktopContextPromptRollout | `/api/v1/client/configs?app_version=3.16.0&platform=darwin-arm64` | 404，沿既有默认关闭；错误文字来自共享 fetcher。                        |
| Main rendererActionTraceRollout  | 同上                                                              | 复用该 fetcher，原 IPC 每 60 秒刷新；不能只修 context 而遗漏 tracing。 |
| Main 公开 Help reader            | 同上                                                              | 404 后读取原本地配置；此读取与账号灰度缓存本来就是不同 owner。         |
| Host IClientScenesService        | `/api/v1/client/scenes`                                           | 实际 `client-scenes.list` 404；仍被草稿推荐及自动化模板使用。          |

场景 URL 直接见 `evidence/client-native-model-label-20261017/electron.log:444`；configs URL由同批版本元数据、夹具 origin 和 `desktopContextPromptRollout.ts` 的实际拼接确认。原 fixture 的 onResponse 仅记录 route template，未匹配的 19 个响应因 `undefined` 丢失 path；后续夹具需同时保留去掉 query 的 pathname，不能拿这 19 条假称已区分每个调用者。

`custom-providers-only.md` 已退役账号、套餐、Provider 远端刷新及动态工作流的 client/configs 查询，但没有明确删除上述推荐目录、桌面 context、renderer tracing 或帮助能力。现有 CodingPlan 的 `remote: undefined` 已执行退役，不是这次 404 的原因。不能把仍可达的功能说成死代码并直接删除。

自有后台当前发布 schema 只有 menus/new-chat/assistants/sharing/personal/security/network；`new-chat` 严格包含 welcome/riskNotice，不包含 scenes、Help 链接或这些灰度开关。独立内存后台检查两条旧路径均 404，正式 `/api/client/configuration` 未认证为 401，向 new-chat 塞入 scenes 被严格拒绝。因此补两个空 200 或拼接 welcome/Agent 列表不能构成接入。

另外，Help 本地 ENOENT 属测试夹具布局问题。未打包 Main 从 `app.getAppPath()/../../config/default.json` 读取；旧 fixture 只拷 out 而未拷该资源。正式 electron-builder 已把 `clients/uwork/config/default.json` 放入 `resources/config/default.json`，packaged resolver 对应它，不据夹具失配报告正式包丢资源。后续夹具改为 owned `root/runtime/app` 与 `root/config/default.json`，保留真实 isPackaged/getAppPath 并核对正式源/目标 SHA；禁止写共享 `repo/data/config`。

产品路径待明确：补充自有后台发布和管理合同，或保留本地能力并明确停止旧远端控制面，或将本轮限为记录缺口。已请求这一产品偏好，独立的组织切换、聚合筛选和终端凭据 UI 实测继续进行。当前尚未改变产品读取者，不能将缺口标为修复。
