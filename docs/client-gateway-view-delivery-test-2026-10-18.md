# 企业用量面板的异步视图回归

2026-10-18。已修复实际 `UcasGatewayPanel → useUcasGateway` 的旧用户资料回显、周期残留和跨服务同步锁定问题。永久测试使用真实 React 组件、ServiceProvider、公开服务接口及严格 schema DTO，普通浏览器输入驱动交付次序；不是实际企业注销、后台权限绕过或 Native 网络竞态发生频率的证明。

同一永久 package 入口在旧 Hook 上为 9 项 RED、1 项正常冷同步对照 PASS，修复后十项全部通过、驱动及独立异常计数均为零。测试 getter 文件按原有 400 行限制拆分后，又在新目录完成同十项 GREEN；没有关闭规则、跳过断言或修改旧证据。

| 场景                                        | 修复后的实际组件结果                                          |
| ------------------------------------------- | ------------------------------------------------------------- |
| 初始 getView、同步返回晚于 signed-out 事件  | 不再重新显示旧资料、额度或用量                                |
| 7d 请求在途后退出并收到新用户 month 视图    | 退休旧选择，展示当前用户及其周期                              |
| 更换 service 且新初始视图仍在途             | 首次提交的布局也不见旧用户；新 service 的较小 revision 可接纳 |
| A 同步未完时换 B，随后 B 自己同步           | 旧 busy 不锁 B，旧 A finally 不清 B 的新 busy                 |
| 正常冷启动 idle→syncing，usage 仍为空       | busy 保持到本次完成，没有提前解锁                             |
| 用量返回先于事件、返回旧 revision、请求拒绝 | 接纳当前事实、拒绝倒退视图，完成或失败后退休待响应选择        |

修改集中在一个 Hook：把原 view、busy、pending 归入当前 service 的 UI 绑定，事件、初始读取、同步及用量返回走同一个 schema/revision 提交口。渲染直接屏蔽不属于当前 service 的绑定，绑定引用仅在已提交 effect 更新。空态会退休选择，但不会把正常冷同步误作过期操作。身份、模型配置、授权与额度的唯一事实仍由现有 Host/后端持有；没有新身份 owner、凭据、业务缓存或写入接口。

永久入口为客户端根目录的 `pnpm test:gateway-view-delivery <新证据目录>`，UI 包脚本先执行严格测试类型项目，再运行真实 E2E；Chrome、BH 和 Python 的测试执行文件通过显式环境提供。源码位于 `clients/uwork/packages/ui/test/gateway-view-delivery/`，没有业务 Hook alias、断言 cast 或重挂载来掩盖状态问题。

正常 client typecheck、完整 Lint、架构及自有文件格式检查通过，Lint 保留 113 项既有警告；原 Gateway 三文件 11 项回归通过。正常 Desktop-only 生产构建退出 0，不保留增量构建缓存、不重编 CLI；CLI/stage 仍为 `b3859893…49124`。旧完整 out 经逐项 hash 后整体保留，新构建的 11 个 chunk 改名均由真实 tsup emission 日志确认，不能把正常 hash 文件名当作未知额外文件，也不凭文件名直接断言内容等价。

随后复核截图发现注销提示仍声称自动配置 API Key，已同步修正中英文为同步企业模型配置、套餐与用量。只改两条文案及先行规格，不改变认证和密钥所有者。相同十项组件回归再次全部通过，实际中文空态显示新文案；正常类型、Lint（113 项既有警告）、架构、格式及 Desktop 构建再次通过。新产物为 6,631 文件、138,807,291 字节，156 个来源前后匹配，CLI/stage 保持不变。证据另存于 `evidence/client-gateway-hint-component-20261018/` 和 `evidence/client-gateway-hint-build-20261018/`，不覆盖此前构建。正常清理前旧 out 全部为已核对的已知文件且零写者；新生成的 map 先因分类器未考虑 hidden sourcemap 停止，经当前 Vite 配置和实际对应 JS emission 确认后才完整取 hash，没有重新构建或访问旧未知归档。

原四例探针的 React 开发诊断 getter 枚举错误、测试外置目录的 React 类型重复、通用观察器要求 loading 时也有 Sync 按钮、测试文件超过现有行数限制及格式语义观察器错误均保留为测试层记录。最终永久回归使用已修正的观察器，原业务断言保留。早期 CDP 事件环形记录达到上限，不能据此宣称完整网络零错误；实际 DOM、layout 记录和独立异常计数才是本次结论的依据。

证据在 `evidence/client-gateway-view-order-implementation-20261018/` 的 red、green、green-after-lint-split 与门禁记录；生产构建单独在 `evidence/client-gateway-view-order-build-20261018/`。三轮永久回归的 48 个已知 PID、六端口及三个私有 scratch 均已收口，主后台和任何 retained Native 根未参与。此前的 121 项原探针、56 项追加 RED 和 87 项提案证据分别封存；独审初稿与修订稿 SHA 取样错配另有勘误，当前代码两项 Required 已解决，不沿用已撤回的旧结论。

该结果证明当前组件的明确交付合同与正常构建；新构建尚未由本报告声称完成 Native 真实注销、服务切换或跨平台安装。分享浏览、模型调用和真实身份接入仍按各自验收记录处理，整体 U02/U03/U04/U05 不据此关闭。
