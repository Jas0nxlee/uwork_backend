import { useEffect, useRef, useState } from "react";
import { Save, RefreshCw, Plus, KeyRound } from "lucide-react";
import { api, display, type Row } from "./api";
import { FormDialog, Modal, type Field } from "./forms";

export function Settings({
  view,
  base,
  notify,
}: {
  view: string;
  base: string;
  notify: (s: string) => void;
}) {
  const [data, setData] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [form, setForm] = useState<{
      title: string;
      fields: Field[];
      submit: (d: Row) => Promise<void>;
    } | null>(null),
    [detail, setDetail] = useState<unknown>(null),
    [retention, setRetention] = useState<Row>({}),
    [limits, setLimits] = useState<Row[]>([]);
  const mounted = useRef(false);
  const requestGeneration = useRef(0);
  async function load() {
    if (!mounted.current) return;
    const generation = ++requestGeneration.current;
    const current = () =>
      mounted.current && generation === requestGeneration.current;
    try {
      if (view === "enterprise") {
        const enterprise = await api<Row>(base);
        const settings = JSON.parse(String(enterprise.settings ?? "{}")) as Row;
        const nextRetention = await api<Row>(`${base}/retention`);
        if (!current()) return;
        setData({ ...enterprise, contact: settings.contact ?? "" });
        setRetention(nextRetention);
      } else if (view === "integrations") {
        const next = await api<Row>(`${base}/integrations`);
        if (!current()) return;
        setData(next);
      } else {
        const next = await api<Row>(`${base}/subscription`);
        const nextLimits = await api<Row[]>(`${base}/limits`);
        // 晚到旧读曾把已删除限量重新显示；同一代成对读取完整后才交给当前视图。
        if (!current()) return;
        setData(next);
        setLimits(nextLimits);
      }
      setError("");
    } catch (e) {
      if (current()) setError(e instanceof Error ? e.message : "加载失败");
    }
  }
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      requestGeneration.current++;
    };
  }, [view, base]);
  const perform = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      if (!mounted.current) return;
      notify(msg);
      await load();
    } catch (e) {
      if (mounted.current)
        setError(e instanceof Error ? e.message : "操作失败");
    }
  };
  function open(
    title: string,
    fields: Field[],
    path: string,
    method = "PUT",
    transform: (d: Row) => Row = (d) => d,
  ) {
    setForm({
      title,
      fields,
      submit: async (d) => {
        await api(path, method, transform(d));
        if (!mounted.current) return;
        notify("已保存");
        await load();
      },
    });
  }
  return (
    <>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {view === "enterprise" && (
        <>
          <section className="settings-section">
            <h2>企业信息</h2>
            <p className="settings-value">{display(data?.name)}</p>
            <div className="actions">
              <button
                onClick={() =>
                  open(
                    "企业信息",
                    [
                      {
                        key: "name",
                        label: "企业名称",
                        initial: data?.name,
                        required: true,
                      },
                      {
                        key: "contact",
                        label: "联系人",
                        initial: data?.contact,
                      },
                    ],
                    base,
                    "PATCH",
                  )
                }
              >
                <Save size={16} />
                修改企业信息
              </button>
              <button
                onClick={() =>
                  void perform(
                    async () => setDetail(await api(`${base}/roles`)),
                    "",
                  )
                }
              >
                角色权限
              </button>
            </div>
          </section>
          <section className="settings-section">
            <h2>日志与留存</h2>
            <p className="settings-value">
              {retention.configured
                ? `已配置：保留 ${display(retention.days)} 天`
                : `未配置：按默认 ${display(retention.days)} 天，仅手动清理`}
            </p>
            <div className="actions">
              <button
                onClick={() =>
                  open(
                    "留存天数",
                    [
                      {
                        key: "days",
                        label: "保留天数（7-3650）",
                        type: "number",
                        initial: retention.days,
                        required: true,
                        min: 7,
                      },
                    ],
                    `${base}/retention`,
                  )
                }
              >
                <Save size={16} />
                设置留存
              </button>
              <button
                onClick={() =>
                  void perform(
                    async () =>
                      setDetail(
                        await api(`${base}/retention/purge`, "POST", {}),
                      ),
                    "已按留存窗口清理",
                  )
                }
              >
                立即清理
              </button>
            </div>
          </section>
          <section className="settings-section">
            <h2>企业微信</h2>
            <div className="actions">
              <button
                onClick={() =>
                  open(
                    "企业微信应用",
                    [
                      { key: "corpId", label: "CorpId", required: true },
                      { key: "agentId", label: "AgentId", required: true },
                      {
                        key: "credentialId",
                        label: "Secret 凭据 ID",
                        required: true,
                      },
                    ],
                    `${base}/wecom`,
                  )
                }
              >
                配置应用
              </button>
              <button
                onClick={() =>
                  void perform(
                    async () => setDetail(await api(`${base}/wecom`)),
                    "",
                  )
                }
              >
                应用与回调
              </button>
              <button
                onClick={() =>
                  setForm({
                    title: "绑定企微身份",
                    fields: [
                      { key: "userId", label: "成员 ID", required: true },
                      {
                        key: "externalId",
                        label: "企微 UserId",
                        required: true,
                      },
                    ],
                    submit: async (d) => {
                      await api(
                        `${base}/members/${encodeURIComponent(String(d.userId))}/wecom`,
                        "PUT",
                        { externalId: d.externalId },
                      );
                      notify("企微身份已绑定");
                    },
                  })
                }
              >
                绑定身份
              </button>
              <button
                onClick={() =>
                  void perform(
                    () => api(`${base}/wecom/sync`, "POST"),
                    "通讯录已同步",
                  )
                }
              >
                <RefreshCw size={16} />
                同步通讯录
              </button>
            </div>
          </section>
          <section className="settings-section">
            <h2>终端凭据</h2>
            <div className="actions">
              <button
                onClick={() =>
                  void perform(
                    async () => setDetail(await api("/api/auth/device-tokens")),
                    "",
                  )
                }
              >
                查看我的终端凭据
              </button>
              <button
                onClick={() =>
                  setForm({
                    title: "签发终端凭据",
                    fields: [
                      {
                        key: "ttlHours",
                        label: "有效小时",
                        type: "number",
                        initial: 24,
                        min: 1,
                        max: 168,
                      },
                    ],
                    submit: async (d) => {
                      setDetail(
                        await api("/api/auth/device-tokens", "POST", d),
                      );
                    },
                  })
                }
              >
                <KeyRound size={16} />
                签发凭据
              </button>
            </div>
          </section>
        </>
      )}
      {view === "subscription" && data && (
        <>
          <div className="stats">
            <div>
              <span>总席位</span>
              <strong>{display(data.seats)}</strong>
            </div>
            <div>
              <span>已分配</span>
              <strong>{display(data.assignedSeats)}</strong>
            </div>
            <div>
              <span>周期 Credit</span>
              <strong>{display(data.credits)}</strong>
            </div>
            <div>
              <span>已使用</span>
              <strong>{display((data.usage as Row)?.consumed)}</strong>
            </div>
          </div>
          <section className="settings-section">
            <h2>本地订阅</h2>
            <p>
              有效期：{new Date(Number(data.starts_at)).toLocaleDateString()} 至{" "}
              {new Date(Number(data.ends_at)).toLocaleDateString()}
            </p>
            <button
              onClick={() =>
                open(
                  "本地订阅",
                  [
                    {
                      key: "seats",
                      label: "席位",
                      type: "number",
                      initial: data.seats,
                      min: 1,
                    },
                    {
                      key: "credits",
                      label: "周期 Credit",
                      type: "number",
                      initial: data.credits,
                      min: 0,
                    },
                    {
                      key: "startsAt",
                      label: "开始时间戳",
                      type: "number",
                      initial: data.starts_at,
                    },
                    {
                      key: "endsAt",
                      label: "结束时间戳",
                      type: "number",
                      initial: data.ends_at,
                    },
                    {
                      key: "metering",
                      label: "计量周期",
                      type: "select",
                      initial: data.metering,
                      options: [
                        { value: "calendar", label: "自然月" },
                        { value: "subscription", label: "订阅月" },
                      ],
                    },
                  ],
                  `${base}/subscription`,
                )
              }
            >
              调整订阅
            </button>
          </section>
          <section className="settings-section">
            <div className="section-heading">
              <h2>限量规则</h2>
              <button
                onClick={() =>
                  open(
                    "设置限量",
                    [
                      {
                        key: "subjectType",
                        label: "对象类型",
                        type: "select",
                        initial: "member",
                        options: [
                          "tenant",
                          "member",
                          "department",
                          "application",
                        ].map((v) => ({ value: v, label: v })),
                      },
                      { key: "subjectId", label: "对象 ID", required: true },
                      {
                        key: "amount",
                        label: "周期 Credit",
                        type: "number",
                        initial: 10000,
                        min: 0,
                      },
                    ],
                    `${base}/limits`,
                  )
                }
              >
                <Plus size={16} />
                设置限量
              </button>
            </div>
            <table>
              <thead>
                <tr>
                  <th>类型</th>
                  <th>对象</th>
                  <th>Credit</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {limits.map((r) => (
                  <tr key={`${r.subject_type}:${r.subject_id}`}>
                    <td>{display(r.subject_type)}</td>
                    <td>{display(r.subject_id)}</td>
                    <td>{display(r.amount)}</td>
                    <td>
                      <button
                        onClick={() =>
                          void perform(
                            () =>
                              api(
                                `${base}/limits/${r.subject_type}/${r.subject_id}`,
                                "DELETE",
                              ),
                            "限量已删除",
                          )
                        }
                      >
                        移除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
      {view === "integrations" && (
        <>
          <section className="settings-section">
            <h2>服务能力</h2>
            <dl className="capabilities">
              {Object.entries((data?.capabilities ?? {}) as Row).map(
                ([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>
                      <span className="status">{display(v)}</span>
                    </dd>
                  </div>
                ),
              )}
            </dl>
          </section>
          <section className="settings-section">
            <h2>网盘适配服务</h2>
            <div className="actions">
              <button
                onClick={() =>
                  open(
                    "网盘适配",
                    [
                      { key: "baseUrl", label: "基础地址", required: true },
                      { key: "credentialId", label: "凭据 ID", required: true },
                      {
                        key: "enabled",
                        label: "启用",
                        type: "checkbox",
                        initial: true,
                      },
                    ],
                    `${base}/integrations/drive`,
                  )
                }
              >
                配置
              </button>
              {["health", "capacity", "files", "logs"].map((k) => (
                <button
                  key={k}
                  onClick={() =>
                    void perform(
                      async () =>
                        setDetail(await api(`${base}/integrations/drive/${k}`)),
                      "",
                    )
                  }
                >
                  {
                    {
                      health: "连接状态",
                      capacity: "容量",
                      files: "文件",
                      logs: "日志",
                    }[k]
                  }
                </button>
              ))}
              <button
                onClick={() =>
                  open(
                    "容量策略",
                    [
                      {
                        key: "defaultBytes",
                        label: "默认字节数",
                        type: "number",
                        initial: 0,
                        min: 0,
                      },
                      {
                        key: "members",
                        label: "成员容量",
                        type: "json",
                        initial: [],
                      },
                    ],
                    `${base}/integrations/drive/capacity`,
                  )
                }
              >
                容量策略
              </button>
            </div>
          </section>
        </>
      )}
      {form && (
        <FormDialog
          title={form.title}
          fields={form.fields}
          onSubmit={form.submit}
          onClose={() => setForm(null)}
        />
      )}
      {detail !== null && (
        <Modal title="结果" onClose={() => setDetail(null)}>
          <pre className="detail">{JSON.stringify(detail, null, 2)}</pre>
        </Modal>
      )}
    </>
  );
}
export function Overview({ base }: { base: string }) {
  const [metrics, setMetrics] = useState<Row>({}),
    [subscription, setSubscription] = useState<Row>({}),
    [error, setError] = useState("");
  useEffect(() => {
    Promise.all([api<Row>(`${base}/metrics`), api<Row>(`${base}/subscription`)])
      .then(([m, s]) => {
        setMetrics(m);
        setSubscription(s);
      })
      .catch((e) => setError(e.message));
  }, [base]);
  const summary = (metrics.summary ?? {}) as Row;
  const daily = (metrics.daily ?? []) as Row[];
  return (
    <>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="stats">
        <div>
          <span>活跃成员</span>
          <strong>{display(summary.activeUsers ?? 0)}</strong>
        </div>
        <div>
          <span>调用次数</span>
          <strong>{display(summary.requests ?? 0)}</strong>
        </div>
        <div>
          <span>已使用 Credit</span>
          <strong>
            {display(((subscription.usage ?? {}) as Row).consumed ?? 0)}
          </strong>
        </div>
        <div>
          <span>剩余席位</span>
          <strong>
            {Number(subscription.seats ?? 0) -
              Number(subscription.assignedSeats ?? 0)}
          </strong>
        </div>
      </div>
      <section className="settings-section">
        <div className="section-heading">
          <h2>调用趋势</h2>
          <span>UTC / 每日</span>
        </div>
        {daily.length ? (
          <div className="bar-chart">
            {daily.map((r) => (
              <div key={String(r.date)} className="bar-item">
                <span>{display(r.requests)}</span>
                <div
                  className="bar"
                  style={{
                    height: `${Math.max(4, (Number(r.requests) / Math.max(...daily.map((d) => Number(d.requests)))) * 160)}px`,
                  }}
                />
                <small>{String(r.date).slice(5)}</small>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty">暂无调用记录</div>
        )}
      </section>
      <section className="settings-section">
        <h2>运行指标</h2>
        <dl className="capabilities">
          <div>
            <dt>输入 Token</dt>
            <dd>{display(summary.inputTokens ?? 0)}</dd>
          </div>
          <div>
            <dt>输出 Token</dt>
            <dd>{display(summary.outputTokens ?? 0)}</dd>
          </div>
          <div>
            <dt>平均响应</dt>
            <dd>{Math.round(Number(summary.averageLatencyMs ?? 0))} ms</dd>
          </div>
          <div>
            <dt>失败请求</dt>
            <dd>{display(summary.failures ?? 0)}</dd>
          </div>
        </dl>
      </section>
    </>
  );
}
