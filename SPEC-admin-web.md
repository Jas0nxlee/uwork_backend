# admin-web

目标：可操作同源管理端，覆盖组织/模型/资产/策略/任务/用量/日志/集成的查询和修改。
实现：admin/；React、Vite、Lucide；HttpOnly 会话，不保存 Secret；清晰空/错/加载状态、分页/过滤、编辑与确认。
验收：真实 UI 登录、资源保存/发布/执行/取消；320/768/1440 布局，无控制台错误。
命令：npm run build；npm test；npm run dev；browser-harness。不得把静态菜单当作后端完成。
