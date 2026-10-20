# 打包态实际联动测试边界

使用已验签的 `UWork Preview.app`，从包内 app.asar/Main/Host/CLI 正常启动；只允许此前生成 manifest 绑定的独立缓存目录。不会修改包、关闭签名或覆盖用户安装。验证前重新校验 manifest 中的运行时 SHA 和签名。

夹具新增 packaged 模式仅允许 `experience`，使用隔离后台 email 会话初始化既有加密身份存储；不打开真实企微。独立 HOME、userData、sessionData、工作区和受控供应商；移除开发态 Provider 配置路径覆盖，要求从包内读取。原 FirstRun、原 Composer 发送、原分享发布和复制按钮均真实操作。

以 OS 状态守卫在内存中备份剪贴板所有可读 item/type/Data，并保留 zcode 协议原 handler。不得输出或持久化用户剪贴板内容。复制测试只核对本机测试分享 URL；结束后恢复原剪贴板，若检测到用户后续复制则保留新内容。默认协议关联若被预览包注册改变，恢复并回读验证原 handler。备份不完整或没有可恢复 handler 时不执行相关全局操作。

验收需要：原界面成功回答与终止、本人新增计量及真实包内 CLI 路径、分享复制 URL 与 OS 剪贴板一致且没有新增模型计费、原 OS 状态恢复、原生及后台资源关闭。安装包生成/签名只能证明构建，不替代这些运行结果。
