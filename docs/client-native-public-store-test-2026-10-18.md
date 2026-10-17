# Native 公开插件商店排序与发布实测

真实公开目录、正式 CLI、私有身份后台配置和原生商店的指定排序链路通过。实际46个条目分为生产力22、开发者工具10、金融14；两种模式均验证了草稿不生效、发布后分类和类内顺序生效、未配置条目的原有顺序、虚构ID不生成条目，以及恢复 `order:null` 后回到原顺序。Root独立离线重建了八组模式/阶段的全部46项顺序。

运行 profile 为 `client-native-store-order-20261018`，专属 BH 为 `/tmp/b/so`。在正常工作区第二实例入口前，已固定原Main9992及Root target；secondary10189正常退出0后原Main/target保持。全程使用真实鼠标/键盘输入和只读DOM/AX，没有调用业务RPC、注入React/store、预写catalog/installed记录或点击插件卡片。

初始旧CLI的自定义CA替换默认根缺陷已独立真实复现并修复，见 [CA修复报告](client-catalog-custom-ca-test-2026-10-18.md)。本轮采用新正式 CLI/stage `09a579b9…73ea81`、101源/6产物候选 raw SHA `b6dcdc28fbb2d663c4fc312279aaa4d4419d96933d432fe8508c8a25aae1b150`；四个Desktop产物继续旧SHA，不冒称全部由4863682重建。原single-custom-CA设置未改为手写bundle。

原公共夹具完整复制并核验了本轮实际12,972文件/242,740,447字节，raw receipt `ebf025de844ca4a72d298ed42b8fa3507df3c83493aec1fb05e175ea222e1c75`。原6,662项全部与旧完整清单同SHA，6,310新增编号副本也全部等于对应原项字节；没有筛文件或使用快捷清单。原准备冻结9文件/6依赖保留，增量准备器仅替换新候选路径、raw SHA、源数三个常量，并在启动前核实际resolved staged CLI09a。

| 正常后台操作与Native输入             | 实际结果                                                                                                                      |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| 发布 `order:null`，切换开发/助理模式 | owner HTTP v1/r2；实际公开分类和两对稳定ID存在，installed为0。                                                                |
| 仅保存P草稿后真实刷新                | v1/r3，published仍null；两mode的全部分类/条目顺序均等于基线。                                                                 |
| 正常发布P后刷新与切换模式            | v2/r4；开发模式把开发者工具置前，GitLab/GitHub逆转；助理模式把生产力置前，OpenPencil/Excalidraw逆转。未配置项保持原相对顺序。 |
| 配置不存在的ghost ID                 | 所有阶段均没有生成卡片、增加库存或安装条目。                                                                                  |
| 公司/个人分段与统一搜索              | 两分段实际为空，仅作空对照；搜索实际覆盖46项，目标pair仍按默认名称顺序，独立于P的分类排名。                                   |
| 正常发布null并刷新两mode             | v3/r6；八组阶段/模式中的恢复结果与原基线全部46项精确一致。                                                                    |

owner HTTP版本来自真实配置API，不是Native响应正文版本收据；本轮没有独立 `pluginStoreVersion` DOM/witness字段。Native排序变化、正常后台事实和冻结Source分别记录，没有将desktopVersion当作插件版本。

公开目录自动/手动刷新同时触发原公司SkillHub读取；本run专用真实代理按计划拒绝该目标，界面保留 `Failed to fetch SkillHub response: 403 Denied` 横幅，不能称无错误或公司商店验收成功。公开46项仍正常展示和排序。Renderer外部图片请求被原Session guard拒绝，blocked=138；这不等于全局Node/OS流量为零。代理保持默认真实DNS/公网数值pin/远端tuple校验，未知目标不扩大allowlist，TLS内部路径/重定向不可见。

三处驱动/只读观察假设保持原始记录。启动前曾构造错误的staged路径，随后按实际manifest相对路径核实owned symlink及新CLI09a，没有Native输入。发布后草稿实际保留P，初次owner断言错误预期null；`src/policy.ts` 的正常 `published=draft` 更新未清草稿，本次没有改变该行为。统一搜索后，CDP驱动的Meta+A未形成预期全选，Backspace只删末字符；最终另存适配文件，以正常焦点、22组ArrowRight及21组Backspace清空21字符。封存报告中“19组”的文字计数以实际输入JSON和按长度循环的源码为准，原工件不回写。未回写冻结driver，也未据此判定真实OS快捷键正常或存在产品缺陷。

模型请求正文和账本始终与本run初始化的2次本机受控调用、2笔settled/44完全相同，Native增量0。Featured和已安装排序没有正向库存，不计为它们的排序验收；没有安装、describe或执行插件，未触发模型任务或外部MCP工具。

Native正常退出0，代理正常stdin close并退出0，专属BH精确终止并删除目录。13个已知自有PID及5端口均关闭；新R因外部系统进程8个写句柄保留0700。重验fixture128原birth/PPID、owned DB FD、三个listener及无后代后仅精准SIGKILL该自有fixture，属于非优雅关闭，未生成完整最终desktop-traffic，不声称R已删除。没有直接查询或signal系统进程，也未访问旧retained R。

Root实际目检发布开发/助理及恢复默认三张截图，并从原始JSON独立重建八组全部46项分类、排名、缺项回退和ghost缺失；搜索46项与空分段亦通过。见 [Root离线复放](../evidence/client-catalog-custom-ca-root-20261018/native-order-root-replay.json)。本轮181项工件封存，[manifest](../evidence/client-native-store-order-20261018/run-manifest.json) raw SHA 为 `eca44f8c6ca29921232f8fb9ac7c6746ba72a214b4389620c1dd94ea5d5c4d48`；独立proxy的3项另存，manifest raw SHA 为 `5d563eab25f1e7b2f707a142413fa2b02d771e1fcb477deff5338a44a99fa8e2`。122项源/产物/初始准备保护、增量准备器、8份加载源码归档及654项旧工件/4manifest保持原SHA。

最终代理实收4条CDN tupleVerified tunnel、8条已知公司目录拒绝、unknown/drop0，close资源全0；Native configuration GET200为39，没有插件版本正文收据。见 [run报告](../evidence/client-native-store-order-20261018/run-report.md)、[Root封存核验](../evidence/client-catalog-custom-ca-root-20261018/native-sealed-root-review.json) 及 [独立终审](../evidence/client-native-store-order-final-review-20261018/review.md)，原工件封存后不修改。

Root最终只读校验主PID37266/health200、9业务表、原7静态资源、独占admin4产物/10源、外部checkout及不相关未跟踪测试均保持原状态；六份历史manifest的529个工件哈希同前。见 [主服务校验](../evidence/client-catalog-custom-ca-root-20261018/main-final.json) 与 [保护收据](../evidence/client-catalog-custom-ca-root-20261018/protection-final.json)。真实企微、外部MCP、网盘和付费模型继续排除；真实认证主体切换、分享、远端/手机及跨平台发行保持各自未验边界，不关闭整体U02/U03/U04/U05。
