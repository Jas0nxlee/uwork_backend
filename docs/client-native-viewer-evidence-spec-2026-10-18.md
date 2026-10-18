# Native 分享页登录取证合同

此合同只约束本仓库的测试观察器，不改变分享产品或认证接口。

- 认证开始前可以绑定当前自有 guest 的 target、URL 摘要及现有控件位置；开始后永久禁止截图、AX、原始 DOM、链接、网络明文、Cookie 和存储值提取。
- 认证等待期间仅允许固定三个可见性布尔值；认证完成后仅允许固定的标题、正文、状态文本和退出/撤销可见性五字段投影，以及原控件输入。
- `status` 表示当前可见的状态提示。生产页成功时会隐藏父 `#status`；即使其子标题仍保留加载文字，取证也必须返回空字符串。匿名状态下保留可见的“请先登录企业账号”和空正文。
- 实际回归执行共享表达式，覆盖已隐藏的 ready 状态和可见的匿名状态；原八项隐私门禁继续通过。

命令从仓库根目录运行：

```sh
node --test scripts/fixtures/native-controlled-viewer-evidence-dom.test.mjs
python3 -B scripts/fixtures/native-controlled-viewer-evidence.test.py
```

旧 Native 运行记录保留原始字段，不依据后续观察器修正改写历史结果。完整业务成功仍以原界面操作、真实 HTTP 和各阶段模型/账本事实为准。
