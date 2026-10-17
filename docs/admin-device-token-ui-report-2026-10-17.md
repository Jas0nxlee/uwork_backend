# 终端凭据管理界面补测结果

2026-10-17，终稿受控运行 `2026-10-17T13-06-52-789Z-f98400` 通过。只新增验收 spec、隔离 test fixture/浏览器驱动和本报告，没有改生产源码、主配置、公共 Native fixture 或客户端产物。

## 实际结果

| 层次     | 实际操作                                                       | 结果                                                                           |
| -------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| UI       | DOM 邮箱/密码登录 → 企业与企微 → 签发凭据 → 有效 2 小时 → 保存 | `POST /api/auth/device-tokens` 201，恰好一次                                   |
| UI       | 查看我的终端凭据                                               | 1 行，只有 `id/created_at/expires_at`；ID 是 SHA-256 哈希，无 token 字段或明文 |
| API 使用 | 用刚才 UI 签发的同一凭据读取 `/api/client/configuration`       | 200，返回当前合成身份所在租户                                                  |
| API 吊销 | 同一 UI 交互会话删除该终端凭据                                 | 204                                                                            |
| API 拒绝 | 同一终端凭据再次读取同一路径                                   | 401 `SESSION_EXPIRED`                                                          |
| UI       | 再次查看我的终端凭据                                           | 真实 DOM 列表为 `[]`                                                           |

当前产品没有 UI 吊销按钮，本次严格按 **UI 签发、API 吊销** 验收。列表实际展示哈希 ID，并非字面星号掩码；留存证据只含短掩码及字段名、数量、布尔值和时间。一次性签发结果中存在完整 token 是产品现有行为，本次没有截图或输出该值；两张截图都在关闭结果弹窗后拍摄。完整 token 只经真实响应、DOM和夹具内存使用，没有写入证据或环境文件。

复用现有正式管理端构建，JS `index-BiquO3Vt.js` 的 SHA-256 为 `8231e85890942ee6cf1ef330b852c233ed7c45155bf4366063619b1f024c1113`，测试前后相同；相关源文件早于该构建且产物包含现有签发入口。没有构建 admin、CLI、stage 或 Desktop/out。

## 失败保留与验证边界

前三次独占运行分别因夹具 publicUrl 与真实 origin 不匹配、坐标驱动未滚动到导航、已安装 helper 的小写 a 虚拟键未触发全选而停止，均发生在签发 POST 之前。来源拒绝是原有正确保护；这些驱动问题已在测试夹具中纠正，没有据此修改产品或虚构成功。原失败日志、真实 HTTP 状态和诊断仍分别保留。第一次成功之后又加强了“后台关闭失败也必须保留根”的清理条件，并以终稿源码完整重跑通过。

终稿使用后台 Node 24.19.0、自有 incognito/headless Chrome、独占 CDP 和 BH_HOME，`BH_RECORD=0`、harness telemetry 关闭；实际 runtime PID 文件为显式 runtime 模式的 `bu.pid`，daemon command 已校验。所有运行都进行了外层逐 PID/端口/root/BH 清理核对。未知 daemon、仍存活进程或未关闭端口会判失败并保留临时根，不能以发送信号或固定等待代替退出证明。

未读取主 `.env`、主 DB/Vault，未操作主 3000/PID 37266，未使用模型生成、付费供应商、真实企微、外部 MCP/网盘或 remote model/Provider/command 探针。DOM 点击与输入经原生 CDP，没有 fetch/响应替换或 React/store 注入。TypeScript noEmit、目标 ESLint/Prettier 和 Python 语法检查通过。

证据位于 ignored `evidence/admin-device-token-ui-20261017/`：终稿 run 的 `result.json`、两个 browser 脱敏日志和安全截图，以及每次运行的 `outer-cleanup.json`；汇总见 `outer-cleanup-summary.json`。这条结果不替代未覆盖的客户端远端权限或其他平台验收。
