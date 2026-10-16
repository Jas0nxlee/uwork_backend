# ai-assets

目标：技能/专家/连接器/Playbook/指令的分类、版本、审核、启停、可见范围与分发策略。
实现：src/assets.ts；严格内容类型和大小；不可变版本、发布选择已审核版本；连接器认证引用 vault；个人策略独立。
验收：版本回滚、成员撤权后拒绝下载/执行、多个 allow 交集/deny 优先；不支持的客户端类型明确过滤。
分类删除检查最新草稿与当前选中的发布版本，包括已停用但仍选中发布版本的资产；纯历史未选中版本不永久阻止删除。重发布旧版本或启用资产时，实际将生效的发布分类必须仍存在且属于本租户/类型，否则返回 INVALID_CATEGORY，保留原版本和状态；不可变历史正文不修改。
命令：npm test；npm run build。Zod 合同，API 集成测试。
边界：技能是数据包，不在服务端任意执行；历史全局提示词不注入。

## 终端适用矩阵

控制台证据（`evidence/workbuddy/`，本轮实测）：专家管理页“适用产品”为 CodeBuddy 暂不支持、WorkBuddy 支持、企业智能体支持，并带 `+ 上传企业专家` 与专家下发策略；连接器管理页同样对 WorkBuddy 支持，带 `新建连接器`；自定义指令页（`/admin/ai-resource/words/panel`）对 WorkBuddy 与企业智能体均标注“暂不支持”；Playbook 页只有帮助文档按钮与静态 Cookbook 卡片，`rbac/me` 之外没有任何内容接口，即不是可上传/发布的企业资产。

因此 `supportedClients` 缺省按类型取值：skill/expert/connector 可下发 `uwork` 与 `agent`；playbook/instruction 缺省仅 `agent`，显式声明 `uwork` 返回 400 `CLIENT_UNSUPPORTED`。该矩阵阻止把没有终端所有者的类型下发给 UWork 客户端；未来接入 CodeBuddy 或为这两个类型建立所有者时再单独扩展。Host 端另有同等拒绝（纵深防御），不能只依赖服务端过滤。

## Host 版本准入

连接器不落盘：发布校验和属于服务端私有内容，掩码描述不是该内容，因此客户端只缓存目录元数据，正文（掩码描述 + 网关路径）在真正加载时经服务端读取。连接器会话支持显式 `DELETE` 回收；`mcp-protocol-version` 按连接协商并回放，不被请求体改写。

客户端安装与运行分别检查当前发布授权。下载可携带 `version`；与当前发布版本不符时返回 409 `ASSET_VERSION_CHANGED`，不静默换成新内容。响应携带服务端 kind 与 checksum；Host 必须再验证实际内容字节，不能把目录存在当成仍已授权。

资产列表与下载在返回内容前检查当前有效订阅、席位和 IP 白名单。连接器下载仍只包含 masked 描述和代理路径，不暴露远端地址/凭据，也不将原始私有内容的 checksum 冒充为 masked 内容校验和。

`/api/client/authorize` 新增 `action=asset`，必须携带 `target`（资产 ID）、`assetVersion` 和 `assetChecksum`。在已有订阅、席位、IP、渠道检查之后，仅当资产当前已审核发布、可见、支持 UWork，且版本/校验和完全相符时返回允许。高风险技能还要求有效 dangerousSkills=true；不授予 shell/filesystem/network 权限，也不替代实际能力准入。

技能路径需要跨 Windows/macOS/Linux 可移植：拒绝控制字符、Windows 保留设备名、段尾空格/点、非 NFC 路径、大小写或规范化冲突，以及文件/目录前缀冲突。Host 安装器仍须独立检查路径、符号链接、归属与原子写入，不能只信服务器验证。下载/准入失败不能保留可执行的过时授权缓存。

路径规则参考 Microsoft [Naming Files, Paths, and Namespaces](https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file) 与 [Whitespace Characters](https://learn.microsoft.com/en-us/troubleshoot/windows-client/shell-experience/file-folder-name-whitespace-characters)。为避免不同文件系统编码/大小写折叠别名，另外保守拒绝孤立 UTF-16 代理项、所有 Unicode Cc、段首 ASCII 空格、设备名与扩展名间空格，以及完整大写折叠后的重复/前缀冲突。Host 仍须在拥有的临时目录使用排他文件创建，不能据服务端校验声称所有平台原生文件系统已验收。

验收：旧清单版本的下载冲突；资产在审核撤销、成员撤权、停用、换发布版本后准入拒绝；高风险标志不能被客户端忽略；非法/冲突路径在存储前拒绝。完整 Host 安装/运行接入另行验收。
