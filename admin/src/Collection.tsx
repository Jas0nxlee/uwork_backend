import { useEffect, useRef, useState } from "react";
import {
  Plus,
  Search,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Trash2,
  Eye,
  Play,
  Square,
  Upload,
  Check,
  Download,
  Power,
  Link2,
} from "lucide-react";
import { api, display, date, type Row } from "./api";
import { FormDialog, Modal, type Field } from "./forms";
import type { View } from "./catalog";

const nested = (row: Row, key: string): unknown =>
  key
    .split(".")
    .reduce<unknown>(
      (v, k) => (v && typeof v === "object" ? (v as Row)[k] : undefined),
      row,
    );
export function Collection({
  view,
  base,
  notify,
  canWrite,
  canManageIdentity = false,
}: {
  view: View;
  base: string;
  notify: (s: string) => void;
  canWrite: boolean;
  canManageIdentity?: boolean;
}) {
  const [rows, setRows] = useState<Row[]>([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(1),
    [q, setQ] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [form, setForm] = useState<{
      title: string;
      fields: Field[];
      initial?: Row;
      submit: (d: Row) => Promise<void>;
    } | null>(null),
    [detail, setDetail] = useState<unknown>(null),
    [pendingDelete, setPendingDelete] = useState<Row | null>(null),
    [pendingDeleteBusy, setPendingDeleteBusy] = useState(false),
    [filters, setFilters] = useState<Record<string, string>>({});
  const requestGeneration = useRef(0);
  const deleteInFlight = useRef(false);
  const mounted = useRef(true);
  const currentLoad = useRef<() => Promise<void>>(async () => {});
  const filterQuery = () =>
    (view.filters ?? [])
      .map(
        (filter) =>
          `${encodeURIComponent(filter.key)}=${encodeURIComponent(
            filters[filter.key] ?? filter.options[0]?.value ?? "",
          )}`,
      )
      .join("&");
  async function fetchRows() {
    const generation = ++requestGeneration.current;
    setLoading(true);
    try {
      const extra = filterQuery();
      const data = await api<Row[] | { items: Row[]; total: number }>(
        `${base}${view.path}?page=${page}&pageSize=25&q=${encodeURIComponent(q)}${extra ? `&${extra}` : ""}`,
      );
      if (generation !== requestGeneration.current) return;
      let items = Array.isArray(data) ? data : data.items;
      if (view.id === "security")
        items = items.filter((r) => r.family === "security");
      if (view.id === "policies")
        items = items.filter((r) => r.family !== "security");
      if (Array.isArray(data) && q && view.id !== "usage-aggregates")
        items = items.filter((r) => display(r.name ?? r.id).includes(q));
      setRows(items);
      setTotal(Array.isArray(data) ? items.length : data.total);
      setError("");
    } catch (e) {
      if (generation === requestGeneration.current)
        setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
    }
  }
  // 异步操作返回时页面可能已翻页；始终刷新当前查询，不重新执行旧闭包的分页。
  currentLoad.current = fetchRows;
  async function load() {
    if (mounted.current) await currentLoad.current();
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestGeneration.current++;
    };
  }, []);
  useEffect(() => {
    setPage(1);
    setQ("");
    setFilters({});
  }, [view.id]);
  useEffect(() => {
    void load();
    return () => {
      requestGeneration.current++;
    };
  }, [view.id, base, page, filters]);
  const invoke = async (fn: () => Promise<unknown>, message = "操作完成") => {
    try {
      await fn();
      if (!mounted.current) return;
      notify(message);
      await load();
    } catch (e) {
      if (mounted.current)
        setError(e instanceof Error ? e.message : "操作失败");
    }
  };
  function closeDelete() {
    if (!deleteInFlight.current) setPendingDelete(null);
  }
  async function confirmDelete() {
    if (!pendingDelete || deleteInFlight.current) return;
    // 连续点击曾在首个响应返回前重复DELETE；同步准入锁也覆盖React提交busy前的窗口。
    const selected = pendingDelete;
    deleteInFlight.current = true;
    setPendingDeleteBusy(true);
    try {
      await invoke(async () => {
        await api(`${base}${view.path}/${selected.id}`, "DELETE");
        setPendingDelete(null);
      });
    } finally {
      deleteInFlight.current = false;
      if (mounted.current) setPendingDeleteBusy(false);
    }
  }
  function create() {
    if (!view.fields) return;
    setForm({
      title: `新建${view.label}`,
      fields: view.fields,
      submit: async (d) => {
        if ("parentId" in d && d.parentId === "") d.parentId = null;
        if ("departmentId" in d && d.departmentId === "") d.departmentId = null;
        if ("webhookCredentialId" in d && d.webhookCredentialId === "")
          d.webhookCredentialId = null;
        await api(
          `${base}${view.id === "security" ? "/policies/security" : view.path}`,
          "POST",
          d,
        );
        notify("已创建");
        await load();
      },
    });
  }
  function edit(r: Row) {
    if (view.id === "runtimes") {
      setForm({
        title: "Runtime 设置",
        fields: [
          { key: "name", label: "名称", required: true },
          { key: "scope", label: "可见范围", type: "json", required: true },
        ],
        initial: { name: r.name, scope: r.scope },
        submit: async (d) => {
          await api(`${base}/runtimes/${r.id}`, "PATCH", {
            ...d,
            revision: r.revision,
          });
          await load();
          notify("Runtime 已更新");
        },
      });
      return;
    }
    if (view.id === "credentials") {
      setForm({
        title: "轮换凭据",
        fields: [
          { key: "value", label: "新凭据", type: "password", required: true },
        ],
        submit: async (d) => {
          await api(`${base}/credentials/${r.id}`, "PUT", d);
          await load();
        },
      });
      return;
    }
    if (view.id === "members") {
      setForm({
        title: "成员权限与席位",
        fields: [
          {
            key: "role",
            label: "角色",
            type: "select",
            options: ["member", "auditor", "operator", "admin", "owner"].map(
              (v) => ({ value: v, label: v }),
            ),
          },
          { key: "departmentId", label: "部门 ID" },
          {
            key: "status",
            label: "状态",
            type: "select",
            options: ["active", "disabled"].map((v) => ({
              value: v,
              label: v,
            })),
          },
          { key: "seat", label: "席位", type: "checkbox" },
        ],
        initial: { ...r, departmentId: r.department_id ?? "", seat: !!r.seat },
        submit: async (d) => {
          await api(`${base}/members/${r.id}`, "PATCH", {
            ...d,
            departmentId: d.departmentId || null,
          });
          await load();
        },
      });
      return;
    }
    if (!view.fields) return;
    const initial: Row = { ...((r.data as Row) ?? {}), ...r, scope: r.scope };
    if (view.id === "assets") initial.kind = (r.data as Row).kind;
    if (view.id === "departments") initial.parentId = r.parent_id ?? "";
    setForm({
      title: `编辑${display(r.name)}`,
      fields: view.fields,
      initial,
      submit: async (d) => {
        if ("parentId" in d && d.parentId === "") d.parentId = null;
        await api(
          `${base}${view.path}/${r.id}`,
          view.id === "departments" ? "PATCH" : "PUT",
          view.id === "departments" ? d : { ...d, revision: r.revision },
        );
        await load();
        notify("已保存");
      },
    });
  }
  function versionAction(r: Row, action: "review" | "publish") {
    setForm({
      title: action === "review" ? "审核版本" : "发布版本",
      fields: [
        {
          key: "version",
          label: "版本号",
          type: "number",
          initial: r.published_version ?? 1,
          min: 1,
        },
      ],
      submit: async (d) => {
        await api(`${base}${view.path}/${r.id}/${action}`, "POST", {
          ...d,
          ...(action === "review" ? { approved: true } : {}),
        });
        await load();
        notify(action === "review" ? "审核通过" : "已发布");
      },
    });
  }
  const exportable = ["usage", "audit", "traces", "client-events"].includes(
    view.id,
  );
  return (
    <>
      <div className="toolbar">
        <form
          className="search"
          onSubmit={(e) => {
            e.preventDefault();
            if (page === 1) void load();
            else setPage(1);
          }}
        >
          <Search size={16} />
          <input
            aria-label="搜索"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索"
          />
          <button type="submit">查询</button>
        </form>
        {(view.filters ?? []).map((filter) => (
          <label key={filter.key} className="filter">
            {filter.label}
            <select
              aria-label={filter.label}
              value={filters[filter.key] ?? filter.options[0]?.value ?? ""}
              onChange={(e) => {
                setPage(1);
                setFilters((current) => ({
                  ...current,
                  [filter.key]: e.target.value,
                }));
              }}
            >
              {filter.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ))}
        <div className="actions">
          <button
            className="icon"
            title="刷新"
            aria-label="刷新"
            onClick={() => void load()}
          >
            <RefreshCw size={17} />
          </button>
          {exportable && (
            <a
              className="button"
              href={`${base}${view.path}?format=csv&q=${encodeURIComponent(q)}`}
            >
              <Download size={16} />
              导出
            </a>
          )}
          {view.fields && canWrite && (
            <button className="primary" onClick={create}>
              <Plus size={17} />
              新建
            </button>
          )}
        </div>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="table-scroll" aria-busy={loading}>
        <table>
          <thead>
            <tr>
              {view.columns?.map((c) => (
                <th key={c.key}>{c.label}</th>
              ))}
              <th className="operation">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r.id ?? r.user_id ?? r.subject)}>
                {view.columns?.map((c) => (
                  <td key={c.key} title={display(nested(r, c.key))}>
                    {c.key === "status" ? (
                      <span className={`status ${display(r.status)}`}>
                        {display(r.status)}
                      </span>
                    ) : c.key.endsWith("_at") || c.key.endsWith("At") ? (
                      date(nested(r, c.key))
                    ) : (
                      display(nested(r, c.key))
                    )}
                  </td>
                ))}
                <td className="row-actions">
                  <button
                    className="icon"
                    title="详情"
                    aria-label="详情"
                    onClick={() =>
                      void invoke(async () => {
                        if (view.id === "runs") {
                          const run = await api<Row>(`${base}/runs/${r.id}`);
                          setDetail({
                            ...run,
                            tools: await api(`${base}/runs/${r.id}/tools`),
                          });
                        } else if (
                          [
                            "datasets",
                            "evaluations",
                            "runtimes",
                            "sandbox-executions",
                          ].includes(view.id)
                        )
                          setDetail(await api(`${base}${view.path}/${r.id}`));
                        else setDetail(r);
                      }, "")
                    }
                  >
                    <Eye size={16} />
                  </button>
                  {view.id === "members" && canManageIdentity && (
                    <button
                      className="icon"
                      title="绑定企微身份"
                      aria-label={`绑定 ${display(r.name)} 的企微身份`}
                      onClick={() =>
                        setForm({
                          title: `绑定企微身份 · ${display(r.name)}`,
                          fields: [
                            {
                              key: "externalId",
                              label: "企微 UserId",
                              required: true,
                            },
                          ],
                          initial: { externalId: r.external_id ?? "" },
                          submit: async (d) => {
                            await api(
                              `${base}/members/${encodeURIComponent(String(r.id))}/wecom`,
                              "PUT",
                              { externalId: d.externalId },
                            );
                            await load();
                            notify("企微身份已绑定");
                          },
                        })
                      }
                    >
                      <Link2 size={16} />
                    </button>
                  )}
                  {canWrite && !view.readonly && (
                    <>
                      {[
                        "models",
                        "assets",
                        "agents",
                        "members",
                        "departments",
                        "credentials",
                        "runtimes",
                      ].includes(view.id) && (
                        <button
                          className="icon"
                          title="编辑"
                          aria-label="编辑"
                          onClick={() => edit(r)}
                        >
                          <Pencil size={15} />
                        </button>
                      )}
                      {view.id === "models" && (
                        <button
                          className="icon"
                          title="测试连接"
                          aria-label="测试连接"
                          onClick={() =>
                            void invoke(
                              async () =>
                                setDetail(
                                  await api(
                                    `${base}/models/${r.id}/probe`,
                                    "POST",
                                  ),
                                ),
                              "测试完成",
                            )
                          }
                        >
                          <Play size={16} />
                        </button>
                      )}
                      {view.id === "assets" && (
                        <button
                          className="icon"
                          title="审核"
                          aria-label="审核"
                          onClick={() => versionAction(r, "review")}
                        >
                          <Check size={16} />
                        </button>
                      )}
                      {["assets", "agents"].includes(view.id) && (
                        <button
                          className="icon"
                          title="发布"
                          aria-label="发布"
                          onClick={() => versionAction(r, "publish")}
                        >
                          <Upload size={16} />
                        </button>
                      )}
                      {view.id === "agents" && (
                        <button
                          className="icon"
                          title="执行"
                          aria-label="执行"
                          onClick={() =>
                            setForm({
                              title: "执行任务",
                              fields: [
                                {
                                  key: "input",
                                  label: "任务输入",
                                  type: "textarea",
                                  required: true,
                                },
                              ],
                              submit: async (d) => {
                                await api(`${base}/runs`, "POST", {
                                  agentId: r.id,
                                  ...d,
                                });
                                notify("任务已进入队列");
                              },
                            })
                          }
                        >
                          <Play size={16} />
                        </button>
                      )}
                      {view.id === "runtimes" && (
                        <>
                          <button
                            className="icon"
                            title="执行代码"
                            aria-label="执行代码"
                            disabled={r.status !== "ready"}
                            onClick={() =>
                              setForm({
                                title: "隔离代码执行",
                                fields: [
                                  {
                                    key: "code",
                                    label: "JavaScript",
                                    type: "textarea",
                                    required: true,
                                    initial: "console.log(1 + 1)",
                                  },
                                  {
                                    key: "timeoutMs",
                                    label: "超时 / 毫秒",
                                    type: "number",
                                    initial: 30000,
                                    min: 100,
                                    max: 1800000,
                                  },
                                ],
                                submit: async (d) => {
                                  const result = await api(
                                    `${base}/runtimes/${r.id}/executions`,
                                    "POST",
                                    d,
                                  );
                                  setDetail(result);
                                  notify("代码执行已受理");
                                  await load();
                                },
                              })
                            }
                          >
                            <Play size={16} />
                          </button>
                          {["ready", "busy"].includes(String(r.status)) && (
                            <button
                              className="icon danger"
                              title="停止 Runtime"
                              aria-label="停止 Runtime"
                              onClick={() =>
                                void invoke(() =>
                                  api(`${base}/runtimes/${r.id}/stop`, "POST"),
                                )
                              }
                            >
                              <Square size={15} />
                            </button>
                          )}
                        </>
                      )}
                      {["runs", "evaluations", "sandbox-executions"].includes(
                        view.id,
                      ) &&
                        ["running", "queued"].includes(String(r.status)) && (
                          <button
                            className="icon danger"
                            title="取消执行"
                            aria-label="取消执行"
                            onClick={() =>
                              void invoke(() =>
                                api(
                                  `${base}${view.path}/${r.id}/cancel`,
                                  "POST",
                                ),
                              )
                            }
                          >
                            <Square size={15} />
                          </button>
                        )}
                      {["policies", "security", "automations"].includes(
                        view.id,
                      ) && (
                        <button
                          className="icon"
                          title={r.enabled ? "停用" : "启用"}
                          aria-label={r.enabled ? "停用" : "启用"}
                          onClick={() =>
                            void invoke(() =>
                              api(`${base}${view.path}/${r.id}`, "PATCH", {
                                enabled: !r.enabled,
                              }),
                            )
                          }
                        >
                          <Power size={16} />
                        </button>
                      )}
                      {![
                        "members",
                        "runs",
                        "evaluations",
                        "sandbox-executions",
                      ].includes(view.id) && (
                        <button
                          className="icon danger"
                          title="停用或删除"
                          aria-label="停用或删除"
                          onClick={() => {
                            setError("");
                            setPendingDelete(r);
                          }}
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td className="empty" colSpan={(view.columns?.length ?? 0) + 1}>
                  {loading ? "正在加载" : "暂无记录"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="pagination">
        <span>共 {total} 条</span>
        <div>
          <button
            className="icon"
            title="上一页"
            aria-label="上一页"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            <ChevronLeft size={17} />
          </button>
          <span>{page}</span>
          <button
            className="icon"
            title="下一页"
            aria-label="下一页"
            disabled={!view.paged || page * 25 >= total}
            onClick={() => setPage(page + 1)}
          >
            <ChevronRight size={17} />
          </button>
        </div>
      </div>
      {form && (
        <FormDialog
          {...form}
          onSubmit={form.submit}
          onClose={() => setForm(null)}
        />
      )}
      {detail !== null && (
        <Modal title="详情" onClose={() => setDetail(null)}>
          <pre className="detail">{JSON.stringify(detail, null, 2)}</pre>
        </Modal>
      )}
      {pendingDelete && (
        <Modal title="确认操作" onClose={closeDelete}>
          <p>
            确认
            {["assets", "agents", "models", "credentials"].includes(view.id)
              ? "停用"
              : "删除"}
            「{display(pendingDelete.name ?? pendingDelete.id)}」？
          </p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <footer>
            <button disabled={pendingDeleteBusy} onClick={closeDelete}>
              取消
            </button>
            <button
              className="danger"
              disabled={pendingDeleteBusy}
              onClick={() => void confirmDelete()}
            >
              {pendingDeleteBusy ? "处理中…" : "确认"}
            </button>
          </footer>
        </Modal>
      )}
    </>
  );
}
