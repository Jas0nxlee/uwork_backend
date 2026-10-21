# Server 发行归档 node-pty ABI 独立审计

实际发现：Linux新Server3b50原包存在与Desktop同类的公开resize参数错配；Darwin旧d365/新1d3原包的公开resize无效FD合同均通过，不能把Linux问题推广到Mac。此轮仅源/归档/本地模块前置取证，Server生产source/pins/lock/out不改，未跑远程provider、模型或SDK终端业务。

## 原归档与真实调用

三个原tar先完整SHA验证，再只把原runtime/node和node-pty原文件复制到自有隔离输入，没有重写JS/native/归档。三包JS package.json均1.1.0；原UnixTerminal.prototype.resize仅调用native`pty.resize(fd, cols, rows)`。探针用真实公开方法和无效FD -1，合法80×24，预期应进入ioctl并返回EBADF；不实例化PTY、不启动shell/command child。Node探针本身是明确的本地进程，不冒称客户端终端或SDK E2E。

| 原包 | 完整SHA256 | 原Node/结果 |
| --- | --- | --- |
| Darwin旧 | d365b09a5a1cc523248ac3cb67fb3b67c647d57bacd43150206d18b729adc635 | 原Node22.16.0/arm64，公开3参EBADF，native5参Usage3，exit0 |
| Darwin新 | 1d3fe925c269c9e75cce860095b240a963742807aad93a4d58451bf6ac7972d1 | 原Node22.16.0/arm64，同上，exit0 |
| Linux新 | 3b50dc19d24183435fa02fcb379f264642920172fe5276b675eb3c96b2843361 | 原Node22.16.0/arm64，公开3参Usage5，native5参才EBADF，期望断言exit1真实RED |

[原归档metadata/文件SHA/模式](../evidence/client-server-node-pty-audit-20261020/archive-inspection.json)、[Darwin原模块结果](../evidence/client-server-node-pty-audit-20261020/darwin-original-contract.json)、[Linux原RED](../evidence/client-server-node-pty-audit-20261020/linux-original-contract-red.json)。Linux原native为69112B、SHA `d8314caa682827c0bcab6a7a2ef121a17065605e830d5eac55de3245333b3ad8`，与独立取回且SSRI通过的registry Beta10 native逐SHA全等；匹配1.1候选为c192e560...b75b，flat package/pty.node。详[官方Linux原发布比对](../evidence/client-server-node-pty-audit-20261020/official-linux-native-provenance.json)。

Linux实际使用一个具名read-only/netnone/UID1000/cap-dropALL/NNP/128MiB/cpu1短容器；原Node22来自该归档，没有改用image内Node24冒充发行运行时。首前置因VM未共享Library/Caches而docker125，未执行Node/native，失败独立保留；同SHA复制到自有workspace输入后才得到上面的真实RED，没有修改VM mounts/生命周期。原容器inspect与rm/absent都在原JSON，已释放VM，不再开容器。

## 源路径与差异原因

Server CLI staging实际在 `packages/zcode-server-cli/src/packaging/stage.ts:610–650`：先保留原node-pty自带目标prebuild；缺失时才从Server依赖`@lydell/node-pty-<target>/prebuilds/<target>/pty.node`补齐。注释明确上游node-pty带Darwin/win32、Linux需补齐，该分支与原Darwin3参可用、Linux从Beta10补入5参native的实测差异一致；Darwin原native具体构建来源仍未据此冒认。原services TerminalService仍沿IPty.resize(cols,rows)调用。这里是原归档/源路径与实测一致，不把尚未跑过的原SDK Terminal业务算成已失败/已修复。

另一条既有Agent分发 `scripts/zcode-distribution/assets.mjs:177` 从Server包复制整个prebuilds；远程资源准备 `scripts/prepare-prebuilds.mjs:348` 同样取Server平台包并将实际版本写入组件semanticPrefix。此轮仅静态读源码，绝未执行远端准备、发布provider或远程同步。原Server声明4个@lydell Beta10与node-pty ^1.0.0保持；[源码SHA快照](../evidence/client-server-node-pty-audit-20261020/read-only-source-snapshot.json)前后相等。

## Darwin registry 1.1 候选

真实GET npm registry的 [darwin-arm64 1.1.0](https://registry.npmjs.org/%40lydell%2Fnode-pty-darwin-arm64/1.1.0) 与 [darwin-x64 1.1.0](https://registry.npmjs.org/%40lydell%2Fnode-pty-darwin-x64/1.1.0)，原tarball均和各自registry SHA512 integrity精确相等。两包都为flat `package/pty.node` + `package/spawn-helper`，模式0755，分别Mach-O arm64/x86_64，native导出Node-API注册入口；resize Usage字符串为3参。原Beta10候选则是prebuilds/<target>布局、Usage5字符串。完整SHA、尺寸、原metadata/layout在[候选证据](../evidence/client-server-node-pty-audit-20261020/official-darwin-candidates.json)。这些候选仅静态读取，未执行或替换到原包。

原Darwin归档native文件SHA与两个registry候选都不相等，代码section也没有证成全等；因此不强认其具体@lydell版本/构建来源，实际公开3参EBADF证据独立成立。原Darwinhelper已存在且可执行，但本轮未运行它，亦不外推x64/真实PTY功能。

未来若单纯把Server/remote依赖pin到1.1，当前三个producer都只找prebuilds布局，会漏掉flat资源，须在另一个明确owner的修复切片按原声明版本与实际layout归一化；不能为保Beta路径把Server ABI称已验。此处只记录明确输入合同，不提前改生产方案。

## 可复现前置与边界

新独立探针（当前ESM入口）`scripts/tests/server-node-pty-invalid-fd.mjs` 保留公开3参必须EBADF的断言；本机原Darwin Node22真实执行0，并有原Linux缓存探针同公开不变量的真实exit1证据。新增repo探针只做静态Node check及Darwin调用，不冒称它已在Linux再跑；原Linux实际执行源码为保留input/public-resize.cjs。

后续需单独完成：匹配依赖/flat-layout保护的生产RED→GREEN、正常新Server归档、原本地SDK Terminal创建/resize/stty/退出和资源闭合。当前不写包、不改source/pin/lock、不跑实际PTY/remote/provider/model、不重复旧广测试。仅新增独立probe与本报告，明确为自身证据核对的[self verdict](../evidence/client-server-node-pty-audit-20261020/self-verdict.json)不冒称peer。


## 测试入口 ESM 收尾（不改历史验收）

Root完整Lint发现原独立CJS探针的require风格错误后，当前入口迁移为标准ESM：静态builtin import、标准dynamic import原UnixTerminal及其同包utils导出的loadNativeModule，实际native仍由原包原loader装载。没有module.require/createRequire绕法、自建native loader、修改第三方或降低断言。原Node22.16与Node24.14均实际取得公开3参EBADF、native5参Usage3，未实例化PTY/启动命令child。该变化不重写原LinuxRED/归档/input/CJS快照，亦不声称新ESM已在Linux再跑。

[9项实际contracts](../evidence/client-test-fixture-esm-quality-20261020/contracts-green.log)、[迁移质量收据](../evidence/client-test-fixture-esm-quality-20261020/quality-result.json)。原详细业务SDK两平台6+6及独立Root验收见[修复报告](client-server-node-pty-fix-test-2026-10-20.md)。
