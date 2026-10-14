import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Building2,
  Bot,
  LayoutDashboard,
  Library,
  ShieldCheck,
  Users,
  Activity,
  Settings2,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import { api, HttpError } from "./api";
import { views } from "./catalog";
import { Collection } from "./Collection";
import { Configuration } from "./forms";
import { Settings, Overview } from "./Settings";
import "./style.css";
interface Me {
  user: { id: string; name: string };
  tenant: { id: string; name: string };
  role: string;
  organizations: { id: string; name: string }[];
}
function App() {
  const [me, setMe] = useState<Me | null>(null),
    [checking, setChecking] = useState(true),
    [viewId, setViewId] = useState(location.hash.slice(1) || "overview"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [toast, setToast] = useState(""),
    [navOpen, setNavOpen] = useState(false);
  useEffect(() => {
    api<Me>("/api/auth/me")
      .then(setMe)
      .catch((e) => {
        if (!(e instanceof HttpError && e.status === 401)) setError(e.message);
      })
      .finally(() => setChecking(false));
    const listener = () => setViewId(location.hash.slice(1) || "overview");
    window.addEventListener("hashchange", listener);
    return () => window.removeEventListener("hashchange", listener);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(t);
  }, [toast]);
  if (checking)
    return (
      <div className="loading" role="status">
        正在连接 UWork
      </div>
    );
  if (!me)
    return (
      <div className="login">
        <div className="login-brand">
          <img src="/brand.svg" alt="UWork" />
          <span>UWork</span>
        </div>
        <h1>企业管理</h1>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            const d = new FormData(e.currentTarget);
            try {
              await api("/api/auth/login", "POST", {
                email: d.get("email"),
                password: d.get("password"),
              });
              setMe(await api<Me>("/api/auth/me"));
            } catch (e) {
              setError(e instanceof Error ? e.message : "登录失败");
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            邮箱
            <input name="email" type="email" autoComplete="username" required />
          </label>
          <label>
            密码
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy}>
            {busy ? "登录中" : "登录"}
          </button>
        </form>
      </div>
    );
  const view = views.find((v) => v.id === viewId) ?? views[0];
  const base = `/api/tenants/${me.tenant.id}`;
  const groups = [...new Set(views.map((v) => v.group))];
  const icons: Record<string, typeof Bot> = {
    工作台: LayoutDashboard,
    "AI 资源": Library,
    策略管控: ShieldCheck,
    企业智能体: Bot,
    组织管理: Users,
    用量与观测: Activity,
    企业设置: Settings2,
  };
  return (
    <div className="app">
      <aside className={navOpen ? "open" : ""}>
        <a className="brand" href="#overview">
          <img src="/brand.svg" alt="" />
          <strong>UWork</strong>
          <span>企业管理</span>
        </a>
        <button
          className="mobile-close icon"
          aria-label="关闭导航"
          title="关闭导航"
          onClick={() => setNavOpen(false)}
        >
          <X size={20} />
        </button>
        <nav>
          {groups.map((g) => {
            const Icon = icons[g];
            return (
              <div className="nav-group" key={g}>
                <div className="group-label">
                  <Icon size={14} />
                  {g}
                </div>
                {views
                  .filter((v) => v.group === g)
                  .map((v) => (
                    <a
                      key={v.id}
                      href={`#${v.id}`}
                      aria-current={v.id === view.id ? "page" : undefined}
                      onClick={() => setNavOpen(false)}
                    >
                      {v.label}
                    </a>
                  ))}
              </div>
            );
          })}
        </nav>
        <div className="profile">
          <span className="avatar">{me.user.name.slice(0, 1)}</span>
          <div>
            <strong>{me.user.name}</strong>
            <small>{me.role}</small>
          </div>
          <button
            className="icon"
            title="退出登录"
            aria-label="退出登录"
            onClick={() =>
              void api("/api/auth/logout", "POST").then(() => setMe(null))
            }
          >
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header>
          <div className="header-left">
            <button
              className="mobile-menu icon"
              title="导航"
              aria-label="导航"
              onClick={() => setNavOpen(true)}
            >
              <Menu size={20} />
            </button>
            <Building2 size={17} />
            <select
              aria-label="当前组织"
              value={me.tenant.id}
              onChange={async (e) => {
                try {
                  await api("/api/auth/switch", "POST", {
                    tenantId: e.target.value,
                  });
                  setMe(await api<Me>("/api/auth/me"));
                } catch (e) {
                  setToast(e instanceof Error ? e.message : "切换失败");
                }
              }}
            >
              {me.organizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
          <span className="environment">本地管理平台</span>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <p>{view.group}</p>
              <h1>{view.label}</h1>
            </div>
            <span className="date">
              {new Date().toLocaleDateString("zh-CN")}
            </span>
          </div>
          {me.role === "member" ? (
            <p className="error">当前成员没有管理端权限。</p>
          ) : view.id === "overview" ? (
            <Overview key={base} base={base} />
          ) : view.id === "configuration" ? (
            <fieldset
              disabled={!["owner", "admin"].includes(me.role)}
              className="policy-fieldset"
            >
              <Configuration base={base} notify={setToast} />
            </fieldset>
          ) : ["enterprise", "subscription", "integrations"].includes(
              view.id,
            ) ? (
            <Settings
              key={view.id + base}
              view={view.id}
              base={base}
              notify={setToast}
            />
          ) : (
            <Collection
              key={view.id + base}
              view={view}
              base={base}
              notify={setToast}
              canWrite={["owner", "admin", "operator"].includes(me.role)}
            />
          )}
        </main>
        <footer className="app-footer">
          <span>UWork 企业管理</span>
          <span>v0.1.0</span>
        </footer>
      </div>
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
