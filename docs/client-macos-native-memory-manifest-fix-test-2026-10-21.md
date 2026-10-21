# Mac Memory manifest 权限修复与真实回归

本轮仅继续 Mac；Windows 联测已由用户取消，Linux不再增加客户端测试。发布由用户使用 GitHub Actions，本轮未推送、发布或替用户运行发布流程。正常 ARM64 v16 已完成 manifest 拒绝场景和原自动提取链路回归；不能据此称所有 Mac 功能均已验收。

## 已确认问题与改动

正常 v15 的原界面四词任务，在后台明确 filesystem=false、execution=true 时，自然提取仍把已存在话题文件 frontmatter.description 发到第6号零基非流式请求。index 文件不存在，描述不在用户输入中，154B原输入与原始请求已保存。[修复前实际报告](client-macos-native-memory-manifest-filesystem-denied-test-2026-10-21.md)。

本地独立提交 `d14eef850eca3fd5c76c82a5243b4f72d4ffc3e5` 只修改四处既有生产边界并加入永久测试：复用权限 port/同 call ID 与 owner，固定内部消费者 ProjectMemoryManifestRead 在扫描前准入、扫描后复核，原 scheduler signal 竞速，最后 await 后同步核 scope、Memory 配置、FS/企业 port。拒绝不触发 sidecar、不推进成功 cursor，普通主任务仍可正常完成。合法 live cd 不改变原后台 snapshot cwd。未增加产品计时器、RPC、权限缓存或模型工具。

完整企业策略回归为225 Core +316 services=541，通过且零跳过。33项 Runtime与51项 Shared/Host 定向检查均通过（它们与完整回归重叠，不相加充数）；根/CLI 类型与lint、架构检查通过，原根lint114警告保留。[源审与门禁](../evidence/client-project-memory-manifest-admission-tdd-20261021/root-source-review-and-gates.json)。

## 正常 v16 真实结果

| 独立用例 | 实际结果 | 证明范围 |
| --- | --- | --- |
| 已有topic、显式filesystem=false | 6/6，21.243秒；raw/supplier共6条，只有新Main+原997B title，没有描述或提取请求；新两笔44 Credit，原current行及other全actor不变 | 描述在观察窗口内未外发，Memory On与四词任务真实成立；扫描前listing/range read=0的因果证据来自独立Runtime测试，不冒称Native系统调用计数 |
| 已有topic、显式filesystem=true | 6/6，21.318秒；raw/supplier7，新Main4/原标题5/唯一sidecar6，实际mtime经原builder形成精确提示词，32工具与主前缀/原回复完整保留；SDK同SID stop/0、三新增HTTP finish/noabort | 正常授权读取已有description和自然单轮提取成立；文件仍154B、无index；本人5 settled/110，旧本人及other全行不变；原quiet3和清理闭合 |
| 原自动提取、filesystem=true | 8/8，25.793秒；raw共10条，A自然两次sidecar，3个原call ID、两个允许Write与一个本case MemoryRoot外Write拒绝；B实际消费新index；原seat/logout/cold零重放 | 原自动提取及写回未被修复破坏。初始manifest为空，不能替代已有topic description的允许读取正控 |

[拒绝场景独审](../evidence/client-native-packaged-macos-clock-arm64-memory-manifest-fixed-denied-v2-20261021/peer-actual-verdict.json) · [自动提取独审](../evidence/client-native-packaged-macos-clock-arm64-memory-extract-v16-v2-20261021/peer-actual-verdict.json)。

拒绝场景保留同一154B topic、SHA `bd52e9b0a7f463ce69b8a2d757978978b7a437d2bb7198382184ee09dd6dcfac`，无MEMORY.md；原3秒静默观察执行，12个记录PID、4端口及harness、OS恢复证据闭合。自动提取的index为85B、SHA `5616978683291df909298cff62750a39648c00d63b734958653dbb933adf62c8`；topic为374B，经原origin-session函数准确盖A会话ID。该Auto用例记录20个PID；原每阶段0.25秒复核保持，不写成专门3秒轮询。两用例fixture均exit0、cleanup=[]，不把清理取消当应用菜单Quit。

两个sidecar的原SDK完成日志为 tool-calls/3 → stop/0，所有新model ledger settled/trace succeeded。B之后原seat负例正常追加第二轮用户/错误消息，因此最终B有4条durable消息；阶段B的首轮模型与index读取已单独核对，不要求最终历史停留在两条。

## 包与设施边界

v16为原完整CLI→stage→runtime prepare→Desktop→electron-builder正常路径，CJS三份一致且含新修复，84源绑定，9资源/12 ARM native、原ASAR原始UTF8 header/Info、fuses与strict codesign通过。[固定manifest](../evidence/client-macos-package-v16-arm64-memory-manifest-manifest-20261021.json)，SHA `aca34443c6adcd0ad203508edef1cc8bdc85e65df6b561ad880755dd50921118`。它是本地ad-hoc QA包，未公证或发布；静态Go和NativeGo分别留证。

v15 v1 seed丢换行、v16 v1 startup model缺席等设施失败都保留原FAIL。草稿启动允许无初始模型，startup日志不随后补值；新只读观察器仍核same-session启动Memory/cwd/use/extraction，并要求唯一固定runtime/model_selection原codec、真实user.modelSelection与完成assistant模型一致。startup model若存在仍精确匹配，缺席明确deferred，不补默认值。25项纯正反例及实际原失败case只读对照通过，原失败未改绿。[设施收据](../evidence/client-macos-memory-v16-readonly-model-witness-20261021/quality-result.json)。

一项新双模式设施生成曾被自动审查中止，该未完成路线未用于上述验收；实际采用先前已运行用例的单一artifact重定向，并经独审、固定计划后执行。

单一已有topic允许读取正控已通过[独审](../evidence/client-native-packaged-macos-clock-arm64-memory-manifest-allowed-v1-20261021/peer-actual-verdict-manifest-permission-review.json)，该独立边界现已关闭。当前尚待原菜单活动任务Quit完整Cancel/Allow，以及Mac x64完整包/联动。x64 v17因本机Swift兼容库缺x64 slice而严格NoGo，不能以四条命令exit0替代缺失的第12项native资源。原Mac/外部认证与物理硬件边界继续按各报告记录。
