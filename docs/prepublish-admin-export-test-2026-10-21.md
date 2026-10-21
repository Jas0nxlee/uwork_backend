# 原页面筛选CSV下载验收

独立v29通过。浏览器登录原管理页，原查询框设置条件，点击原“导出”链接，Cookie认证及原HTTP响应后，实际读取浏览器下载的5份CSV（不以控制器fetch代替下载）：

| 原页面   | 筛选                  |  实际文件行数 |
| -------- | --------------------- | ------------: |
| 用量明细 | 本case真实模型id      |             2 |
| 调用追踪 | 本case真实模型id      |             2 |
| 终端事件 | configuration.applied |             1 |
| 操作日志 | vault.create          |             1 |
| 用量明细 | 不存在模型            | 0，仅固定表头 |

逐份核对原合同表头顺序、成员id、模型/应用、settled/succeeded、输入12/输出2Token和Credit14。终端事件另有asset.installed作为过滤负例，未混入configuration.applied导出；操作日志只含匹配vault.create行。每份文件有字节数和SHA256证据，下载目录限定case私有根；结束删除文件及私有根。

后台产生5条真实导出审计，rows依次2/2/1/1/0；ledger/traces/client_events全表在下载前后逐行相同。供应商仅生成初始2笔请求，没有导出后模型调用或计费。原onSend被动夹具曾仅按audit route解析JSON，现明确跳过format=csv以免夹具误解析原CSV；这是测试观察器适配，产品未修改。

Node24严格typecheck、目标eslint、Python AST均通过；只执行新增export模式，没有重跑v22/v23/v25/v28等通过场景。浏览器、后端/供应商端口、私有根均关闭清除。

- [v29原始结果及文件摘要](../evidence/admin-run-ui-v29-20261021/result.json)
- [原UI下载执行](../evidence/admin-run-ui-v29-20261021/browser-export-all.log)
- [类型](../evidence/prepublish-continuation-20261021/admin-export-typecheck.log) / [Lint](../evidence/prepublish-continuation-20261021/admin-export-lint.log)

以Node24和新profile执行`UWORK_ADMIN_UI_CASE=export node --import tsx scripts/tests/admin-run-ui.ts admin-run-ui-v数字-20261021`。此处只证明自有合成数据的原下载链路及数据完整性，整体目标继续active，外部MCP/网盘和发布后平台客户端排除。
