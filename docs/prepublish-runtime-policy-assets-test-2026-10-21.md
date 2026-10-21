# 原Runtime、访问策略与资产发布的新增联动

2026-10-21。本轮只新增三类尚无原页面证据的消费者，原模型/普通运行/评测/自动化及旧全量测试未重跑。原管理页面、Fastify/SQLite/worker均实际运行，浏览器通过独占browser-harness原生Input和DOM只读观察，没有替换fetch/业务响应、注入store或手动驱动业务worker。

## 隔离Runtime原页面与真实Docker

[v13结果](../evidence/admin-run-ui-v13-20261021/result.json)完整8阶段通过：原创建2分钟Runtime→原编辑保留owner scope/容器ID/TTL、revision1→2→原执行代码→原结果详情→第二段代码真实在途→原停止Runtime→原取消详情/reload→原删除/reload。

第一段在真实容器输出sum55、UID1000、cwd=/workspace、无MASTER_KEY；原执行详情显示succeeded/exit0和解密stdout。第二段只有20秒等待，Docker实际exec已存在且job running后才点原“停止Runtime”；job cancelled/CANCELLED、Docker State.Running=false、原执行按钮disabled。停止后真实enqueue409 SANDBOX_STOPPED，不产生第三条job。

原删除确认后Docker inspect404，Runtime列表/reload消失；数据库原两条执行历史保持，不宣称删除后仍可读取已退休Runtime的授权详情或已擦除历史。代码/输出字段为密文，模型请求与账本始终0。原DockerSandboxDriver、SandboxService、定时worker都参与，未手动tick/drain或替换driver。

本机专用uwork-backend profile初始Stopped且named context不存在；保存配置仍在，正常启动时activate=false，default context保持default。镜像使用缓存immutable ID `sha256:00f6e4f3a1b11afc2ff9566a5e8d47632a25f1c7f8975f185f6d76f09ecaa9c2`，未pull/build替代。Docker当时容器基线为空。原容器owner标签在内存匹配DB，不输出ownerToken；验证无网络/无host bind、只读根、cap drop ALL。

完成后容器为空，恢复专用profile Stopped，named context由Colima停止自动清除，default未变；未删除镜像、VM配置或其他profile。[前置](../evidence/prepublish-continuation-20261021/admin-runtime-docker-preflight.json)、[停止前核验](../evidence/prepublish-continuation-20261021/admin-runtime-before-stop.json)、[环境恢复](../evidence/prepublish-continuation-20261021/admin-runtime-environment-restored.json)。这是后台本机沙箱能力，不是多系统发行客户端测试。

## 访问与分发原页面到Gateway

[v14结果](../evidence/admin-run-ui-v14-20261021/result.json)：原表单创建model deny/all范围策略→client catalog不列模型且completion403 MODEL_DENIED→原停用后catalog/调用恢复→原启用后再次拒绝→原删除取消保留策略→确认删除/reload后权限恢复。两次允许请求各14Credit，合计2笔settled/28Credit；两次拒绝期间supplier和ledger零新增。模型资源全行保持，因此拒绝确由策略造成，而非模型停用。原审计create1/toggle2/delete1和浏览器对应HTTP一致。

## 原技能资产审核发布到客户端下载

[v15结果](../evidence/admin-run-ui-v15-20261021/result.json)：原新建skill V1→审核前原发布409 REVIEW_REQUIRED且无资源变更→原审核后仍不下发→原发布V1客户端目录/下载可用。原编辑产生未审核V2、再审核V2期间，客户端始终下载原V1，version1数据/批准/创建信息保持。原发布V2后目录和实际文件内容变V2，两版checksum均用原canonical JSON内容逐字计算SHA256，且不同。

旧version=1下载请求409 ASSET_VERSION_CHANGED，原停用/reload后目录排除、下载403 ASSET_DENIED；两版已批准历史原行保持。模型请求和ledger全程0。此轮验证的是后台原发布UI→实际client目录/下载合同，未把已验Native技能执行再跑一遍或宣称本轮重演了Native缓存。

## 设施修正与验证

Runtime初始v11/v12均在create-runtime前被错误映射到旧驱动，实际报unsupported stage，没有创建容器；两轮失败与清理原样保留。v12中替换脚本失败后组合命令仍执行旧驱动，也已保留。修正为显式驱动映射，记录实际uiDriver，先通过类型/入口校验再单独启动；未知及继承字典键在fixture IO前拒绝。没有把这些准备失败归为产品问题或放宽业务超时。

本轮未发现三条链路的新产品业务缺陷，未改产品业务代码。新增TS脚本严格typecheck、定向ESLint、Python AST和改动格式通过；未重复旧309项后端或其他已验功能集。

[独立收尾](../evidence/prepublish-continuation-20261021/admin-runtime-policy-assets-independent.json)核对三条PASS及两轮原准备失败的Chrome/BH原PID/birth退出、CDP/服务端口关闭和私有根删除，另实查profile/context恢复。RootRuntime owner绑定driver在finally回收本次资源，未广泛prune容器。企微、远端Provider、MCP和网盘均未参与，不因此宣称整体全覆盖。

复跑需Node24、新 `admin-run-ui-v数字-20261021` profile，命令为 `UWORK_ADMIN_UI_CASE=policy` 或 `assets` 加 `node --import tsx scripts/tests/admin-run-ui.ts <profile>`。Runtime模式需显式启动同专用profile并提供 `UWORK_OWNED_SANDBOX_SOCKET=/Users/ljp/.colima/uwork-backend/docker.sock`、上述immutable image ID，再选 `UWORK_ADMIN_UI_CASE=runtime`；验完核空容器并恢复原停止状态。
