# 插件安装到 Skill 正文消费桥联测（2026-10-19）

**G04i v5实际通过。** 本次使用普通成员真实 email login/me 确认身份、角色和席位，再接原 Host 私有会话；admin仅负责控制配置。本次从 email 登录恢复的身份开始验证Host/CLI正文链路，不替代[G04h空身份Native原登录](client-native-primary-login-progress-2026-10-18.md)，也未重演G04f的Native安装生命周期。

本次受控包仅有manifest与A/B两个SKILL.md三文件，manifest指定非默认 `bridge-skill-bundles` 根，不含MCP、Hook或可执行脚本。实际链路保持原PluginManagementService→Host→新正常打包CLI→插件安装记录/启用状态/manifest根装配→原NodeSkillAdapter，没有另建消费接口。

- 实际自有HTTP下载市场清单和包，三文件的字节、SHA与安装路径精确核对，非默认根装配及qualified aliases正确。
- 禁用时新App D的session catalog无插件技能；启用后另一个新App S发现A/B及原别名。D/S不同，metadata阶段模型与账本增量均0；不自创已建App热禁用语义。
- 同S原发送A一次，供应商返回固定Skill tool_call_id。正式工具结果的A原正文与baseDirectory进入对应后继模型，不能用目录存在或固定完成文案替代消费证明。
- 发布并回读 `personal.skills=false` 后，同S原发送尚未消费的B一次；正式工具结果拒绝，B正文在本轮所有模型请求中均缺失，历史A允许保留。
- 恢复权限后原目录重新出现A/B，无额外模型或账本；本轮恰好两次原发送。

baseline模型/ledger/Trace全0。实际 **2次A主请求＋1次标题＋2次B主请求＝5模型请求，5笔settled、5条Trace，25 input/10 output Token、45 Credit**，均归该普通成员与所选模型。gateway request与ledger按真实 `(tenant_id, request_key)` 复合键关联；Trace及受控supplier为独立通道，不伪造逐请求关联。

修复分层记录：

- 测试夹具修正：复用原 `getCliStorageRoot` 的cli层目录，接原runtime.modelSelection readiness并传递原解析得到的完整selection，不放宽生产Registry或切换v4入口造通过。
- 产品修复：legacy create将完整model误转provider/model字符串而丢options；真实合同RED2→GREEN9，缺失/非法档位仍拒绝，独立thoughtLevel语义与权限不变。详见[修复、清理合同及标准验证报告](client-legacy-model-selection-test-2026-10-19.md)。

采用新正常CLI/stage `03adc56b7687a0ca74ce7839aea13f42fef9bdb2fdc5e6d94a439c5a047e84dd`（16,575,520 B），7,325 tracked客户端来源、新正常Desktop构建与根/CLI类型、Lint、架构均已记录。旧Native/Web各候选保留，不宣称在这份新产物重跑。

v1–v4的实际失败均在发送前、模型0，原公开封存保留；失败phase不是唯一根因证据，不删除失败或把全部测试装配问题归为产品缺陷。v5测试进程的原PTY实际exit0；4个已知PID、4个端口闭合，私有根保留，不据此声称已删或零写者。

公开证据：[v5最终manifest](../evidence/client-plugin-skill-bridge-v5-20261019/manifest.json)、[business-result](../evidence/client-plugin-skill-bridge-v5-20261019/business-result.json)、[catalog-proof](../evidence/client-plugin-skill-bridge-v5-20261019/catalog-proof.json)、[supplier-proof](../evidence/client-plugin-skill-bridge-v5-20261019/supplier-proof.json)、[http-proof](../evidence/client-plugin-skill-bridge-v5-20261019/http-proof.json)。

- manifest：29个公开文件、23,281 B，SHA-256 `912b3371b8f6a80b71d99b5d0b694b49e2d610916e3db58bbdbceeadce632c15`。
- [result.json](../evidence/client-plugin-skill-bridge-v5-20261019/result.json)：`9a87917ff4ebccafa831e3c8e84259a237022a11d79030ab246493b2eeb50b32`；[原PTY终态](../evidence/client-plugin-skill-bridge-v5-20261019/original-pty-terminal.json)：`214e25db76db6edee82d37ced954c58a3f32202fb160c4fe7bea79f4aab4bde7`。
- Root于19:42:29.804 UTC[独立核验](../evidence/client-sharing-followup-root-review-20261018/plugin-bridge-v5-public-independent.json)29文件全部SHA、上述业务/关联及4已知PID消失、4端口ECONNREFUSED；未读取保留私有根或查询未知holder。

本机当前可运行的独有切片已完成；U02–U05及T13整体仍保持原状态。真实企微、外部MCP、网盘按用户要求排除；本结果限自有受控包、普通成员Host/CLI和本机供应商，不替代官方市场、任意插件代码、目标平台签名安装或生产发布验收。
