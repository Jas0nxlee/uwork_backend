# Native 自有配置控制面真实联动记录

本组使用 CLI/source 与 stage `39175fd…d43c`、Main `d86f4c…f92e7`、Host `3551ba…9a05d`。这是控制面初版的真实 Native 证据；后续 SWR 修复的 `bf0bd5 / 61feaf` Native 组单独报告，不能混为同一候选。

后台为独占真实 createApp、SQLite、HTTPS 和受控供应商。测试登录会话经正式加密 store 由原身份 owner 恢复；不是企业微信 OAuth。管理页使用同一 HTTPS 后台，真实 DOM 登录/编辑/保存/发布，Chrome 仅信任本次证书的单一 SPKI。没有向 Renderer 下发模型 API Key，没有调用付费模型、真实企微、外部 MCP 或网盘。

## 已观测的联动

| 项目           | 实际结果                                                                                                                                                                                                                                              |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 推荐卡片       | 发布后 Native 显示“企业联动推荐”；实际点击填入 `EXPERIENCE_DRAFT_V1`。不存在的 pluginStableId 未产生 mention、安装或市场请求。                                                                                                                        |
| 桌面上下文草稿 | 同一会话首轮默认关闭；管理页只保存 desktop 草稿 v0/r1 后，下一轮真实模型 system 仍无 Desktop 段。                                                                                                                                                     |
| 发布与关闭     | 管理页发布 v1/r2 后，同一会话下一轮真实模型 system 含 Desktop 段；保存并发布关闭至 v2/r4 后，下一轮重新移除该段。未重启或手写 RPC。                                                                                                                   |
| 动作追踪       | 发布 enabled/0.2/settings 后，54 次实际设置导航产生 2 批、14 条 Renderer `settings.navigation`。关闭后再做同样 54 次导航，没有新增 Renderer 导出。未替换随机数或注入 batch。最终另收到 8 条非 Renderer span，仅计数，不保留其属性，也不算作界面动作。 |
| 场景草稿       | 管理页保存新标题但不发布，关闭整组 Native/BH、核对进程退出，再同 profile 冷启动，仍显示旧标题。                                                                                                                                                       |
| 场景发布       | 实际管理页发布 scenes v2/r4 后，Native 原 30 秒轮询在同一挂载页面显示“企业后台更新推荐”；再次冷启动仍显示该值。                                                                                                                                       |
| 关闭帮助       | managed 默认关闭时，命令面板没有社区项。实际点击“问题上报”未打开旧工单 Dialog；身份撤销后从错误面板直接点“反馈问题”也未打开旧 Dialog。后台旧反馈请求为 0。外部 URL 的 OS 打开不在本组验收内。                                                         |
| 身份撤销       | 实际后台注销 Native 身份后发送新输入，界面显示企业功能/模型服务不可用；供应商与账本增量均为 0。未触发真实企微登录。                                                                                                                                   |
| 旧接口         | 记录到的 624 个后台 HTTP 响应中，`/api/v1/client/configs`、`/api/v1/client/scenes` 请求均为 0。旧版本真实 404 保留在历史报告。                                                                                                                        |

[管理页同后台操作与 TLS 证据](admin-native-experience-dom-report-2026-10-17.md) 列出 5 个操作、6 次保存/发布按钮和各自 v/r。该浏览器链结束时 desktop/scenes 均为 v2/r4；随后为专家排除验证，夹具通过真实 API 另将 desktop 发布为 v3（仅 context=true，追踪保持关闭）并补文件权限，不属于前述管理页操作。

## 实测暴露的问题与保留边界

首次实际发送并进入自动化后出现“无可用模板”，尽管 scenes 已发布。实际 React/SWR 复现确认是单个 consumer 卸载清空了共享数据，又留下十分钟 FETCH 去重标记。修复仅在最后一个 reader 离开后退休数据和去重标记；[源码及独立复核](../evidence/client-scene-resource-lifecycle-20261017/peer-review.json) 与 [后续真实 Native 结果](../evidence/client-native-scenes-fixed-20261017/summary.json) 分开保存。后者覆盖表单、三轮往返、冷启动和 V2 暖更新。

企业专家 Child 的本组正向尚未通过，不能从父模型通用回复或图片文件名推断成功。最初缺少文件权限是夹具前置遗漏；真实 API 补齐 FS=true 并冷启后仍没有 child 请求。结构化日志随后证实 Host 后台同步与 CLI 首次目录读取在同一个资产选择版本上发生 CAS 冲突，CLI 因 `enterprise_asset_selection_changed` 没有注册专家；后续目录成功不补已有启动快照。[只读因果记录](../evidence/client-native-experience-live-20261017/expert-catalog-selection-race-readonly.json) 保留该 RED，后续修复及真正 child 模型正文另行验收。未放宽 CAS 或权限以制造成功。

本组共 16 次受控供应商请求、16 settled、0 uncertain：2 次为另一成员初始化，14 次为 Native 父会话、标题及三次未实际派发 child 的专家尝试。不是 16 个成功业务用例，也没有已接受的企业专家 child。`readCatalog` 失败前没有进入正文读取，当前失败不能归因于 global crypto。

Help 外链、真实公开商店两个条目的排序、offPeak 旧 plan 入口、同 Main 双窗口/child 代次、系统 chooser、正式安装包及跨平台运行保持各自未验边界；源测试、空目录、单项排序或另一个进程不能替代这些层次。

## 证据与清理

- [完整流量、配置、模型正文与账务](../evidence/client-native-experience-live-20261017/final-experience-proof.json)：按阶段命名的 proof 文件保留草稿、发布、关闭、冷启和撤销前后差异。
- [初版构建清单](../evidence/client-experience-20261017/artifacts.json)、四次真实 runtime 信息、DOM/AX/截图，以及三份归档 Electron 日志位于同 evidence 目录。每轮冷启前保存原日志，未用截断后的文件代替旧观察。
- [外层清理](../evidence/client-native-experience-live-20261017/outer-cleanup.json)：四代 Native/BH 共 36 个已知 PID 及父 fixture 95226 均退出，4 个端口均关闭，独占根（含临时证书、登录资料和加密会话）已删除。另一个管理页 Chrome/BH/driver 的 19 个 PID 和 runner 由其独立报告核验清理。

保留的驱动错误包括 named BH 尝试让 Electron 创建额外 tab 而不受支持、把“对话”当返回原任务、返回工作区 AX 重名，以及过早截取尚未提交的 DOM。均按实际输入/历史及独立模型 proof 纠正，不算产品失败；模板缓存与资产目录 CAS 则有对应的真实产品 RED。
