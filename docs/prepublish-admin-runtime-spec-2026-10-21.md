# 原管理页面隔离Runtime与真实Docker联动

独立合成后台/Chrome/browser-harness，显式使用专用uwork-backend Colima socket和已缓存沙箱镜像的immutable imageId；原DockerSandboxDriver、SandboxService和定时worker均不替换。其他后台模型/评测/自动化case不执行。静态HTTP前置仅发布本tenant allowSandbox=true，shell/filesystem/network权限保持false，不在主配置中启用。

原页面创建2分钟Runtime、原编辑改名/保留scope与TTL且revision1→2，容器ID保持；原执行代码表单运行纯确定性sum55及uid/cwd/noKey布尔输出，原代码执行详情显示succeeded/exit0/真实stdout。第二段仅等待20秒的代码实际running后，原“停止Runtime”按钮必须使job cancelled/CANCELLED、Runtime stopped、Docker State.Running=false，原执行按钮disabled；两条原执行历史终态/reload保持。停止后真实API执行应409 SANDBOX_STOPPED且无新增job。

原删除确认必须使容器实际不存在及原Runtime列表/reload消失，DB原执行历史行保持；不宣称擦除保留历史或删除后仍能读授权详情。代码与stdout存储保持密文，模型供应商/ledger始终0。检查容器只属于本测试、无网络/主机挂载、只读根/受限用户；不输出ownerToken或环境值。

异常也通过原owner-bound driver回收自有Runtime，保留必要恢复材料至私有文件；不会广泛docker prune。自有PID/端口/根及容器确认关闭后，恢复原专用profile Stopped/default context状态。该用例是后台本机沙箱能力，未涉及发布多系统客户端、企微/远端Provider/MCP/网盘或员工消息。
