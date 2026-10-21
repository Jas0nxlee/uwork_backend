# 原管理端Runtime/Console门禁

本轮只补此前SPEC-admin-web未采集的浏览器异常维度，不重放原创建/发布/执行/删除流程。导航清单用TypeScript AST从原catalog提取，范围内25个页面（外部集成页按用户排除跳过）；配置标签从原forms提取11个。所有页面通过原菜单/标签点击，等待其真实HTTP成功和原UI就绪，不替换响应或store。

| 视口 | 原始场景        | 页面/配置标签 | 未捕获异常、console error/assert/warning及其他browser错误 | API响应事件 |
| ---- | --------------- | ------------- | --------------------------------------------------------- | ----------: |
| 1440 | v36第一阶段通过 | 25 / 11       | 0                                                         |          62 |
| 768  | v36第二阶段通过 | 25 / 11       | 0                                                         |          60 |
| 320  | v39独立窄屏通过 | 25 / 11       | 0                                                         |          62 |

每个阶段先在about:blank发一条具名console.error校准，CDP实际收到后清空；原产品窗口的0错误不是未启用观察器的假零。采集Runtime.exceptionThrown、Runtime.consoleAPICalled、Log.entryAdded、Network.responseReceived；原匿名auth/me 401及其浏览器网络日志是预期登录探测，分开记录，不冒称HTTP从无401，不豁免其他网络/JS错误。

v36整体status=failed，因第三阶段窄屏导航等待，不能改写为整轮通过；前两个具名阶段原结果/校准/数据快照检查已通过，后续不重跑这两种宽度。v37明确观测到按钮已生效（aside.class=open），但隐藏后台标签中的动画几何停在x=-230，截图触发后sidebar已可见；v38仅激活自有headless标签后首个导航能完成，又记录到模型页之后意外回到概览，原sidebar关闭动画尚覆盖header时，驱动点到了品牌链接。

v39修正设施：只激活自有headless标签；原菜单关闭后等待right<=1，再进行下一次操作；每个点击前用原DOM命中测试确认中心点对应目标控件。未修改产品CSS、React状态、响应、等待预算或业务断言，未重试可能已生效的输入。v39仅320完整通过，和v36两个已通过阶段组成三宽度证据。失败收据与截图全部保留，不记为产品缺陷修复。

原模型/成员/凭据/配置/账本/分类/策略/订阅表在每个通过阶段前后逐行保持；管理HTTP均GET/2xx，供应商0，无新增计费，不请求集成路由或外部服务。自有Chrome、Fastify、供应商端口、私有根均关闭清除。最终严格类型、目标Lint、两驱动AST及diff空白检查通过；无产品源码修改。

- [v36含两个通过阶段及第三阶段失败](../evidence/admin-run-ui-v36-20261021/result.json)
- [v39仅320完整通过](../evidence/admin-run-ui-v39-20261021/result.json)
- [v37几何诊断](../evidence/admin-run-ui-v37-20261021/browser-console-width-320.log) / [对应截图](../evidence/admin-run-ui-v37-20261021/failure-320.png)
- [v38关闭动画点击诊断](../evidence/admin-run-ui-v38-20261021/browser-console-width-320.log)
- [最终类型](../evidence/prepublish-continuation-20261021/admin-device-console-final-typecheck.log) / [最终Lint](../evidence/prepublish-continuation-20261021/admin-device-console-final-lint.log)

新profile用`UWORK_ADMIN_UI_CASE=console node --import tsx scripts/tests/admin-run-ui.ts admin-run-ui-v数字-20261021`运行三宽度；仅补某个宽度时设UWORK_CONSOLE_WIDTH=320/768/1440。该证据覆盖上述页面加载与配置标签，不能替代每个写操作的异常验证或客户端Main退出验收。后续核对发现退出退订告警早已由5cab2ccb修复并通过v11，未重复运行该旧场景；下一项转向未打包原消息编辑与分支继承组合。整体目标active。
