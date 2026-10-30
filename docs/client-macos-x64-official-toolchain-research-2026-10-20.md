# macOS x64 helper 官方完整工具链候选

当前结论：官方完整6.4.1工具链已真实可信验签、私有展开，三份兼容库都有x86_64，原helper同源/原-O及target11参数编译成功；产物54992B、x86_64、minos11.0/sdk27。**仍不能关闭macOS12兼容：原链接保留两项Swift dylib按13.0构建的warning，未执行helper或在macOS12实测。** 共享helper/out与v8包均未改，不能把私有编译成功当正常生产包或功能验收。

本机CLT27为Apple Swift6.4.0.34.1，SDK27的CoreGraphics/Foundation x64接口由Apple Swift6.4.0.31.4生成，含该代新增接口特性。SDKSettings实际列x86_64且MinimumDeploymentTarget=12.0；CLT自有Concurrency/56/Packs三静态库确都只有arm64/arm64e。没有发现已装Xcode或全局独立toolchain。本地源/SDK/header/三库SHA与lipo原输出见 [metadata](../evidence/client-macos-x64-official-toolchain-research-20261020/local-toolchain-sdk-metadata.json)。

[Swift.org官方下载页](https://www.swift.org/install/macos/) 提供完整6.4.1 pkg；其[官方releases API](https://www.swift.org/api/v1/install/releases.json)关联6.4.0及6.4.1到Xcode27.0（6.4.1的xcode_release=false，不冒称Apple Xcode自身已包含此patch）。候选精确URL为 `https://download.swift.org/swift-6.4.1-release/xcode/swift-6.4.1-RELEASE/swift-6.4.1-RELEASE-osx.pkg`。HEAD200，1590804750字节，无登录；不得把ETag当SHA256。

前置仅Range读取385705字节XAR/Distribution/PackageInfo/Bom，无Payload。原Distribution声明hostArchitectures x86_64,arm64；Bom列x64 Swift标准库模块及三个compatibility.a名称，不含MacOSX SDK载荷。因此它是完整同代compiler/resources候选，仍需使用匹配本机SDK，不能只抽三个库拼到CLT。包内叶证书subject与[官网签名身份](https://www.swift.org/install/macos/package_installer/) Swift Open Source V9AUD2URP3一致，指纹AC:12:31:0F:AD:C4:90:4F:89:20:34:18:BE:58:01:B6:EE:79:DE:3A:0D:F2:23:A1:F1:F4:12:7B:AB:97:B1:A5；这仅为未验证整包前的内嵌证书观察，不是信任链/包签名通过。

不能选择“任意旧x64库”或更旧compiler来消除linker错误：[Swift编译器团队的模块兼容说明](https://forums.swift.org/t/cant-use-framework-compiled-with-swift-5-2-in-swift-5-1-3-project/35248/9)保证旧接口由后继compiler读取的方向，不保证旧compiler能读新SDK接口。[Apple Xcode系统要求](https://developer.apple.com/xcode/system-requirements/)列Xcode27的macOS部署范围12–27，但该表不能单独证明本下载pkg内三库实际有x64。6.4.1与SDK27属于合理同代候选，是否import所有Apple接口仍须真实编译，不预判GREEN。

隔离验证合同：原公开pkg完整下载到新Library/Caches项目子目录；完整SHA自行计算并查官方是否公布可比较SHA（当前官网/API未见macOS pkg SHA，SDK项的checksum不能挪用）；原pkgutil验签和信任链精确Swift团队通过前不运行pkg内程序。随后仅用原pkgutil --expand-full展开到私有cache，不执行installer/脚本、不注册toolchain或改xcode-select。实际lipo三库、编译器签名/版本及SDK兼容，通过后用完整官方compiler/resources对原源+原target11/参数私有输出复测；不手拼库、不禁autolink、不提高到12.3/13。任何输出需核x64 Mach-O/minos/动态依赖；仍不等于macOS12物理机或窗口吸附功能验收。

Apple完整旧/匹配CLT的替代来源为[官方More Downloads](https://developer.apple.com/documentation/xcode/installing-the-command-line-tools)，官方要求Apple ID登录；本轮不登录或假设已有Xcode。若Swift.org候选不能匹配，保留helper unavailable，不改校验求绿。所有前置机器证据与原官方网页/API/元数据冻结于 `evidence/client-macos-x64-official-toolchain-research-20261020/`。

Root后续已明确授权仅这一个官方pkg的完整下载、全包签名/信任链/fullSHA、私有expand-full及原helper真实编译。专用cache为 `/Users/ljp/Library/Caches/uwork-backend/client-macos-x64-official-toolchain-20261020`（0700），pkg为0600；未系统安装/注册toolchain、未改global HOME/xcode-select/共享helper/现有v8候选。顺序probe `scripts/tests/macos-official-toolchain-helper-probe.py` 的执行门槛为下载大小/SHA匹配且原pkgutil可信签名+精确Swift team/Apple Root全满足；然后才展开，再检查三库真实x64、实际compiler签名/版本，最后在私有输出运行原source SHA d0eb与原-O/-target x86_64-apple-macos11参数。只在该compiler子进程绑定原已选SDK27和自有模块cache，不改变source/target/autolink，也不运行输出helper。

## 完整原pkg与实际私有编译

原公开pkg完整1590804750B，自算全SHA256 `c34e7e5fb0be4bcd61decfd40db1766434d8952d68e37aed90bcff4e8547951c`。所查官网安装页/官方API未提供可比较的macOS pkg SHA；未把其他SDK checksum或ETag挪用。下载运输保留原前缀，再同官方固定URL的4个精确Content-Range206片段续完并整体重算；不是拼静态库或第三方产物。[下载收据](../evidence/client-macos-x64-official-toolchain-research-20261020/download-result.json)。

原`pkgutil --check-signature` exit0：Apple-issued distribution developer签名、Apple notary service信任、可信时间戳2026-10-08，精确Swift Open Source V9AUD2URP3叶证书经Developer ID Certification Authority链至Apple Root CA。[全包签名原输出](../evidence/client-macos-x64-official-toolchain-research-20261020/full-package-signature.json)。首probe按旧系统措辞匹配而在展开前停止，原签名本已成功；`pre-expand-harness-wording-v1/`保留框架失败。新probe要求当前Apple原Status+可信notary+trusted timestamp以及原Team/root同时满足，未降低信任门槛。

之后原pkgutil expand-full只展开私有cache，不执行installer或postinstall、不写收据。原三a `lipo -archs`均实收`x86_64 arm64`，与旧CLT的`arm64 arm64e`直接对照。原swift-driver/swift-frontend/clang严格codesign全部0，才运行完整工具链compiler：Apple Swift6.4.1(swift-6.4.1-RELEASE)。实际target-info的compatibility路径均指此完整cache。

同原source SHA d0eb18e8...4029a，原`-O -target x86_64-apple-macos11`参数，不改target/autolink，子进程只绑定原已选SDK27和私有模块cache。真实compile exit0，CoreGraphics/Foundation的SDK27接口import及链接均成功。输出 `/Users/ljp/Library/Caches/uwork-backend/client-macos-x64-official-toolchain-20261020/private-output/zcode-window-bounds-x64-original`，54992B，SHA `8c5659beb63dc0a8a9b4ab09d3d002cdf2e51de477bd603d3ce8b194d1fe6278`，原Mach-O头/lipo皆x86_64，LC_BUILD_VERSION platform1/minos11.0/sdk27.0，LC_RPATH仅`/usr/lib/swift`，动态install names均系统路径。[原编译stdout/stderr](../evidence/client-macos-x64-official-toolchain-research-20261020/original-helper-compile.json)、[全部probe结果](../evidence/client-macos-x64-official-toolchain-research-20261020/full-toolchain-probe-result.json)。

## 未关闭的12.0兼容边界

原stderr有两条ld warning：`libswiftCore.dylib`与`libswift_Builtin_float.dylib`按13.0构建。只读otool实际确认完整工具链内两dylib的x64 LC_BUILD_VERSION为minos13.0/sdk15.2；本机SDK27对应原tbd也留存SHA/header。[warning来源](../evidence/client-macos-x64-official-toolchain-research-20261020/link-warning-origin-readonly.json)。输出install name为系统路径，不能因此忽略build-time所选库的更高版本警告；minos11仅是输出声明，也不能证明真实macOS12所有符号可用。未通过换SDK片段/手拼库、改变library搜索或autolink、升target到13来消除warning。完整12.0运行支持、原窗口吸附功能、正常producer纳入helper与物理Intel依旧开放，由Root另定下一切片。

所有下载、pkgutil、compiler句柄均自然结束；只读后核无自有compiler进程，xcode-select仍原CLT，global/user toolchains均无新增，Swift pkg receipt仍查询1，原helper源SHA及v8manifest硬SHA不变。工具链/原pkg和私有输出保留为可审输入，未运行helper。[自身证据重算](../evidence/client-macos-x64-official-toolchain-research-20261020/full-toolchain-self-verdict.json)明确非独立peer。独立研究/验证新增源只为 `scripts/tests/macos-official-toolchain-helper-probe.py` 和本报告，无产品修改。
