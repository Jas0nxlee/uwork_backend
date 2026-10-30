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
  Download,
  Power,
  Link2,
  History,
  ShieldCheck,
  Gauge,
  BadgeCheck,
} from "lucide-react";
import { api, display, date, type Row } from "./api";
import { FormDialog, Modal, type Field } from "./forms";
import type { View } from "./catalog";
import { viewAccess, type Capabilities } from "./permissions.js";
import {
  loadMemberPermissions,
  loadRuntimeCapabilities,
  rowActions,
  type RowActionId,
} from "./collectionActions.js";
import { VersionActions } from "./VersionActions.js";
import { LedgerReconcile } from "./LedgerReconcile.js";
import {
  MemberPermissionsDetails,
  RuntimeCapabilityDetails,
} from "./CapabilityViews.js";

const nested = (row: Row, key: string): unknown =>
  key
    .split(".")
    .reduce<unknown>(
      (v, k) => (v && typeof v === "object" ? (v as Row)[k] : undefined),
      row,
    );

const actionIcons: Record<RowActionId, typeof Eye> = {
  detail: Eye,
  edit: Pencil,
  probe: Play,
  versions: History,
  run: Play,
  executions: Play,
  stopRuntime: Square,
  cancelRun: Square,
  toggle: Power,
  delete: Trash2,
  wecom: Link2,
  permissions: ShieldCheck,
  reconcile: BadgeCheck,
};

export function Collection({
  view,
  base,
  notify,
  capabilities,
}: {
  view: View;
  base: string;
  notify: (s: string) => void;
  capabilities: Capabilities;
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
    [filters, setFilters] = useState<Record<string, string>>({}),
    [versionTarget, setVersionTarget] = useState<Row | null>(null),
    [reconcileTarget, setReconcileTarget] = useState<Row | null>(null),
    [permissionTarget, setPermissionTarget] = useState<Row | null>(null),
    [permissionData, setPermissionData] = useState<Row | null>(null),
    [permissionError, setPermissionError] = useState(""),
    [permissionLoading, setPermissionLoading] = useState(false),
    [capabilityOpen, setCapabilityOpen] = useState(false),
    [capabilityData, setCapabilityData] = useState<{
      runtime: Row;
      sandbox: Row;
    } | null>(null),
    [capabilityError, setCapabilityError] = useState(""),
    [capabilityLoading, setCapabilityLoading] = useState(false);
  const access = viewAccess(view.id, capabilities);
  const readable = access.read;
  const runtimesView = view.id === "runtimes";
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
    // 无读取权限时不发必然 403 的请求，也不展示误导性错误。
    if (!readable) {
      setRows([]);
      setTotal(0);
      setLoading(false);
      return;
    }
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
    if (!readable) return;
    void load();
    return () => {
      requestGeneration.current++;
    };
  }, [view.id, base, page, filters, readable]);
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
    if (!view.fields || !access.create) return;
    // 连接器需要 vault；无 vault 时不提供该选项，避免提交必被拒绝的创建。
    const fields = !access.vault
      ? view.fields.map((field) =>
          field.key === "kind"
            ? {
                ...field,
                options: field.options?.filter(
                  (option) => option.value !== "connector",
                ),
              }
            : field,
        )
      : view.fields;
    setForm({
      title: `新建${view.label}`,
      fields,
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
  function showDetail(r: Row) {
    void invoke(async () => {
      if (view.id === "runs") {
        const run = await api<Row>(`${base}/runs/${r.id}`);
        setDetail({
          ...run,
          tools: await api(`${base}/runs/${r.id}/tools`),
        });
      } else if (
        ["datasets", "evaluations", "runtimes", "sandbox-executions"].includes(
          view.id,
        )
      )
        setDetail(await api(`${base}${view.path}/${r.id}`));
      else setDetail(r);
    }, "");
  }
  function loadPermissions(r: Row) {
    setPermissionTarget(r);
    setPermissionData(null);
    setPermissionError("");
    setPermissionLoading(true);
    void loadMemberPermissions(api, base, String(r.id))
      .then((data) => {
        if (mounted.current) setPermissionData(data);
      })
      .catch((e) => {
        if (mounted.current)
          setPermissionError(e instanceof Error ? e.message : "权限加载失败");
      })
      .finally(() => {
        if (mounted.current) setPermissionLoading(false);
      });
  }
  async function showCapabilities() {
    setCapabilityOpen(true);
    setCapabilityLoading(true);
    setCapabilityError("");
    try {
      const data = await loadRuntimeCapabilities(api, base);
      if (mounted.current) setCapabilityData(data);
    } catch (e) {
      if (mounted.current)
        setCapabilityError(e instanceof Error ? e.message : "能力加载失败");
    } finally {
      if (mounted.current) setCapabilityLoading(false);
    }
  }
  // 每个分支再次检查能力，防止只靠按钮隐藏；无权时静默不发送写请求。
  function runRowAction(action: RowActionId, r: Row) {
    if (action === "detail") return showDetail(r);
    if (action === "edit") {
      if (access.update) edit(r);
      return;
    }
    if (action === "probe") {
      if (access.execute)
        void invoke(
          async () =>
            setDetail(await api(`${base}/models/${r.id}/probe`, "POST")),
          "测试完成",
        );
      return;
    }
    if (action === "versions") {
      if (access.read) setVersionTarget(r);
      return;
    }
    if (action === "run") {
      if (!access.execute) return;
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
          await api(`${base}/runs`, "POST", { agentId: r.id, ...d });
          notify("任务已进入队列");
        },
      });
      return;
    }
    if (action === "executions") {
      if (!access.execute) return;
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
      });
      return;
    }
    if (action === "stopRuntime") {
      if (access.update)
        void invoke(() => api(`${base}/runtimes/${r.id}/stop`, "POST"));
      return;
    }
    if (action === "cancelRun") {
      if (access.update)
        void invoke(() => api(`${base}${view.path}/${r.id}/cancel`, "POST"));
      return;
    }
    if (action === "toggle") {
      if (access.update)
        void invoke(() =>
          api(`${base}${view.path}/${r.id}`, "PATCH", {
            enabled: !r.enabled,
          }),
        );
      return;
    }
    if (action === "delete") {
      if (!access.remove) return;
      setError("");
      setPendingDelete(r);
      return;
    }
    if (action === "wecom") {
      if (!capabilities.identity) return;
      setForm({
        title: `绑定企微身份 · ${display(r.name)}`,
        fields: [{ key: "externalId", label: "企微 UserId", required: true }],
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
      });
      return;
    }
    if (action === "permissions") {
      if (access.read) loadPermissions(r);
      return;
    }
    if (action === "reconcile") {
      if (capabilities.identity) setReconcileTarget(r);
    }
  }
  const exportable = ["usage", "audit", "traces", "client-events"].includes(
    view.id,
  );
  // 没有读取权限的视图不发起请求，也不显示可被误解为可用的空表。
  if (!readable)
    return (
      <p className="error" role="alert">
        当前角色没有查看「{view.label}」的权限，已隐藏该页面的数据与操作。
      </p>
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
          {runtimesView && (
            <button
              className="button"
              type="button"
              onClick={() => void showCapabilities()}
            >
              <Gauge size={16} />
              运行能力
            </button>
          )}
          {view.fields && access.create && (
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
                  {rowActions(view.id, r, access, capabilities).map(
                    (action) => {
                      const Icon = actionIcons[action.id];
                      return (
                        <button
                          key={action.id}
                          className={action.danger ? "icon danger" : "icon"}
                          title={action.reason ?? action.label}
                          aria-label={action.label}
                          disabled={action.disabled}
                          onClick={() => runRowAction(action.id, r)}
                        >
                          <Icon size={16} />
                        </button>
                      );
                    },
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
      {versionTarget && (
        <VersionActions
          name={display(versionTarget.name)}
          base={base}
          path={view.path ?? ""}
          id={String(versionTarget.id)}
          mode={view.id === "agents" ? "agent" : "asset"}
          access={access}
          notify={notify}
          onClose={() => setVersionTarget(null)}
          onChanged={load}
        />
      )}
      {reconcileTarget && (
        <LedgerReconcile
          entry={reconcileTarget}
          base={base}
          notify={notify}
          onClose={() => setReconcileTarget(null)}
          onDone={load}
        />
      )}
      {permissionTarget && (
        <Modal
          title={`有效权限 · ${display(permissionTarget.name ?? permissionTarget.id)}`}
          onClose={() => setPermissionTarget(null)}
        >
          {permissionLoading && <p role="status">正在计算有效权限</p>}
          {permissionError && (
            <p className="error" role="alert">
              {permissionError}
            </p>
          )}
          {!permissionLoading && permissionError && (
            <button
              type="button"
              onClick={() => loadPermissions(permissionTarget)}
            >
              重新加载
            </button>
          )}
          {permissionData && <MemberPermissionsDetails data={permissionData} />}
        </Modal>
      )}
      {capabilityOpen && (
        <Modal title="运行能力" onClose={() => setCapabilityOpen(false)}>
          {capabilityLoading && <p role="status">正在读取运行能力</p>}
          {capabilityError && (
            <p className="error" role="alert">
              {capabilityError}
            </p>
          )}
          {!capabilityLoading && capabilityError && (
            <button type="button" onClick={() => void showCapabilities()}>
              重新加载
            </button>
          )}
          {capabilityData && (
            <RuntimeCapabilityDetails
              runtime={capabilityData.runtime}
              sandbox={capabilityData.sandbox}
            />
          )}
        </Modal>
      )}
    </>
  );
}
