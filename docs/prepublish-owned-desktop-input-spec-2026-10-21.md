# 专用未打包Desktop构建输入

正常build:no-runtime-assets生成Main/Host/renderer后，原copyNativeOutSnapshot将全部产物冻结到用户缓存的uwork-prepublish-desktop/build-\*/app/out；不创建安装包，不筛除产物，不覆盖原项目数据。清单记录5087项源输入（packages/src、CLI packages/src及4个包/锁/构建配置文件）和6663项产物，缓存目录0700、manifest0600。

builder是清单唯一写入者，构建前后和冻结后源输入hash必须一致；受信测试控制器显式传入清单，loader要求canonical路径、限定cache base、匹配repository及out目录。原复制器仍逐字验证缓存→本case完整输出；额外校验全部条目/目录数与构建清单及复制后的源输入hash，源码改动后必须重新正常构建，不能用旧缓存替代新源码。

此路径仅是测试夹具的输入所有权修复，不修改生产构建/运行时，不调整原60秒ready或240秒场景预算。已有Desktop/out重复后缀文件曾使复制迟滞并随后再出现，缓存不依赖这些后续生成噪声；不宣称已找出底层文件系统重复的根因。旧缓存因UI修复实际被拒，损坏字节/源变动/越界路径3项合同通过。缓存为可复用构建产物保留，运行数据根和进程另行清理。
