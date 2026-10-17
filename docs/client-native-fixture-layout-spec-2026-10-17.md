# Native 夹具公开配置布局与 HTTP 诊断准备规格

2026-10-17。只修测试夹具，不改变产品 configs/scenes API 或 Help 产品选择，不 build 产品 out，旧证据保持原样。

## 已确认原因与目录所有者

正式 `electron-builder.config.js` 将公开 `config/default.json` 放到 resources/config；未打包 Main 的 `desktopCommandHandlers.ts` 则按真实 `app.getAppPath()/../../config/default.json` 读取回退。旧夹具的 appRoot 位于 owned root/app，回退会落到其父级共享 data/config，导致本地 ENOENT。该错误是夹具布局，不能据此修改产品回退逻辑。

新夹具布局固定为：

```text
独占 fixture root/
  runtime/app/       真实 app.getAppPath()，正式 out 的字节快照
  config/default.json  与正式公开源完全相同的配置
  data/              独占用户、会话、工作区和身份资料
```

原 snapshot helper API 不变，ownedRoot 传 root/runtime，使其仍只创建新的 owned app/out。公开配置以 COPYFILE_EXCL 复制到 root/config/default.json；复制后核对源/目标 SHA 与字节数，记录路径、验证结果和 metadata。禁止写共享 repo/data/config，禁止修改公开配置内容，禁止伪造 isPackaged/getAppPath。依赖、正式 out 和 staged CLI 只读复用。

## HTTP 诊断合同

onResponse 同时保留 route template 和脱敏实际 pathname：旧 path 字段继续表示 template 以兼容已有汇总，新增明确 routeTemplate；未匹配时二者为 null。pathname 从 raw req.url 去掉第一个 query/fragment 分隔符及后续内容，仅记录 origin-form 路径；不可记录完整 URL、查询 token、headers 或请求正文。没有 route 的 404 也必须保留可识别的 pathname。

## 验证与边界

1. 先做源码语法、Lint 和格式检查，再用独占 prep profile 启动现有后台/供应商与快照准备，不启动 Native。核对所有可写路径在本 root，公开配置和全部 out 字节相同，Main 真实相对回退路径正好指向 owned root/config/default.json。
2. prep 中可对自有后台做一次明确标记的固定未知路径 GET，query 使用临时随机合成 token，且不打印/留存该值。HTTP 404 诊断必须有 null template 和正确无 query 的 pathname；该驱动诊断与实际产品 404 分开。随后关闭自有服务、端口并删除 prep root。
3. 再用新独占 live profile 运行当前冻结的 755 CLI / 517 Main 正式 out 一次，记录真实 app.isPackaged 与 appPath，不更改属性。经 DOM/AX 完成必要 onboarding 并打开 Help 菜单，仅检查菜单配置可读取，不点击任何外部链接。
4. 保留旧 configs/scenes 请求仍真实 404 的 RED：记录 route template、脱敏 pathname、状态和 Main/Host 日志。Help 本地回退应不再 ENOENT，且从正式公开配置得到的菜单能力实际出现。未改产品 404 方案，不以本地 Help 可读代替远端 API 已实现。
5. 所有测试仅在独占 profile、CDP、BH_HOME、本机 HTTPS/backend/受控供应商中进行；不触主 PID 37266，不读主 .env/DB/Vault，不碰外部 checkout，不调用真实付费模型或企微。结束核对自有 PID/端口/root/daemon 清理并保存 manifest。锁屏原生目录选择器保持未验收。
