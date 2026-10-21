# Fedora 原 xdg-open 入口未完成

Fedora v2/v4 的原文件、reload、PTY、后台调用/对账和撤席位等10项检查通过，但整体结果均为 **FAILED**：原 `xdg-open` 返回3，系统 URI 未到原生确认。v4另有初始ready/Chat前两次 browser-target角色与真实kernel sandbox正例，不能用这些正例覆盖协议失败。v3的CDP reload超时也单列保留，未被归因于已修Mac的旧URL恢复问题。

Root独立只读核到原因所在：已安装的 `/usr/share/applications/zcode-preview.desktop` 使用 `Exec="/opt/UWork Preview/zcode-preview" %U`；Fedora `xdg-utils-1.2.1-5.fc44` 的 generic `search_desktop_file` 通过原 `first_word` 提取命令，而该函数明确不处理引号，只按 shell read 拆第一词。原函数实际得到带前引号的 `"/opt/UWork`，`command -v`失败，然后退到不存在的浏览器候选，最终 exit3。原无空格launcher `/usr/sbin/zcode-preview` 存在，realpath正确；glib2、desktop-file-utils、findutils等依赖齐全。

这不是已证的 UWork desktop语法错误：原 `desktop-file-validate` 对真实系统文件返回0；[Freedesktop Exec规范](https://specifications.freedesktop.org/desktop-entry/latest/exec-variables.html)要求包含空格的程序路径使用双引号。当前安装的 electron-builder `LinuxTargetHelper.computeDesktopEntry` 也正常按此生成路径，并明确拒绝通过 `desktop.entry.Exec` 覆写程序入口。没有为了本轮测试改写有效的desktop文件、伪造桌面环境、换dispatcher宣称原xdg成功，或加`--no-sandbox`。

证据在 `evidence/client-linux-fedora-xdg-readonly-v2-20261020/`：原函数和真实系统desktop只读重放、源SHA、退出结果及desktop validator结果。全部观察容器均无网络、只读、cap-drop ALL、UID1000，并已自动移除；没有发协议、开GUI或模型。首个独立诊断因Docker未接stdin未执行脚本，最终断言失败，另存原失败，不作运行成功证据。

后续保留的准确边界是 Fedora 该最小Openbox/generic分发器的引用路径兼容问题；完整原系统URI确认仍未通过。真实RPM卸载另发现 alternatives target不匹配，属于独立产品缺陷，由项目自有RPM hook修复与真实事务复测，不能与此xdg失败互相替代。也不外推完整GNOME/KDE/其他发行版入口已测。
