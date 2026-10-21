# 原本地分支创建、切换与覆盖保护

本批从原项目Composer分支入口操作共享UI→Host Git service→真实私有Git仓库，同时保留真实后端身份/配置环境。分支/HEAD/文件唯一事实在原Git仓，原Input是唯一业务写路径，Git CLI只作前置与只读核验。各仓局部虚构author，无remote，不调用模型、创建任务或写用户全局Git配置。

| 新增真实场景         | 实际结果                                                                                                                                                                                                                                                                                     |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v61普通创建与切换    | 空分支名提交禁用；invalid branch原提交被拒，refs/HEAD/index/文件保持，取消保持。原新建codex/owned-branch在main的同一HEAD创建并切换，不新增commit；选择当前分支no-op。原无匹配搜索不改仓，重新搜索owned-target并选取后，原label、HEAD和目标文件都正确变化；reload保持。                       |
| v62真实产品RED       | main的conflict.txt有本地改动、另有无关unrelated.txt未跟踪；Git实际拒绝切target，原警告仅列conflict.txt，却显示“2 个文件”。用例在准确数量断言失败，原result仍failed。                                                                                                                         |
| v63修复后tracked保护 | 重建未打包前端后，原警告列conflict.txt且数量1；取消后HEAD/index/refs/全部文件不变。再次原确认进入完整提交预览，仍显示全部2项改动；原手写消息提交到main后才切target。main保留LOCAL/unrelated提交，target原ref不变、文件T/target-only正确、无stash、worktree clean；reload/完整请求/账本保持。 |
| v64独立untracked保护 | 不重跑tracked case。main的target-only.txt是本地未跟踪版本，原目标有同名文件；原警告使用未跟踪描述、列表/数量1准确，取消不变。原确认提交当前两项后切target，main保存LOCAL_UNTRACKED/unrelated、conflict仍A，target仍原T/TARGET_ONLY；原reload零重放。                                         |

## 产品修复

已确认原因：原assist state同时有affectedFiles（实际overwrite路径）和fileCount/commitFiles（全部待提交改动）。警告列表读affectedFiles，但badge误读完整fileCount，故把无关改动计入受影响数量。现仅把警告badge改为与列表相同的affectedFiles.length；完整提交预览仍使用fileCount。没有改Git执行、权限、取消、提交范围或切换顺序，没有新状态/协议/迁移。

永久回归[gitBranchWarningCount.test.mjs](../clients/uwork/packages/ui/test/gitBranchWarningCount.test.mjs)提取实际blocked/commit JSX做SSR：1受影响/2总改动、2受影响/3总改动两项先RED；完整提交预览3项原本通过。修复后3/3全部通过；真实v63/v64再次验证1项警告和2项提交预览。修复本地提交bd0b6d4b，规格见[客户端spec](../clients/uwork/specs/git-branch-warning-count.md)。

## 门禁、范围与清理

- 客户端freshness、含Main的默认pnpm typecheck通过；pnpm lint通过，114条既有警告/0错误；架构前后0违例。目标oxfmt/ESLint及Python AST/8个实际DOM读表达式编译通过，原finally AST完全保持。没有禁用检查、减断言或修改阈值。
- 正常Desktop build:no-runtime-assets通过，冻结5087源输入/6669产物，运行时逐hash校验。UI源SHA从f7e7b6fa…变为595ecb7a…，与v62原RED/v63、v64新产物/实际执行源副本对应。CLI产品未变，不重复构建CLI或旧全套；未生成发行安装包。
- 四例当前成员新增模型调用/ledger均0，原两笔其他成员账本保持；实际modelRequests只含初始other-user-test基线，不把这两笔算本例操作产生。旧已通过普通分支流程未因修复而重跑。
- [独立最终复核](../evidence/prepublish-continuation-20261021/git-branch-final-verification.json)再次检查repo/refs/HEAD/文件、warning与commit数量、请求/完整账本、旧新产物源hash及执行源hash。v61–v64全部真实Primary Main/Host/CLI/fixture PID均不存在，4自有端口拒连、私有运行根移除、fixtureExit0、cleanup.errors空、browser-harness daemon/socket关闭。正常缓存产物保留，不把缓存根当未清理运行实例。

证据：[普通v61](../evidence/client-native-prepublish-v61-20261021/result.json)、[RED原警告](../evidence/client-native-prepublish-v62-20261021/branch-blocked-visible.json)、[tracked GREEN v63](../evidence/client-native-prepublish-v63-20261021/result.json)、[修复后1项警告](../evidence/client-native-prepublish-v63-20261021/branch-blocked-visible.json)、[2项提交预览](../evidence/client-native-prepublish-v63-20261021/branch-commit-preview.json)、[untracked v64](../evidence/client-native-prepublish-v64-20261021/result.json)、[真实main保存版本](../evidence/client-native-prepublish-v64-20261021/branch-preserved-main.json)。

整体目标仍active。下一批先核对Git图谱/提交详情的既有具名证据，再补缺失原动作。企微OAuth/远程未验证路径不阻挡其他本地源码联动；外部MCP、网盘和发布后多系统客户端仍排除，不宣称全产品已覆盖。
