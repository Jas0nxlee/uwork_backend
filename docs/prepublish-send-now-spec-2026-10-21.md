# 原队列立即发送抢占联动

原共享UI→原CLI CommandInbox/Core调度→原Host企业relay→真实后台→本机受控供应商。在独立未打包运行时原Composer发送A，供应商暂挂A；再排队X、Y。点Y原“立即发送”，CLI应取消A、保留队列自动消费授权、先执行Y再执行X，不进入手动Stop的暂停状态。

实际stream主请求last-user必须A/Y/X且各恰一次，CLI三条用户历史同序；Y/X和标题按实际usage结算，A为原reserved等额uncertain，另一成员原两笔全行保持。reload不重放模型/账本、原session/用户顺序保持。只通过browser-harness原Input及DOM只读观察，不发产品RPC或改store。

复用既有自有fixture及引导作为前置，不重复旧编辑/排序/归档删除尾段。总预算240秒。未打包源码运行范围，企微OAuth/远程链路、外部MCP、网盘和多系统发行包不参与。
