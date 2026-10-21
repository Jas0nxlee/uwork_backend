# 原文件回滚、冲突恢复与实际修复

本轮新增3类未覆盖的原页面消费者，均为当前未打包Main/Host/UI/CLI、真实HTTP/SQLite、生产Read/Write、只读canonical selector及本机受控供应商；旧普通编辑/Fork/队列/批删流程未重跑。每个case的Read/Write及一次原allowOnce是变更前置，唯一业务文件位于新建私有Git工作区owned-rewind.txt，不修改用户文件或Git全局配置。

| 原消费者                  | 结果与计量                                                                                                                                                                                                                                                                  |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 组合“对话+文件重置”v34    | 预检发现外部改动时显示冲突，文件/active历史/完整账本与供应商保持；取消弹框、外部撤销自己的改动后，原组合入口先恢复初始UTF8字节再请求模型E。当前5笔110Credit，reload零增。                                                                                                   |
| 冲突后“仅重置对话”v35     | 保留外部编辑字节，原入口只重置对话并执行F一次；供应商在F请求时独立读取并确认仍是外部内容，reload保持。当前5笔110Credit，无文件回滚。                                                                                                                                        |
| 独立文件摘要“撤销”v37→v38 | 原安全预览关闭零写入；预检后才外部编辑时，原确认被Core正确拒绝。v37前端错误关窗为真实RED；修复后v38保留最新unsafe preview/禁用确认/显示失败。重新原预检和确认后恢复初始字节、摘要已撤销，原对话保留，reload不重放。原4笔88Credit，预览/失败/安全撤销/reload全部零推理增量。 |

三个case另一成员原两笔完整ledger行逐字保持，所有已结算旧行原值保留。Read/Write真实调用与实际文件字节相互核对，fixture不代生产工具写入；控制器只准备初始文件、模拟明确的外部编辑及撤销该外部编辑。初始文件含中文行，完整还原不只比较存在性。外部MCP/网盘/企微/远程与发布后多系统客户端均未调用。

## 产品缺陷与修复

ConversationFileSummaryPanel原handleApply只看CommandAck.status=accepted/duplicate便关窗，忽略result.applied。该状态表示命令被处理，Core文件事务仍可能因晚到修改返回applied=false。v37原结果中dialogVisible=false，而测试文件仍是外部内容、完整账本/原对话未变，原失败证据保留。

修复仍由原组件持有preview/error/applying/dialogOpen：只在匹配applyFileRewind且applied=true时关窗；失败采用返回的当前preview并显示现有本地化错误，缺失/错误result也不关窗；不自动重试，不改Core/RPC权限、文件事务、样式或新建状态所有者。实际v38弹框明确显示“当前文件已被外部修改”，确认禁用；后续明确安全重试和刷新通过。

执行原handleApply闭包的7项定向回归：有效RED为3失败/4通过，GREEN为7/7；覆盖accepted/duplicate两类实际结果、无结果、pending/拒绝/异常。第一次测试提取器的return换行错误导致f.run非函数，仅属设施失败，随后用完整return语句转译取得有效RED；未把它计为产品复现。

## 源构建与设施处理

v36在原60秒ready前超时，没有业务动作；Node随后处理关闭命令，fixtureExit0/cleanupVerified，4个记录端口均已拒连、私有根删除，原失败status保留。现场生成目录6742文件中79个带数字后缀，Node复制FD停在material-icons/svgo 3.svg；此前正常清理构建后曾为6663/重复0，因此没有反复清理求绿或把底层原因武断归于某个系统组件。

新增正常构建→工作区外专用缓存→本case逐字复制路径，仍验证5087源输入与全部6663产物条目/目录数，不过滤文件、不跳过校验/扩预算。缓存损坏、源变化、越界清单3项合同通过；第一次临时测试目录因/var和/private别名不canonical而失败，修正测试根realpath，保留原严格guard。原RED缓存在产品UI改动后也实际被拒，必须重新正常构建；RED/GREEN缓存源清单仅一个文件变化：ConversationFileSummaryPanel.tsx。其余5086输入一致。

该来源机制由专用prepublish wrapper接入，未提交或吸收已有脏client-native-enterprise.mjs等无关修改；原snapshot复制器未改。两份缓存保留为构建产物，没有运行进程，不冒称缓存目录已删除。

## 门禁与资源

- 原UI产品RED v37→GREEN v38；v34/v35各自独立通过，不用它们冒充修复后的重复全量。
- 新回归7/7、缓存合同3/3；pnpm typecheck（含Main）通过，pnpm lint为114条既有警告/0错误；架构前后0违例，目标oxfmt/根MJS ESLint及Python AST通过。
- 正常未打包构建通过；没有生成安装包或发布。架构上下文为现有legacy ui模块，无新增跨模块API；可变状态仍在原FileSummaryPanel，文件事务归原Core。
- v34/v35/v36/v37/v38的独立记录端口全部ECONNREFUSED，已启动的Electron PID不存在，原cleanup.errors为空、fixtureExit0，私有运行根已删除。独立总复核覆盖账本全部字段、UI失败状态与RED/GREEN源码差异。

证据：[独立总复核](../evidence/prepublish-continuation-20261021/edit-file-rewind-final-verification.json)、[v34组合](../evidence/client-native-prepublish-v34-20261021/result.json)、[v35保留外部文件](../evidence/client-native-prepublish-v35-20261021/result.json)、[v37产品RED](../evidence/client-native-prepublish-v37-20261021/file-only-late-conflict-ui.json)、[v38产品GREEN](../evidence/client-native-prepublish-v38-20261021/file-only-late-conflict-ui.json)、[v38完整流程](../evidence/client-native-prepublish-v38-20261021/result.json)。

门禁：[定向有效RED](../evidence/prepublish-continuation-20261021/file-only-rewind-callback-red-v2.log) / [最终GREEN](../evidence/prepublish-continuation-20261021/file-only-rewind-callback-final.log)、[类型](../evidence/prepublish-continuation-20261021/file-only-rewind-client-typecheck.log)、[Lint](../evidence/prepublish-continuation-20261021/file-only-rewind-client-lint.log)、[架构](../evidence/prepublish-continuation-20261021/file-only-rewind-architecture-after.log)、[缓存合同](../evidence/prepublish-continuation-20261021/file-only-cache-input-contracts-green.log)、[旧缓存拒绝](../evidence/prepublish-continuation-20261021/file-only-old-cache-rejected-after-fix.json)。

新profile运行PREPUBLISH_REWIND_FILES=1；加PREPUBLISH_REWIND_FALLBACK=1或PREPUBLISH_FILE_ONLY_REWIND=1分别选择两个独立分支。建议先node scripts/build-owned-desktop.mjs正常生成当前缓存，再将输出manifestPath设为UWORK_NATIVE_OUT_MANIFEST；不是必需修改产品配置。整个目标继续active，未宣称全项目覆盖。
