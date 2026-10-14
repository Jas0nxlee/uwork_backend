# UWork 企业管理后端

主仓库：<https://github.com/Jas0nxlee/uwork_backend>。配套客户端：<https://github.com/Jas0nxlee/UWork>。

根据 WorkBuddy 企业控制台可观察的页面、策略、接口和运行行为，独立实现企业管理后端与管理 Web，再适配 UWork 客户端。

**当前阶段：逆向证据与模块边界评审。主仓库原为空仓库；尚未实现业务后端、管理 Web 或客户端改动。**

## 本轮产出

- [能力地图与实现顺序](CAPABILITY-MAP.md)：稳定模块 ID、状态所有者、依赖和验收边界，待评审后展开模块规格。
- [逆向调查报告](docs/reverse-engineering/workbuddy-report.md)：已观察的功能、规则、证据与缺口。
- [页面与表单台账](docs/reverse-engineering/runtime-inventory.json)：不含真实用户/业务字段值。
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
