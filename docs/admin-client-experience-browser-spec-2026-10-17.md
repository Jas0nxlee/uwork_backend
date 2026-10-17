# 四类控制面与配置作用域的真实浏览器验收

本增量承接 `admin-client-experience-spec-2026-10-17.md` 的 18 项源码测试，只执行独占真实 HTTP/浏览器验收。不得修改主 `admin/dist`、主 3000/PID 37266、客户端 out 或已冻结的 admin 源码；发现缺陷先保留 RED 并通知 Root 重新构建独占产物。

## 静态资源、请求和身份隔离

旧 RED 读取已留存的正式 `scope-old-assets`；新 GREEN 读取 Root 的最终 `owned-admin-artifacts.json`。每次运行核对全部源/产物 SHA，再复制所需静态文件到本次独占目录后以原字节提供，不在测试中编译资源。主 admin/dist 全量 SHA 在前后核对不变。

每阶段有独占 0700 临时根、SQLite、合成双组织同用户、自有 Chrome/incognito profile、短路径 BH_HOME 与三个动态 loopback 端口（frontend/backend/CDP）。frontend 先监听得到精确 origin，再创建真实 `createApp({publicUrl: frontendOrigin})`。静态资源从本次 snapshot 提供，`/api` 只做真实 HTTP 原样转发，保留 Origin、Cookie、请求体、状态码和响应体；不覆盖 fetch、不返回伪造业务数据、不注入 React/store 或合成 input/change。

`BH_RECORD=0`、telemetry 关闭。账号密码和 bearer token 只在 fixture 内存与正常登录过程存在，不写日志、环境文件或截图。所有浏览器动作通过 browser-harness 原生 CDP 鼠标/键盘；JS 仅只读 DOM。HTTP 交叉验证另行标记，不能记作 UI 提交。

## 真实旧/新竞态

1. 初始准备仅将同一合成用户加入 A/B，并通过真实 API 为两租户发布不同的新对话欢迎语；两侧 revision 一致。浏览器真实登录并选择“客户端定制 / 新对话”。
2. 仅在自有后台 onSend 暂停 A 的真实 GET 已计算完毕的原响应，记录实际 A payload 摘要，不修改它。浏览器在该响应被暂停时，通过真实“当前组织”select 切 B，同 kind 的真实 B GET 完成并显示 B 欢迎语。
3. 释放原 A 响应。旧正式资源应复现 header=B、表单=A；实际点击保存可将 A 草稿通过 B 路径保存，后台真实返回成功，已发布 B 内容仍独立。该结果记为旧产品 RED，不冒称后台权限绕过。
4. 新产物在同一事件顺序下必须保持 B 草稿与 revision，pending 时禁写；释放 A 不污染表单。实际保存只提交 B 数据。旧成功/失败的单元场景继续由源码测试覆盖，不以模拟请求代替本组真实响应证据。

## 四类结构化表单

新产物在当前 B 租户执行四类完整生命周期，每一阶段都由浏览器保存/发布/弃草稿，后端 GET 与 `/api/client/configuration` 分别交叉验证：保存草稿后客户端仍是原发布值；发布后 data/version 精确更新；另存未发布修改后再放弃，draft 回到 published，发布版本不变。

- scenes：通过按钮增删三种模板，填写中英文标题/提示词、图标、导航动作、pluginStableId、cron 和错峰说明。非法 cron/保留 ID 时禁写，恢复合法值后提交。
- help：中文/英文 HTTPS 社区、外部反馈 URL；非法 HTTP 地址时禁写，空值/关闭按 null 处理。
- desktop：两个开关、合法 ratio 和分组；0.21 时禁写，合法 0.1 后提交。不激活任何客户端遥测或权限。
- plugin-store：启用 code/work 可选模式，分类及插件 ID 增删/上下移动；`__proto__` 原始分类键必须使表单无效而非静默丢弃，删除后再保存。另存 null 草稿后弃草稿，恢复已发布顺序。

为四个 tab 分别采集 320/768/1024/1440 宽度的安全截图与只读文档宽度检查。动态滚动容器可横向滚动，文档本身不能溢出。

## 证据与清理

`scripts/admin-client-experience-ui-smoke.ts` 拥有静态/API proxy、真实后台、gate 和检查点；`scripts/admin-client-experience-ui-browser.py` 只驱动实际 DOM；共用 test-only 自有浏览器生命周期 helper。每次 ignored evidence 新目录保留两个阶段的资源 SHA、脱敏 DOM、HTTP 收据、server draft/published/version、旧不变量失败和新 GREEN、布局截图与清理结果。

驱动或准备错误单独保留，不能强造产品失败。最终释放所有 gate，关闭自有浏览器/BH、frontend/backend，逐 PID 和端口确认，再删除本次 root/BH。未知 daemon、仍在运行的进程或端口未关时判失败并保留根；外层再次核对 fixture PID 退出。无模型生成、付费服务、真实企微、MCP/网盘、终端凭据签发或 remote model/Provider/command 探针。

## 驱动焦点与后续独占 TLS 支持

输入前通过原生 CDP `DOM.focus` 确认目标确为 `document.activeElement`，再以真实键盘选择/替换文本；只读断言验证最终字段值。坐标点击后布局变化造成的错误焦点属于驱动错误，保留失败轮记录，不能计作表单故障。

`OwnedAdminBrowser` 可接受一个可选的 `trustSpkiSha256`，仅供后续同后台 Native 的自有 TLS proxy。构造时必须拒绝非 canonical base64、非 32 字节摘要、多个值、逗号、空白、换行或 URL-safe 变体；通过时仅向本次独占 Chrome 传入单一 `--ignore-certificate-errors-spki-list=<digest>`。默认不加任何证书例外，不使用全局忽略证书开关。以不启动浏览器的纯校验测试先复现缺失校验，再实施。
