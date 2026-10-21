# Mac ARM64：原UI安装插件到Skill正文后继请求

2026-10-21一次真实Native运行通过4项检查，Root独核29项、coverage独核37项全部通过。原UI从本轮loopback来源安装纯文本插件，再在当前工作区新任务发送一次；原Skill工具的完整两行正文及真实baseDirectory进入同一个call_id的后继模型请求。目录存在、安装卡片和最终回复均未单独作为正文消费成功证据。本例没有发现需要修改产品的新问题。

- [Root29项独核](../evidence/client-native-packaged-macos-clock-arm64-plugin-skill-v1-20261021/root-independent-verdict.json)
- [coverage37项独核](../evidence/client-native-packaged-macos-clock-arm64-plugin-skill-v1-20261021/coverage-independent-verdict.json)
- [原result](../evidence/client-native-packaged-macos-clock-arm64-plugin-skill-v1-20261021/result.json)
- [三阶段真实收据目录](../evidence/client-native-packaged-macos-clock-arm64-plugin-skill-v1-20261021/)
- [独立资源收口](../evidence/client-native-packaged-macos-clock-arm64-plugin-skill-v1-20261021/owned-independent-closure.json)
- [冻结计划](../data/sandbox-verification/client-native-packaged-macos-clock-arm64-plugin-skill-v1-20261021/preparation.json)
- [原场景规格](client-macos-plugin-skill-body-consistency-spec-2026-10-21.md)

## 固定来源与原安装链

使用正常ARM64 v10原签名包，manifest SHA `5f88bd045a31e535215b603933da2d4940fad70f37b7e66aa50b0f6be169c475`，source `d0a5f374`、Agent `cdf781ec…`、9项运行资源与12个ARM64原生文件不变。profile为`client-native-packaged-macos-clock-arm64-plugin-skill-v1-20261021`，plan SHA `5f6b9ac948e87574877bfc289fe885c2bf55a9391282e0fe4036c117b35c11ad`，37源冻结；旧44源未改。

使用原Common、onboarding、OS guard、私有BH与原workspace副实例函数1c/10秒期限；没有复制Main、E2E/store注入、业务RPC发送、手置install record、替换SkillPort或传入插件加载根。正常experience模式使用既有strict v10 loader，未带hold/file/primary模式，也未重跑warm7/File/PTY/cold来增加检查数。

原正式配置GET→PUT→publish并GET回读了三门：`security.allowFilesystem=true`、`security.dangerousSkills=true`、`personal.skills=true`；security/personal均version1、revision2。受控模型contextWindow500000来自原Admin配置前置，完整工具定义与原gateway guard保留，未因本例改生产估算或宣称所有128k模型适配已过。

插件ID为`uwork-native-bridge-plugin@uwork-native-bridge-market`，Skill alias `uwork-native-bridge-plugin:bridge`。自有包仅含两份0644文本文件：117B `.zcode-plugin/plugin.json`和140B `skills/bridge/SKILL.md`，没有MCP、Hook、Command或可执行脚本。525B ZIP SHA为`71dcfe314333a9f85cffba2d45e4f44e23d930c3d963bb5dda115276bd2a43d4`。包服务复用原受控supplier listener，仅精确响应本轮两个GET/HEAD路径，不新增listener，也不拦截官方目录。

原UI依次Settings→Plugin User→添加来源，输入本轮`/owned-native-skill/marketplace.json`，提交并点击同ID安装按钮一次。实际metadata GET1、ZIP GET1、HEAD0；原installed strip和同ID User管理行双重读回，enabled=true、busy=false、pending0。安装阶段模型/计费没有增量。默认市场目录的读取不算官方市场验收。

## 同call_id的真实消费

安装后原User行打开同ID详情、原“更多详情”显示安装根路径；未通过RPC或读写安装记录取得该值。随后原设置导航清除商店返回来源，Back回原工作区，经`enterprise-menu-chat`新草稿；原draft显示`packaged-workspace`、同受控模型与reasoning none。

原Composer发送一次固定RUN prompt，只含alias，不含正文sentinel。实际新task/session为`sess_c1d37e60-74c9-4d64-a329-eae8080a768f`，原UI完成，title为`Native installed plugin Skill bridge`。任务运行态`uiTask.workspace`实际为null，不冒称该DOM展示绝对路径；同工作区由原draft和实际supplier系统cwd精确匹配证明。

三条新增供应商请求分别为：

1. 主请求stream=true、原32工具、真实cwd匹配；受控供应商发出原`Skill`调用，call_id为`native-installed-skill-call-20261021`，目标是上述已安装alias。首请求与用户prompt均不含正文sentinel。
2. 原工具执行后，后继实际请求含assistant同call_id及`role=tool`同tool_call_id，工具结果包含完整连续两行正文，而非只匹配标记：`Read-only local acceptance note.`及`UWORK_NATIVE_PLUGIN_SKILL_BODY_20261021`。按原NodeSkillAdapter去frontmatter并trim的body fragment SHA为`d611c6e5a82114cc000ec3eed045f15732fcdcb25277626721d98e185c96803e`。同结果中的`Base directory for this skill`绑定本轮真实安装路径；检查通过后才返回最终完成文案。
3. 原title sidecar独立stream=false，精确997B system SHA `d3d0746e09609cd62773e0df8957adbbb35199c7b214f27329513090cc431383`，不含正文，不拿标题请求代替主请求或后继正文证明。

后继收据对本case实际文件执行只读realpath/lstat/无symlink与内容hash检查：manifest SHA `4e1e66113ef32fc68fedf5b4aeded8dfc576b1d6064493816c576df9ae0ce4e3`，SKILL SHA `874cc0101215dab45a019022fd23fc60aa95527e7102058eaef88c365419be50`。相对插件根为`data/.uwork/cli/plugins/cache/uwork-native-bridge-market/uwork-native-bridge-plugin/1.0.0`，baseDirectory是其`skills/bridge`。这是实际读回路径，没有靠猜测默认.zcode/.uwork位置得出。

oracle的`installationCacheMembershipVerified:false`如实保留：它本身只证明工具目录与文本文件；独立的原User详情`rootPath`与该attested相对根在同caseRoot下精确相等，`installationRootMatch.exactMatch=true`，构成安装归属的复合证据，不把oracle单项改写成独立安装记录验证。

## 计量和收口

当前甲实际role为operator，乙为同tenant另一department的member。原乙seed2次调用/2settled/44 Credit保留。安装前后当前仍0；一次Skill任务产生主调用、正文后继、title共3笔settled/66 Credit、36 input/30 output Token，新增3条succeeded Trace及3个完成gateway结果。原raw inference POST和供应商请求总量2→5，5个响应均200；乙原2/44及全部原行保持。未虚构Trace与request_key逐请求外键。

原controller句柄自然exit0、fixture exit0、cleanup errors为空。13个known PID及BH daemon共14个PID独立确认不存在，4个TCP端口关闭；私有0700控制目录保留的Unix socket节点拒绝连接。原协议关联恢复，系统clipboard未使用，37源前后SHA稳定；自有安装缓存保留在私有caseRoot，不称全部文件已删除。正常后台PID92288和Stopped VM未触碰，没有自动重试或启动下一例。

本例补齐的是新正常Mac原包的Native安装→原Skill→实际后继正文链，未重复计算旧推荐卡或Host/CLI切片。它不覆盖任意插件代码、真实企微、外部MCP、网盘、Windows或尚未可达的原UI重新认证。
