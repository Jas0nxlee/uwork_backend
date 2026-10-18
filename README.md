# UWork 企业管理后端

主仓库：<https://github.com/Jas0nxlee/uwork_backend>。配套客户端：<https://github.com/Jas0nxlee/UWork>。

根据 WorkBuddy 企业控制台可观察的页面、策略、接口和运行行为，独立实现企业管理后端与管理 Web，再适配 UWork 客户端。

**当前阶段：自有后端与管理 Web 已实现并可本地运行；配套 UWork 本地 Host 身份/模型/用量、企业资产、菜单/新会话/分享与个人策略已适配并完成源码联调。完整产品及生产验收仍有外部接入和终端管控项，见 [验收台账](docs/acceptance.md)。**

## 运行

需要 Node.js 24 和 npm 11.12.1。

```sh
npm ci --ignore-scripts
npm run init
npm run build
npm start
```

默认入口 <http://localhost:3000>。首次初始化凭据保存在 `data/bootstrap-credentials.txt`（0600），不会打印；主密钥与运行数据不入 Git。重复 init 不覆盖账号。

后端覆盖企业身份/通讯录/RBAC/席位、AES-GCM vault、模型代理与 SSE/计量、资产版本审核分发、客户端策略发布、模型 Runtime/自动化/评测、审计/Trace/指标/导出、已登录企业成员会话分享及外部适配合同。SQLite WAL 单实例，数据真实持久化；无生产数据和模拟业务种子。

- [实施规格与顺序](tasks/plan.md)
- [自有 API 合同](docs/api.md)，运行时索引 `/api/openapi.json`
- [企业内会话分享规格](SPEC-enterprise-sharing.md)
- [企业成员分享真实客户端与浏览页联测](docs/client-member-sharing-test-2026-10-18.md)
- [Native 分享打开与匿名访问保护](docs/client-native-share-browser-test-2026-10-18.md)
- [Native 分享页成员登录、只读阅读与退出](docs/client-native-member-viewer-test-2026-10-18.md)
- [企业用量界面异步视图修复](docs/client-gateway-view-delivery-test-2026-10-18.md)
- [Native 测试驱动 Enter 与超时修复](docs/client-native-test-driver-2026-10-18.md)
- [企业登录轮询与窗口迟到结果回归](docs/client-enterprise-login-polling-test-2026-10-18.md)
- [自有插件 Native 生命周期验收](docs/client-native-owned-plugin-test-2026-10-18.md)
- [部署、备份与恢复](docs/deployment.md)
- [2026-10-18 本地后台恢复与实际运行核验](docs/local-backend-recovery-2026-10-18.md)
- [2026-10-15 代码复核与补齐](docs/review-2026-10-15.md)、[2026-10-18 代码复核与修正](docs/review-2026-10-18.md)
- [验证结果与未完成边界](docs/acceptance.md)

```sh
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
npm audit --audit-level=high
```

## 构建前逆向基线

- [能力地图与实现顺序](CAPABILITY-MAP.md)：稳定模块 ID、状态所有者、依赖和验收边界；模块规格现已展开，项目级未验收项保留在台账。
- [逆向调查报告](docs/reverse-engineering/workbuddy-report.md)：已观察的功能、规则、证据与缺口。
- [页面与表单台账](docs/reverse-engineering/runtime-inventory.json)：不含真实用户/业务字段值。
- [逐页面/表单能力台账](docs/reverse-engineering/page-capability-ledger.md)：每个控制台页面/表单的观察证据、实现位置、验证与缺口，`npm run ledger:check` 校验不漂移。
- [HTTP 观测台账](docs/reverse-engineering/observed-http.json)：URL 模板、方法、状态及值脱敏后的结构。
- [发布脚本静态台账](docs/reverse-engineering/static-inventory.json)：路由/调用候选、文件摘要和源位置。候选不是已验证的服务端契约。

原始页面文本、截图、发布脚本缓存与 REA Evidence 保存在本地 `evidence/workbuddy/` 并由 Git 忽略；不会提交用户业务数据、授权回调参数或上游密钥。

## REA

已从用户指定的 <https://github.com/Jas0nxlee/rea> 安装源码构建版 `6.4.0`，CLI：`~/.local/bin/rea`。MCP 和匹配技能已配置；本轮使用 CLI 完成实际调查。新 MCP 配置需由 Codex 在重新连接时加载。

```sh
rea --version
rea doctor --client codex --json
rea analyze-javascript-application "$PWD/evidence/workbuddy/public" --format json > evidence/workbuddy/rea/static-application.json
node scripts/extract_bundle_inventory.mjs evidence/workbuddy/public /Users/ljp/.local/share/uwork-tools/rea
python3 scripts/build_research_index.py
```

浏览器使用现有企业微信登录会话，通过 `browser-harness` 操作。`scripts/capture_workbuddy.py` 是由 harness 预注入 CDP helpers 的采集辅助脚本，不应单独作为 Python 应用运行。

```sh
browser-harness <<'PY'
exec(open('scripts/capture_workbuddy.py').read())
# 先通过 harness 选择自己的已登录 WorkBuddy 标签页，再按菜单采集。
capture_page('models', 'AI 资源管理', '模型管理')
PY
```

采集打开页面、标签和未提交表单；未提交正式资源保存/发布/删除、购买、创建 Key 或任务执行。菜单取消编辑会请求服务端清理草稿，本轮观察到该 DELETE；不能声称页面浏览完全没有副作用。真实业务写行为尚未验收。后续实现和测试使用自有后台与受控环境。
