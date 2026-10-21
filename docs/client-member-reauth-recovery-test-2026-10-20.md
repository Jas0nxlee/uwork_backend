# 后台禁用、恢复成员后的原 Host 重新认证闭环

新增具名场景 `backend member disable and reenable require a fresh identity before the same Host can execute again`。通过隔离 SQLite、实际 HTTP/TLS 与原 EnterpriseIdentityService、Gateway、ProviderRuntime、私有 Host relay 运行；初始化使用公开 email 会话桥接加密身份 store，不冒充真实企微授权或 Native 登录按钮。

## 验收与结果

| 阶段                             | 实际结果                                                                                                               |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 普通 member 初次同步、执行       | 原 Gateway 同步提交；原 ProviderRuntime + Host relay 到本地受控供应商一次调用，成员本人一条 settled、7 Token、9 Credit |
| 管理员通过原 PATCH 禁用 member   | 原会话 `/api/auth/me` 401，旧私有 owner 的模型 HTTP 401；供应商仍一次、原账本逐行不变                                  |
| 原 Gateway 再同步                | unauthorized、未提交；当前原模型目录候选清空                                                                           |
| 管理员通过原 PATCH 恢复 member   | 旧 Token 仍 401，原 adapter.restore 返回 null；恢复成员不会复活被删除的会话                                            |
| 原退出后重新认证                 | 退出本机状态成功；后台拒绝已撤销 Token 的 logout 属正常行为；新会话恢复后候选仍为空，须新 owner 完整同步               |
| 同一 Host/profile 重新同步、执行 | 第二次供应商调用成功，恰两条本人 settled、14 Token、18 Credit；首条账本保持不变                                        |
| 新会话后重放旧私有 owner proof   | `enterprise_identity_changed`、status denied，供应商仍两次                                                             |

没有改产品逻辑。初轮 `first` 误把 usage 返回的 `user_id` 写成 `userId`，v2 误要求已认证 owner 的幂等 `restoreSession()` 强制复验，均属于测试断言错误，原日志保留。当前产品契约明确由 Gateway 拒绝撤销目录投影，不伪造 identity owner 退出，因此测试沿原 `logout()` 入口重新登录。v3 通过，v4 增补旧 proof 与结构化观察后通过；v5 增补逐账本 Token 断言后通过。

证据：

- `evidence/client-member-reauth-recovery-v5-20261020.log`：1 项通过、0 失败/跳过。
- `evidence/client-member-reauth-recovery-v5-20261020/member-disable-reauth-recovery-green.json`：五项具名业务检查、原 HTTP 路由和状态、供应商两次、三监听端口关闭、隔离目录删除、身份/Provider dispose。
- 同目录 `member-disable-reauth-recovery-observation-green.json`：四阶段状态与计量。
- `evidence/client-member-reauth-typecheck-20261020.log`、`evidence/client-member-reauth-lint-20261020.log`：严格后端脚本类型项目与目标脚本 Lint 均 exit 0。
- `evidence/client-member-reauth-fixture-regression-20261020.log`：原默认 owner 初始化场景及新普通 member 场景联合 2/2 通过，0 失败/跳过，确认默认夹具路径仍可正常执行。

专用入口（从后端根目录，使用新证据目录）：

```sh
export PATH=/Users/ljp/.cache/uwork-client-toolchain/node-v24.14.0-darwin-arm64/bin:$PATH
UWORK_GATEWAY_EVIDENCE_DIRECTORY=evidence/client-member-reauth-recovery-new node --import tsx --test --test-name-pattern='backend member disable and reenable' scripts/client-live-gateway-smoke.ts
```

不访问 `.env` 或主数据库，不改真实组织成员/角色/席位，不启动 Docker，不向任何员工发送消息；本地供应商不接外部 MCP、网盘或付费模型。上述只验证具名 service/Host 链路，不关闭 Native、真实企微认证、Web managed remote 或全部平台验收。
