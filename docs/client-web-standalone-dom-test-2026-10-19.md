# Standalone Web 原DOM联测（v8，2026-10-19）

正常Web/Server构建在独占Electron41内嵌Chromium中运行，使用原Web URL和BH物理输入。容器sandbox=true、nodeIntegration=false、contextIsolation/webSecurity=true，无Desktop产品Main、preload、身份或Cookie注入；不代表已安装Google Chrome。

| 原业务           | 实际结果                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| 访问与身份边界   | 无认证fetch401；原同源Cookie bootstrap后fetch200；企业身份仍未配置，无企业登录或模型发送。       |
| 原FirstRun及目录 | 原跳过/职业/模式/默认偏好完成；原目录选择器中输入自有路径并确认，未写React或editor状态。         |
| 原文件与恢复     | 自有文件正文预览；一次Page.reload后Cookie200、职业引导持久化、原项目及文件预览恢复，原文件不变。 |

11个业务标志全true，uiDriver实际exit0；23个输入前once journals保留。reload恢复不等于断网自动reconnect，未配置Web身份不等于Desktop企业身份已传播。

Root逐SHA独核9公开文件和23 journals，共1,252,489字节；275个已知PID（含controller）及两个端口均闭。原controller实际exit1：业务/进程收口通过，但根FD扫描不完整，因此私有runtime/bh根保留，不声称写者零或删除成功。原manifest的Root独核pending状态未改写，后续[独核回执](../evidence/client-sharing-followup-root-review-20261018/web-dom-v8-public-independent.json)补充终态。

[公开manifest](../evidence/client-web-dom-live-v8-20261019/manifest.json) SHA `e80dc2f8381b76d0b2b7a333b79b93f81ec2ed40656ce54093ab406c1f98e402`；[result](../evidence/client-web-dom-live-v8-20261019/result.json) SHA `96b636ca076df00699c2b6e05a942b2a2b7d548d15f358dec2fb6f501c900383`。

旧Chrome导航超时及各轮测试器失败原scope保留，根因未唯一确定；不能把Electron成功写成Chrome修复/安装通过。原HTTP/WS合同见[standalone规范](client-web-standalone-live-spec-2026-10-17.md)，不与本轮DOM标志重复计数。真实企微/外部模型、手机/managed远端、OS权限与三平台发行仍独立。
