# macOS 普通文件 lease 单次能力预检

2026-10-21。Root 单次运行已完成：当前普通用户、该 helper 与该自有文件上的 write lease 申请返回 `EPERM`，没有取得 lease，也没有启动 reader 或 App。**Mac Native regular-file Read 在 OS 等待期间撤权的验收仍开放。**

| 实际观察   | 结果                                                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 身份与文件 | UID 501 / GID 20；全新私有目录内唯一 0600、单链接、自有普通空文件；设备 16777231 / inode 55151856                               |
| 唯一申请   | 一次 `F_SETLEASE`，`F_SETLEASE_ARG(F_WRLCK, 1) = 7`；同文件唯一 `O_RDWR` 描述符，expected open count 与自身 writer count 均为 1 |
| 返回       | `-1` / errno 1 (`EPERM`)；申请耗时 0.004 ms；未尝试 release，未启动 reader                                                      |
| 时限与退出 | supervisor 61435 退出 0，总计 0.393413 s；helper 退出 0，耗时 0.634 ms；均无 stderr                                             |
| 清理       | 文件描述符关闭、文件删除、目录删除均为 true；清理错误 0；独立只读复核 supervisor PID 已不存在、case 路径已不存在                |

本次退出 0 表示受限的能力观察及清理完成，`kernelWaitProven=false`、`NativeReadAwaitAccepted=false` 保持原值。没有发起冲突读取、内核等待、权限升级、entitlement 增补、签名修改、挂载或产品注入。

[实际收据](../evidence/client-macos-file-lease-acquire-only-preflight-20261021/root-actual-result.json) 的 SHA256 为 `7942efad48efc6cc716924728c73e7b0baa9caa378a7c89bba5f815f365a0332`。独立复核确认其 plan SHA 与[冻结计划](../evidence/client-macos-file-lease-acquire-only-preflight-20261021/preparation.json)一致：`1e7a51433f075b35514da9e319e04b85f7cfc32c27a47476f04e4fdaf21919d0`；C 源码、编译产物、supervisor 和 research 四项哈希均仍匹配，未重跑。

本机 SDK 定义了 Darwin lease 接口。Apple 公开 XNU `main` 的[参数及本地文件类型检查](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_descrip.c#L4816-L4886)、[私有 entitlement 检查](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/vfs/vfs_subr.c#L12012-L12046)和[拒绝分支](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/vfs/vfs_subr.c#L12231-L12250)表明：该实现要求 `com.apple.private.vfs.file-leases`，缺少它会返回 `EPERM`。本机为 macOS 27.0.1 / 26A434、`xnu-13432.1.9~1/RELEASE_ARM64_T6050`；本轮未取得该 exact tag 源码，引用的 `main` 不能冒充当前内核的逐字源码。因此，本次 errno 与公开 gate 相符，**单独的 `EPERM` 收据并不证明本机内部唯一拒绝原因**，也不推出 macOS 所有 lease 上下文均不可用。

该受限方案在 acquire 前置即停止，尚未取得可释放的普通文件等待屏障。[既有 Linux Native 证据](client-native-pending-read-test-2026-10-20.md)的 inode／SIGIO／原 CLI worker `__break_lease`／显式释放链仅覆盖其 Linux 文件打开冲突；[Host／Core 受控端口合同](client-read-result-authorization-test-2026-10-18.md)覆盖读后授权复验。它们不能替代 Mac OS 等待证据。真实大文件耗时同样不能区分解码、行数统计、缓存、线程池排队与内核 I/O，也不能单靠耗时提供确定的持有／释放边界；当前缺口保持具名开放。
