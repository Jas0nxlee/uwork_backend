# credential-vault

目标：租户凭据创建/轮换/吊销、AES-256-GCM 加密和按引用注入。
实现：src/vault.ts；32 字节环境主密钥，AAD 绑定 tenant/id，不存在 reveal API；引用只能本租户授权服务使用。
验收：数据库无原文，列表/日志无原文，错误密钥解密失败，吊销立即作用于调用。
命令：npm test；npm run build。不能提交运行密钥和数据文件。
