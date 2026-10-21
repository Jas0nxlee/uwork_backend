# Mac 最终 ASAR header 声明修复与验收边界

已修复并本地原子提交 `f4cac9136226bc7e94edd9fcf8d2bba38f327803`（5文件）。正常 ARM64 v13 / x64 v14 新包均构建成功，Root独立核实际最终 UTF8 header SHA与Info.plist声明相同、全部runtime/native字节摘要与架构、33个生产输入及严格签名。**ARM64新包原七项真实联动通过，独立31项通过；x64单次仍FAILED0/7，但本次原30秒renderer门在29.894秒通过，随后停于原生架构提示的AX属性读取。**

问题是原builder写Info后，项目afterPack仍可能注入依赖、删除sourcemap并重包ASAR，导致声明描述旧header。现在原两项native边界检查后、xattr/签名前只调用一次异步同步helper；保留其它Info值及其它ASAR条目，一致时不写，错误使打包失败。非Mac不读写该产物；fuse与签名策略不变，没有修补或重签旧包。

实际原afterPack永久回归先1RED/1PASS，原断言保持后2GREEN；helper8和相关既有12项，总22/22通过。typecheck0（原Host配置边界）、lint0/114条既有warning、architecture与格式0；fresh独审实际afterPack再独跑2/2通过。此前旧包ASAR完整摘要/严格签名有效，embedded integrity fuse原为off，本修复不把旧声明差异说成运行损坏或x64启动根因。

| 新包      | Manifest SHA                                                       | Root实际最终header SHA                                             | 静态结果                             |
| --------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------ |
| ARM64 v13 | `4bb6f40d4fa18670e0a05d4f8ebeb0114f72fac4fe3cb3b583e26848b051c756` | `198874ad12e181a31818e540a31a9976d990d66fa6c205875355b61c143fcb86` | 9runtime/12native、33源、strictsign0 |
| x64 v14   | `4fb0ae63377480fba47ccb41c47125fd16df109f2fe45a83812aaaa8c49b8cd9` | `11746f3ec705855710e8b7125919c61e02b363ac75e1ce456ef055e4532527a6` | 8runtime/11native、33源、strictsign0 |

ARM辅助工具首额外byte-equality断言真实失败保留。新独审逐字节确认仅76个变化字节，位于UUID、签名identifier内UUID和派生page0 SHA；全部22sections、其余loadcommands、nm和反汇编一致。仅接受本v13 helper精确SHA `91ecca093702aac8d812d668efcbe6ebce645db07d72f6b63355c1edc7bbeb34` 的元数据例外，未开放任意辅助工具变更。x64原optional Swift helper仍因原macOS11兼容库缺失而缺席，保原fallback，未降target或造文件。

原v6–v12及两新包间整树/manifest保护通过；旧v12的29个生产输入在改配置前完整归档。两架构producer及6个原命令进程均关闭，sharedout writer已释放。ARM原七项和x64单次均已执行，所有自有App/BH现已关闭；不以静态通过填补x64未执行业务。

## 新包实际回归

- ARM64 v13 `clock-arm64-asar-integrity-v1`：原7/7通过，副实例51387自然exit0且原Main51251保活；原UI工作区与真实CLI/supplier cwd另证转发消费。文件/reload、实际PTY/cwd/TTY、真实Host/CLI及addon、本人2 settled/44 Credit（24/20 tokens）、他人原2/44聚合、seat拒绝零增及logout cold通过。19known+2BH、四TCP/两个UNIX关闭，fixture0/cleanup[]、OS协议恢复；38用例输入和33生产输入稳定。独立31项通过；另一成员没有保存full-row before，仅声明原前后聚合及最终行，不补造历史证据。
- x64 v14 `clock-x64-asar-integrity-v1`：Main52420实际x86_64映射，原file target在29.894秒/第94次观测选中，原30秒门本次通过；继而architecture AX查询报 `Owned AX attribute failed`，在BH构造之前停止，未执行secondary/CLI/addon/业务，整体仍FAILED0/7。Native账目0，另一成员seed2/44及supplier2保持；6PID、四TCP及OS恢复，fixture0/cleanup[]。42输入与新版header/签名复核通过。该结果不回写旧v11原30秒失败，也不证明checksum是启动耗时根因。

最终会话锁屏布尔复查仍为true，但原AX失败未保存具体code/attribute，不能唯一归因于锁屏。独立、零业务、无AX动作的[v9/v10定向诊断](client-macos-x64-architecture-ax-diagnostic-test-2026-10-21.md)已实际完成：0.1秒读取出现-25204，后续0.75秒成功；v10确认AXWindows唯一元素与应用根CFEqual=true，正确过滤且无后续子项查询。本次接口未提供可验证真实窗口，不能判无dialog或恢复原v14错误码。6PID/4TCP、OS、双方全行账务/raw/supplier、67来源及严格产物复核均收口。没有据此盲改原辅助工具或重跑原七项求绿；原应用Quit的前台环境限制继续开放。

[Root双case收口](../evidence/client-macos-asar-metadata-acceptance-20261021/root-native-verdict.json) · [ARM实际结果及独核](../evidence/client-native-packaged-macos-clock-arm64-asar-integrity-v1-20261021/agent-independent-verdict.json) · [x64原失败独核](../evidence/client-macos-asar-metadata-independent-review-20261021/x64-v14-failed-case-verdict.json)。

[Root新包静态独核](../evidence/client-macos-asar-metadata-acceptance-20261021/root-static-verdict.json) · [正常构建报告](client-macos-asar-integrity-packaging-test-2026-10-21.md) · [独立代码审查](../evidence/client-macos-asar-metadata-independent-review-20261021/production-verdict.json) · [辅助工具独审](../evidence/client-macos-arm64-asar-integrity-package-v13-20261021/helper-readonly-peer/result.json)。整体Mac/Windows仍未全覆盖；原应用Quit在当前锁屏会话下未验收，Windows真实主机入口仍待提供。
