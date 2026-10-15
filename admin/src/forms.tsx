import { useEffect, useRef, useState } from "react";
import { X, Save, Trash2, Plus } from "lucide-react";
import { api, type Row } from "./api";

export interface Field {
  key: string;
  label: string;
  type?:
    | "text"
    | "password"
    | "number"
    | "textarea"
    | "json"
    | "select"
    | "checkbox"
    | "email";
  options?: { value: string; label: string }[];
  initial?: unknown;
  required?: boolean;
  min?: number;
  max?: number;
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} onCancel={onClose}>
      <div className="modal-heading">
        <h2>{title}</h2>
        <button
          title="关闭"
          aria-label="关闭"
          className="icon"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function FormDialog({
  title,
  fields,
  initial = {},
  onSubmit,
  onClose,
}: {
  title: string;
  fields: Field[];
  initial?: Row;
  onSubmit: (data: Row) => Promise<void>;
  onClose: () => void;
}) {
  const [values, setValues] = useState<Row>(() =>
    Object.fromEntries(
      fields.map((f) => [
        f.key,
        initial[f.key] ?? f.initial ?? (f.type === "checkbox" ? false : ""),
      ]),
    ),
  );
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const data: Row = {};
            for (const f of fields) {
              const value = values[f.key];
              if (f.type === "json")
                data[f.key] =
                  typeof value === "string" ? JSON.parse(value) : value;
              else if (f.type === "number") data[f.key] = Number(value);
              else data[f.key] = value;
            }
            await onSubmit(data);
            onClose();
          } catch (e) {
            setError(e instanceof Error ? e.message : "保存失败");
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-grid">
          {fields.map((f) => (
            <label
              className={
                f.type === "json" || f.type === "textarea" ? "full" : ""
              }
              key={f.key}
            >
              <span>
                {f.label}
                {f.required ? " *" : ""}
              </span>
              {f.type === "checkbox" ? (
                <input
                  type="checkbox"
                  checked={!!values[f.key]}
                  onChange={(e) =>
                    setValues({ ...values, [f.key]: e.target.checked })
                  }
                />
              ) : f.type === "select" ? (
                <select
                  value={String(values[f.key])}
                  required={f.required}
                  onChange={(e) =>
                    setValues({ ...values, [f.key]: e.target.value })
                  }
                >
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : f.type === "textarea" || f.type === "json" ? (
                <textarea
                  className={f.type === "json" ? "code" : ""}
                  rows={f.type === "json" ? 8 : 5}
                  required={f.required}
                  value={
                    typeof values[f.key] === "string"
                      ? String(values[f.key])
                      : JSON.stringify(values[f.key], null, 2)
                  }
                  onChange={(e) =>
                    setValues({ ...values, [f.key]: e.target.value })
                  }
                />
              ) : (
                <input
                  type={f.type ?? "text"}
                  min={f.min}
                  max={f.max}
                  autoComplete={f.type === "password" ? "new-password" : "off"}
                  required={f.required}
                  value={String(values[f.key])}
                  onChange={(e) =>
                    setValues({ ...values, [f.key]: e.target.value })
                  }
                />
              )}
            </label>
          ))}
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <footer>
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary" disabled={busy}>
            <Save size={16} />
            {busy ? "保存中" : "保存"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
const fieldNames: Record<string, string> = {
  items: "菜单",
  name: "中文名称",
  nameEn: "英文名称",
  enabled: "启用",
  builtin: "内置",
  url: "地址",
  icon: "图标",
  id: "标识",
  welcome: "欢迎语",
  riskNotice: "风险说明",
  local: "本地助理",
  cloud: "云助理",
  agents: "企业智能体",
  mobile: "移动渠道",
  scope: "可见范围",
  all: "全部成员",
  members: "成员 ID",
  departments: "部门 ID",
  publish: "发布范围",
  collaborate: "协作范围",
  files: "实体文件",
  wechat: "微信渠道",
  wecom: "企微渠道",
  models: "个人模型",
  skills: "个人技能",
  connectors: "个人连接器",
  mcpHub: "MCP Hub",
  whitelist: "IP / CIDR",
  allowShell: "命令执行",
  allowFilesystem: "文件访问",
  allowNetwork: "网络访问",
  allowSandbox: "隔离代码执行",
  dangerousSkills: "高风险技能",
  allowedDomains: "允许的域名",
};
export function ValueEditor({
  value,
  onChange,
  name = "",
}: {
  value: unknown;
  onChange: (v: unknown) => void;
  name?: string;
}) {
  if (Array.isArray(value))
    return (
      <div className="array-field">
        {value.map((v, i) => (
          <div className="array-row" key={i}>
            <ValueEditor
              name={name}
              value={v}
              onChange={(next) =>
                onChange(value.map((x, j) => (j === i ? next : x)))
              }
            />
            {!(typeof v === "object" && v?.builtin) && (
              <button
                className="icon danger"
                title="移除"
                aria-label="移除"
                onClick={() => onChange(value.filter((_, j) => j !== i))}
              >
                <Trash2 size={16} />
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            onChange([
              ...value,
              name === "items"
                ? {
                    id: `custom-${Date.now()}`,
                    name: "",
                    nameEn: "",
                    url: "https://",
                    enabled: true,
                    builtin: false,
                    icon: "globe",
                  }
                : "",
            ])
          }
        >
          <Plus size={15} />
          添加
        </button>
      </div>
    );
  if (value !== null && typeof value === "object")
    return (
      <div className="value-grid">
        {Object.entries(value)
          .filter(([k]) => k !== "builtin")
          .map(([k, v]) => (
            <label
              key={k}
              className={
                Array.isArray(v) || typeof v === "object" ? "full" : ""
              }
            >
              <span>{fieldNames[k] ?? k}</span>
              <ValueEditor
                name={k}
                value={v}
                onChange={(next) => onChange({ ...value, [k]: next })}
              />
            </label>
          ))}
      </div>
    );
  if (typeof value === "boolean")
    return (
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
      />
    );
  if (name === "publish" || name === "collaborate")
    return (
      <select value={String(value)} onChange={(e) => onChange(e.target.value)}>
        {[
          ["organization", "组织内"],
          ["internet", "全网"],
          ["disabled", "关闭"],
        ].map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    );
  if (name === "icon")
    return (
      <select value={String(value)} onChange={(e) => onChange(e.target.value)}>
        {["message", "bot", "library", "globe", "folder"].map((v) => (
          <option key={v}>{v}</option>
        ))}
      </select>
    );
  return (
    <input
      type={typeof value === "number" ? "number" : "text"}
      value={value === null ? "" : String(value)}
      onChange={(e) =>
        onChange(
          typeof value === "number"
            ? Number(e.target.value)
            : name === "mcpHub" && e.target.value === ""
              ? null
              : e.target.value,
        )
      }
    />
  );
}
export function Configuration({
  base,
  notify,
}: {
  base: string;
  notify: (s: string) => void;
}) {
  const [kind, setKind] = useState("menus"),
    [data, setData] = useState<unknown>(null),
    [revision, setRevision] = useState(0),
    [version, setVersion] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load(selected = kind) {
    try {
      const r = await api<{
        draft: unknown;
        revision: number;
        version: number;
      }>(`${base}/configurations/${selected}`);
      setData(r.draft);
      setRevision(r.revision);
      setVersion(r.version);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    }
  }
  useEffect(() => {
    void load(kind);
  }, [kind, base]);
  async function action(action: "save" | "publish" | "discard") {
    setBusy(true);
    try {
      if (action === "save")
        await api(`${base}/configurations/${kind}`, "PUT", { revision, data });
      if (action === "publish")
        await api(`${base}/configurations/${kind}/publish`, "POST", {
          revision,
        });
      if (action === "discard")
        await api(`${base}/configurations/${kind}/draft`, "DELETE");
      await load();
      notify(
        action === "publish"
          ? "配置已发布"
          : action === "save"
            ? "草稿已保存"
            : "已恢复已发布配置",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="tabs">
        {[
          ["menus", "菜单"],
          ["new-chat", "新对话"],
          ["assistants", "助理渠道"],
          ["sharing", "分享协作"],
          ["personal", "个人资产"],
          ["security", "安全基线"],
          ["network", "IP 白名单"],
        ].map(([k, l]) => (
          <button
            className={kind === k ? "active" : ""}
            key={k}
            onClick={() => setKind(k)}
          >
            {l}
          </button>
        ))}
      </div>
      <div className="section-heading">
        <span>
          发布版本 {version} · 草稿修订 {revision}
        </span>
        <div className="actions">
          <button disabled={busy} onClick={() => void action("discard")}>
            放弃草稿
          </button>
          <button disabled={busy} onClick={() => void action("save")}>
            <Save size={16} />
            保存草稿
          </button>
          <button
            className="primary"
            disabled={busy || revision === 0}
            onClick={() => void action("publish")}
          >
            发布
          </button>
        </div>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {data !== null && (
        <div className="configuration">
          <ValueEditor value={data} onChange={setData} />
        </div>
      )}
    </>
  );
}
