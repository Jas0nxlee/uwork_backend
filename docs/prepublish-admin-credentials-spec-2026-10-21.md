# 原凭据页面创建/轮换/吊销与真实Gateway密钥消费

独立credentials模式。原密码表单创建新合成凭据A；controller用真实模型PUT仅将静态模型引用绑定到该UI新id（不宣称模型绑定UI）。真实completion必须用A，原轮换表单空密码框输入B后新completion必须实际用B；同一已配置供应商静态接受A/B/C，只输出对应phase标签，不输出密钥。

原吊销弹框取消保留密文/版本/账务；确认后revoked1、ciphertext清空，client model catalog排除引用该凭据的模型，真实completion409 CREDENTIAL_UNAVAILABLE且supplier/ledger无新增。原轮换输入C恢复同id、revoked0/revision3，catalog与调用恢复且实际使用C。3个成功请求各14Credit，模型引用和原seed凭据行不改。

原详情只显示公开metadata，不含value/ciphertext/token/secret；表单为password，轮换不回填旧密钥，所有响应及日志检查不含A/B/C。测试密钥仅在内存和0700根内0600控制文件，结束删除。真实HTTP和原UI Input、Vault/Gateway均参与，不改表/浏览器fetch/store，不接企微/远端/MCP/网盘或员工消息。
