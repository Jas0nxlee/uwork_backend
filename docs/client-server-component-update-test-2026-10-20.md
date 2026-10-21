# 原 Server 增量更新、坏组件拒绝与整包回退

真实链路最终九项检查通过，并修复增量组装与原整包不能复用同一不可变目录的缺陷。原 update、HTTP下载、ComponentCache、ReleaseInstaller、current/pending与Supervisor均未替换；使用独立安装前缀和本地受控HTTP，无外部网络。

## 实际缺陷与修复

v1正确增量已成功，随后原update装回旧包，再由缺组件URL触发原整包fallback时失败：`Existing immutable release conflict ... identity mismatch`。保留原RED与清理结果，没有删除已组装目录或绕过保护。

独核原整包9611文件与组装目录，唯一差异为manifest.json字节：JSON结构完全相同，但Zod解析将组件字段顺序从原producer的 `id,paths,sha256` 改为 `id,sha256,paths`。原组装重新序列化该对象；原整包保留producer顺序，immutable逐字摘要因此正确拒绝。

窄修同一次原HTTP JSON下载返回严格校验后的value和原sourceText。prepare将原文交给原ComponentCache唯一writer；写入前对原文和已验证manifest再次严格schema解析，完整结构等价才允许写原文。无原文的旧内部API保留原序列化行为。没有修改归档、producer版本、SHA、manifest完整性算法或immutable比较。

相关[规格](../clients/uwork/specs/server-component-manifest-bytes.md)和[永久回归](../clients/uwork/packages/zcode-server-cli/test/componentManifestBytes.test.mjs)取得原实现1 RED→新实现3 GREEN：

- 真实HTTP、原prepare/Cache/Installer保留producer顺序与格式，整包可复用同目录；正文篡改仍拒绝。
- 紧凑JSON、反转键序、CRLF原文同样精确保留并可复用原整包。
- 嵌套组件SHA不等价或未知字段原文拒绝；旧无raw API行为保持。

## 原CLI实际结果

v2旧原包仍为 `bfd55ad31626c9fd140cead8be5944f30c3b3eab964887e3b77d6510f9b2e299`；正常build/stage新原包为 `04bc1eae3d40f1fa48b996ca20f97a7ff5a31902e892056726269662c2ee9d01`。二者原manifest版本仍是3.16.0；本结果是同版不同构建更新，不称跨发行版本升级。

五组件只有server-runtime改变；其余Node、Agent、官方插件、原生搜索工具的内容摘要和路径集合不变。新server-runtime原组件归档摘要为 `5b38f2f06bf472361b80a7a4a154864bf14f84f091b6478747b13cef121a6b10`。

| 原操作/条件                 | 实际结果                                                                                                                                 |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 原update安装旧包            | current旧SHA，HTTP旧Core0.0.0-dev，未注册OS服务                                                                                          |
| catalog声明坏组件归档SHA    | 实收原组件27,074,846字节、HTTP200，原CLI exit1明确checksum mismatch；没有整包请求，current原字节/PID/HTTP保旧、无pending                 |
| 正确增量catalog             | 只收到原manifest与server-runtime组件；没有新整包或四未变组件HTTP下载；原CLI applied、Core换代/HTTP3.16.0，current新SHA                   |
| 四未变组件复用              | 四个完整路径集合的内容SHA独核：旧安装、新组装、原manifest完全一致；抽样文件mtime均按原cp发生变化，未声称硬链接或mtime保留                |
| 同SHA再update               | up-to-date、零额外归档下载、原PID/current保持                                                                                            |
| 原update装回旧包            | 仅产品操作写指针，current旧SHA、HTTP0.0.0-dev                                                                                            |
| catalog缺变化组件archiveUrl | 只省略这个URL字段，原SHA/manifest/归档不变；原逻辑return null并fallback，实收原新整包78,181,650字节/HTTP200，applied且复用原增量目录成功 |
| 原restart/stop              | 新Core再次ready/HTTP3.16.0，停止和资源闭合通过                                                                                           |

坏摘要与缺URL均为清楚标记的受控catalog故障，不是声称正式发布源曾返回这些配置。坏摘要不自动降格为整包fallback；缺URL按原产品分支回退。所有身份、指针与事务变更均由原update/Installer执行，未手写current/pending，也未使用force。

修复后整棵新组装树与对应原完整归档9611文件逐文件SHA/权限完全一致，manifest原文字节也一致，无多余文件；四个未变化组件全部路径内容摘要另行独核。七个已知PID、七监听端口、control socket均关闭，三个具名容器和卷独核不存在。私有挂载根/归档保留作证据，不声称证据根已删除。

## 命令与证据

从后端根用新名字运行（不会启停VM或全局服务）：

```sh
python3 scripts/tests/run-server-update.py --components --name client-server-update-components-new-20261020
```

单个1GiB Node容器、network none、cap-drop ALL、只读镜像/输入；原archive和变化组件复制后逐SHA核对。未开启GUI或桌面自动更新，没有模型供应商、用户主服务/主库、真实企微浏览器、外部MCP或网盘。

主要证据：

- `evidence/client-server-update-components-v1-20261020/{result,tree-diff}.json`：真实fallback RED及9611文件根因比较。
- `evidence/client-server-component-manifest-red-20261020.log`、`evidence/client-server-component-manifest-green-v2-20261020.log`：永久1 RED→3 GREEN。
- `evidence/client-server-update-components-v2-20261020/result.json`：最终九项检查、完整HTTP状态/字节收据、坏组件原错误、四抽样文件SHA/mtime、原CLI/状态/收尾。
- 同目录 `controller-result.json`、`tree-diff.json`、`independent-components.json`：容器exit0、业务passed、提取永久合同1/1，完整树/四组件和资源独核。
- `evidence/client-server-component-manifest-gates-20261020.log`：typecheck/Lint/架构全部exit0，113既有warning、0error，架构0违例。
- `evidence/client-server-component-manifest-regressions-20261020.log`：Server联合8/8通过；`normal-build`/`normal-stage`同前缀日志均成功。

边界：未据此关闭跨发行版本、组件新增/删除或路径迁移、所有缓存损坏与下载故障、运行中任务force更新、OS服务注册更新或其他系统平台。真实企微浏览器安全拒绝保持；外部MCP和网盘仍排除。
