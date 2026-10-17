# 同一 Native 后台的有限 Admin DOM 控制

Root 已启动并拥有 `data/client-native-experience-live-20261017`。本控制器只读取该 fixture 的 `desktop-state.json` 和 0600 `browser-login.json`，在父 root 的独占 `admin-browser` 子目录启动冻结的 OwnedAdminBrowser，以 metadata 中单一 SPKI 连接实际 HTTPS 后台。不得关闭、修改父 fixture，不使用 token 或 API 写配置，不修改冻结的 20 项 Admin 源码/测试/产物。

先以真实 DOM 登录、确认 metadata 指定 tenant、进入客户端定制/桌面行为，输出 ready 和有限命令。原生 CDP 输入与只读 DOM helper 复用冻结 browser driver 的定义前缀，不执行其原 smoke 分支；运行前核对最终 source freeze。浏览器保持运行，PTY 每行仅接受以下命令并串行 ack，不接受参数、任意代码、路径或 shell。

| 命令            | 实际 UI 操作                                                                       |
| --------------- | ---------------------------------------------------------------------------------- |
| desktopDraftOn  | 桌面上下文=true；trace=true、ratio=0.2、groups=[settings]；只保存草稿              |
| desktopPublish  | 发布当前 desktop 已保存草稿，不修改字段                                            |
| desktopOff      | context/trace=false、ratio=0、groups=[]；保存后发布                                |
| sceneDraftTitle | 第一条草稿建议中文标题改为“企业后台更新推荐”，只保存草稿；不存在时失败，不补造模板 |
| scenePublish    | 发布当前 scenes 已保存草稿，不修改字段                                             |
| sceneDiscard    | 对 scenes 点击放弃草稿，不修改发布配置                                             |
| close           | 关闭本控制器的 Chrome/BH，并在实际退出后删除自己的子 root；保留父 fixture          |

每次动作前后核对 origin、tenant、当前 kind；记录实际 DOM 的版本/修订和受控字段，以及安全配置截图。保存要求 revision 增加且发布版本不变；发布要求 revision 增加且 version 加一；弃稿要求 revision 增加且发布版本不变。HTTP/Native 的交叉验证由 Root 独立执行，不能以 DOM 回显冒称 Native 已生效。

未知命令只返回拒绝 ack，无浏览器动作；命令失败保留错误 ack 和浏览器供 Root 查看，不改业务源码。所有密码只用于进程内正常 DOM 登录，不打印、写 evidence 或截取登录表单；BH_RECORD/telemetry 均关闭。close/EOF/终止时只清自己的资源，未知 daemon 或未退出时保留子 root 并报告失败。新增 runner/driver/spec 单独冻结，既有 20 项 freeze 与 owned assets 必须保持匹配。
