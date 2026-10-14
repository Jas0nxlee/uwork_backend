# external-integrations

目标：外部能力声明、网盘适配与容量策略。没有配置就明确 unavailable。
实现：src/integrations.ts；组织绑定 HTTPS 适配网关，vault 引用，健康/容量/文件/日志合同；不模拟付款成功和真实云沙箱。
验收：配置缺失 503、跨租户拒绝、受控适配服务合同验证、外部错误清晰。
命令：npm test；npm run build。
