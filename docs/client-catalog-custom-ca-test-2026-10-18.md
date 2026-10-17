# 自定义 CA 附加信任修复与正式 CLI 实测

已修复配置自定义证书后公开插件目录无法连接的问题。正式新 CLI 在只配置一个本机自签证书、没有手工补信任 bundle 的条件下，真实更新公开目录并列出 46 个可用插件，已安装为 0，两个命令均 exit0、diagnostics0。TLS 证书校验保持开启。

旧正式 CLI `39175fd…d43c` 的真实 RED 是 exit1 / `plugin_marketplace_invalid` / `unable to get local issuer certificate`。当时默认真实代理已完成公网地址解析和远端 tuple 核验，故不是目录不可达；同版本另一个 fresh HOME 仅追加正常 Node 根证书的归因对照成功取得46项。原始 RED 和对照均封存，没有将对照当作产品修复。

问题来自 CLI 的 `loadTlsCaCertificates` 将自定义文件直接传为 `tls.ca`，替换了默认根。桌面设置说明是附加证书语义，Host API 网络层也已采用默认根加自定义证书。提交 `4863682a97ebd9e7c600f552f79c9378626aacd3` 仅在该 CLI loader 合并 Node `rootCertificates` 和原自定义 Buffer；生产代码4增1删，两条现有 HTTP 调用路径共用修复。没有自定义路径时仍返回 undefined，文件优先级、读取失败、原惰性缓存、代理/NO_PROXY、授权、hostname 和证书验证均保持既有合同。

先行 Source RED 明确发现自定义/空文件移除默认根的两个失败。修复后4项测试通过；两个生产 HTTP 客户端分别走直连和本机 CONNECT，4次受信任请求成功，4次不受信任证书在 TLS 层被拒，未到达 HTTP handler。独立审查复跑4项通过，Required none。定向无 emit 类型、Lint、架构和格式通过；完整客户端 typecheck/Lint、CLI 标准 typecheck 27项任务与 Lint 14项任务均通过，客户端保留113项既有 warning、0 error。CLI 使用仓库已有 turbo，没有新增依赖。

Root 在完整快照读取结束后执行现有 `scripts/build-desktop-agent-cli.mjs` 普通正式构建和 stage，未走复用旧 bundle 的 bootstrap 分支。新 CLI 与 staged CLI 同为 `09a579b9deafefa4dcb41a05b9714294ff9a5650f3b0e10cc783b6ff6973ea81`，16,571,029字节。Main/Host/Scheduler/Renderer 继续原4d8f24/11a99a/5c62e4/08a7b5，未因本修复重建这些产物。新 [101源/6产物候选](../evidence/client-catalog-custom-ca-root-20261018/artifacts.json) raw SHA 为 `b6dcdc28fbb2d663c4fc312279aaa4d4419d96933d432fe8508c8a25aae1b150`，不回写旧候选。

正式复测使用另一个全新 HOME/workspace、单 PEM 证书文件、原 `ZCODE_AGENT_CA_CERT`/`NODE_EXTRA_CA_CERTS` 传递和默认真实目录代理。没有 MITM、测试 transport、关闭验证或手工 bundle。实际1个 CDN tunnel 的远端 tuple 验证通过；结束时连接/资源/任务/resolver/reply timer 全0，独立 PID9604 与端口61357 均关闭。该测试没有安装、describe 或运行插件，没有模型或外部 MCP 调用。私有元数据根保留，未声称完整删除。

Native 原 full-out copy 此时实际包含12,972文件/242,740,447字节。完整逐项核验确认原6,662文件的 Source/target SHA 都未变，另6,310个编号副本也全部与对应原文件字节和SHA一致；新增包含 JS、map、字体和 wasm，不能称仅图标。没有筛掉文件或把本轮写成6,662文件复制，也没有认定系统重复文件的根因。Root保留完整实际树，独立检查见 [out-drift-acceptance](../evidence/client-catalog-custom-ca-root-20261018/out-drift-acceptance.json)；原始复制耗时不作为产品性能基准。

原 S3 的9文件/6依赖准备冻结不变。新增准备器逐字只替换候选路径、raw SHA、源数量三个常量；候选集合严格等于旧95源加本次3源及3个只读消费者，拒绝重复/遗漏，并核对 owned app 合法 symlink 实际解析到新 staged CLI。原本机证书路径和19字段环境合同未修改。本次 Native 首启已真实取得46个公开条目，完整排序、发布和模式矩阵由独立 Native 报告记录；CLI成功不替代该矩阵。

证据分别保留：旧真实 RED 九项 manifest `9308adeca81257af3c44621d62b56a881c36f7dcc56b65c213bc2874f3e33a49`，新正式 GREEN 九项 manifest `bde8e7ed31c6a58e5ab900dc4660853d42d87bbe4e855a92d2162384dcfa6422`。见 [Source修复及测试](../evidence/client-catalog-custom-ca-fix-20261018/report.md)、[Source独审](../evidence/client-catalog-custom-ca-code-review-20261018/review.md)、[正式候选/实测独审](../evidence/client-catalog-custom-ca-compiled-final-review-20261018/review.md)。旧39175编译字节已单独备份。

主服务3000、主库、主 .env/Vault、原管理页和外部客户端 checkout 均不在本修复写入范围；真实企微、外部 MCP、网盘和付费模型仍按原约定排除。此项不关闭整体客户端、远端或跨平台验收。
