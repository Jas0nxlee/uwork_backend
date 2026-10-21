# Mac Native 单件 PDF 分享真实联测

**通过。** 正常签名 ARM64 v12 的原终端生成一页 PDF，原 Composer 得到文件引用和可见预览卡，再经原分享 UI 上传一件真实制品；本地源、上传、后端当时 BLOB 和实际 HTTPS 下载的 606 字节及 SHA 全部一致。分享前后模型请求和双成员完整账务不变。

用例 `client-native-packaged-macos-clock-arm64-share-artifact-v1-20261021`，计划 SHA `859b4ff8e3aef8eb87058bb1ac1a89dd4300d7b108c528a84712f0a7c63073d2`，72输入。原7项检查通过，但这是单件分享切片的7项，**不是原正常包七项或全部文件类型验收**。Root 27项独核通过。

| 实际路径 | 结果 |
| --- | --- |
| 原 xterm / shell | `native-share-proof.pdf`，606B、单页、5 objects、xref423；真实PTY/cwd/TTY已绑定 |
| 原 Composer / 预览 | 当前任务出现唯一可见 PDF 卡，未注入本地任务库、publisher descriptor 或替代发布 RPC |
| 原分享 UI | trigger→next→disclosure→confirm→success；真实 prepare201、upload201、confirm200，artifact_count=1 |
| 文件字节 | 源/上传/原存储BLOB/下载 SHA 均为 `53810b8887c1748d8fdf31205c16e97c965b6f41815607d53a3c998a536b5116` |
| HTTPS 下载 | 原授权内容 API 200、显式本case CA、正常证书与主机名验证、完整消费body、socket关闭；不打开外部浏览器或调用系统另存为 |
| 分享账务 | raw inference POST、supplier完整摘要均保持4；本人及另一成员各2 settled/44 Credit、24 input/20 output，ledger/Trace/gateway全行保持 |
| 自有数据收尾 | 原DELETE撤销后实际row revoked、title及confirmed_json清空、artifact rows0、下载404；不冒称UI撤销入口已验 |
| 资源 | fixture0/cleanup[]，13known加BH35916、四TCP与私有socket关闭，协议恢复、剪贴板未用，常驻后端健康 |

原控制器的 revision-safe Admin configure 保留旧 published 字段后发布 organization sharing、files=true 和 filesystem=true；公开目录与原执行权限检查保留。主进程仅为本case使用私有 user-data-dir，原单次副实例完整函数与10秒预算未改。

准备阶段的第一版在 App 启动前被独审拦下：测试下载器未显式信任自签CA。旧计划/源码已归档；修正只在测试下载器使用独立 CA HTTPS Agent，真实本地 TLS 测试证明正确CA成功、错误CA拒绝，未关闭全局TLS或修改Native环境。新10项Node/3项Python及格式/lint通过后才执行该唯一Native运行。

撤销后 BLOB 与 confirmed_json 按原隐私规则已删除，Root不声称此后重新计算已删字节或还原选轮数据。四方字节证明来自撤销前真实请求/存储收据并与当前真实源PDF交叉核对；public descriptor 的 producer ID 是原publisher重映射，不当作本地session ID。Root首次离线审计误读已清空JSON的失败也已保留并修正为核清空规则，Native通过结果未改。

[实际结果](../evidence/client-native-packaged-macos-clock-arm64-share-artifact-v1-20261021/result.json) · [Root独核](../evidence/client-native-packaged-macos-clock-arm64-share-artifact-v1-20261021/root-verdict.json) · [范围](client-macos-native-share-artifact-readonly-scope-2026-10-21.md)。本次无产品改动，不外推 PNG/全部附件组合、外部查看器或所有平台。
