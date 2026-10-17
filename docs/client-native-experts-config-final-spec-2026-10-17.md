# Host catalog FIFO 后的同版 Native 企业专家与 context 验收

本轮只验 Root 统一 Desktop-only 构建后的真实 Native。CLI 与 stage 保持 `39175fd59577db9c2e80519170ab33e96e622f22c8cb86f18bf3241e2507d43c`；必须收到新正式 manifest 后才能读取/复制 out 或启动夹具。旧 Host CAS RED、SWR GREEN 和旧产物证据保持原样，不用历史结果替代新候选。

## 独占边界与前置

- `UWORK_NATIVE_FIXTURE_NAME=client-native-experts-config-final-20261017`、`UWORK_NATIVE_CLIENT_EXPERIENCE=enabled`，现有夹具使用 Node 24.14.0 和 tty；不新增产品模式、不改 CLI/protocol/product source，不注入 React/store/业务 RPC。
- launch 前依次等待现有 finite controller 完成：真实 `configure security` 发布 `allowFilesystem:true`（合并保留其他默认）；`expertCreate` 真实创建/审核/发布 `native-enterprise-expert`，并只在 owned home 放同名 personal shadow；真实 `configure desktop` 发布 `desktopContextPrompt.enabled:true`；真实 `configure scenes` 发布 draft/scheduled/offPeak 三组独占初值。
- 专家正文固定为 `NATIVE_APPROVED_ENTERPRISE_EXPERT_V1`，个人 shadow 为 `NATIVE_PERSONAL_SHADOW_MUST_NOT_REPLACE_ENTERPRISE`。现有受控供应商仅在真实用户消息包含“运行企业专家”且当前正式 Agent tool 可用时返回原 Agent tool call，子任务 prompt 为 `NATIVE_ENTERPRISE_EXPERT_CHILD`。不增加业务入口或替换真实 HTTP/资产校验。
- BH 使用 `BU_NAME=default`、本轮 CDP 与短独占目录 `/tmp/b/ef-w`、`/tmp/b/ef-c`；只绑定 appRoot 下已有 renderer，坐标输入前核对 URL 与稳定 DOM box。不得操作 Root Native/Chrome 或创建 Electron 不支持的新 target。
- 主服务/主 .env/DB/Vault、旧 Root profile 和外部 checkout 不接触。无真实企微、市场、MCP、网盘、远端/付费模型调用，也不重试先前被安全审查拒绝的探针。

## 必需路径与通过标准

1. 核对新 manifest 的全部源与六产物 SHA、整个 out 快照、owned 进程/端口，以及真实 appPath/isPackaged=false。保存 launch 前后台 published proof。
2. 首启实际连续跳过三步 onboarding。真实 Native 输入并发送 `运行企业专家 EXPERT_CONFIG_FINAL_WARM 请完成受控验证`，等待原 UI 完成。
3. 立即通过现有 `experienceSnapshot` 保存本机供应商实际收到的全部正文和真实 API 账本。以本轮发送前后的请求索引作边界，必须同时满足：
   - 真正 root 请求的当前用户消息含本轮 WARM 标记，正式 tools 包含 Agent，system 中有 `# UWork Desktop Context`。
   - 至少一个真正 child 请求的 system 含批准企业正文，当前用户消息含 `NATIVE_ENTERPRISE_EXPERT_CHILD`；所有该 child 的 system 均无 Desktop 段。
   - 本轮所有请求均无 personal shadow 正文；不能出现 Agent not found、catalog denied/CAS conflict 后仍当成功的情况。仅最终 UI 文本或父模型回复不算专家通过。
4. 真实进入自动化，定时模板出现；点击后实际 title/prompt/每工作日09:00 与发布值一致，再通过表单面包屑返回取消，不创建定时任务。返回对话的新草稿仍有建议卡；点击准确填入普通 prompt，未安装 pluginStableId 不插入 mention。
5. 保存第一代日志、runtime、已知 PID 后，仅 stopNative；确认第一代子进程与 BH/CDP 退出，保留后台/identity/发布数据。同 profile 冷启动，在新的真实 task 中发送 `运行企业专家 EXPERT_CONFIG_FINAL_COLD 请完成受控验证`，再次按供应商实际父/child 正文作独立断言，并复验模板/新草稿。

任何子正文缺失、父/子 Desktop 段错误、personal shadow、402 或 CAS 拒绝都单独保留；不改预算/账本来覆盖结果，不用 UI 回复掩盖失败。不为复现 race 注入 Host 状态或强制修改产品时序。

## 证据与收口

每轮保存实际正文/AX/截图/表单 DOM 值；模型证据以原 `experienceSnapshot` 为输入，由只读 analyzer 输出请求索引、正文 SHA、批准标记、Desktop/个人 shadow 判据和账本，不复制凭据。本夹具全部是受控 200 响应且无重试，前后两份快照各自的 modelCalls 必须等于实际正文条数；本轮新增正文数必须等于新增账本行数且全部 settled。已有一个 settled 行不能掩盖少记 child 账本，额外无请求账本、计数变化和旧行改写同样拒绝。每代 electron/runtime 日志单独归档。

结束沿用原 close，核对全部已知 fixture/Main/Host/CLI/helper/BH PID、supplier/backend/HTTPS/CDP 端口及 owned root 已退出/删除；仅删除本次 BH 子目录，保留 `/tmp/b` 及其他任务目录。重新核对正式源/产物 SHA，输出 manifest。生产打包安装、原生 chooser、offPeak 不可达入口和外部服务不在本轮验收范围。
