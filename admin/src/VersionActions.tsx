import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { api, date } from "./api.js";
import { Modal } from "./forms.js";
import {
  loadVersions,
  publishProblem,
  publishSpec,
  reviewSpec,
  submitVersionAction,
  versionPolicy,
  type CollectionAccess,
  type Requester,
  type VersionEntry,
  type VersionMode,
} from "./collectionActions.js";

const selectedTitle = (problem: string) => (problem ? problem : undefined);

/** 纯展示层：版本表与审核/发布动作，按真实 approved 状态禁用发布。 */
export function VersionList({
  versions,
  selected,
  onSelect,
  canReview,
  canPublish,
  busy,
  onReview,
  onPublish,
  onClose,
  mode = "asset",
}: {
  versions: VersionEntry[];
  selected: VersionEntry | null;
  onSelect: (version: VersionEntry) => void;
  canReview: boolean;
  canPublish: boolean;
  busy: boolean;
  onReview: (approved: boolean) => void;
  onPublish: () => void;
  onClose?: () => void;
  mode?: VersionMode;
}) {
  const problem = publishProblem(selected, canPublish);
  return (
    <>
      <p className="field-description">
        {mode === "agent"
          ? "智能体没有审核环节，直接选择已有版本发布；发布后运行会锁定该版本。"
          : "选择真实版本审核；只有审核通过的版本可以发布，不使用默认版本。"}
      </p>
      {versions.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>版本</th>
                <th>审核</th>
                <th>创建时间</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((version) => (
                <tr
                  key={version.version}
                  className={
                    selected?.version === version.version ? "selected" : ""
                  }
                >
                  <td>
                    <label className="inline-check">
                      <input
                        type="radio"
                        name="version"
                        checked={selected?.version === version.version}
                        disabled={busy}
                        onChange={() => onSelect(version)}
                      />
                      v{version.version}
                    </label>
                  </td>
                  <td>
                    {version.approved ? (
                      <span className="status published">已通过</span>
                    ) : (
                      <span className="status draft">未通过</span>
                    )}
                  </td>
                  <td>{date(version.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty">暂无版本</p>
      )}
      {!canReview && !canPublish && (
        <p className="field-description">当前角色仅可查看版本历史。</p>
      )}
      <footer>
        {onClose && (
          <button type="button" onClick={onClose}>
            关闭
          </button>
        )}
        {canReview && (
          <>
            <button
              type="button"
              className="primary"
              disabled={!selected || busy}
              onClick={() => onReview(true)}
            >
              <Check size={16} />
              通过
            </button>
            <button
              type="button"
              className="danger"
              disabled={!selected || busy}
              onClick={() => onReview(false)}
            >
              <X size={16} />
              拒绝
            </button>
          </>
        )}
        {canPublish && (
          <button
            type="button"
            className="primary"
            disabled={!!problem || busy}
            title={selectedTitle(problem)}
            onClick={onPublish}
          >
            发布
          </button>
        )}
      </footer>
    </>
  );
}

export function VersionActions({
  name,
  base,
  path,
  id,
  mode,
  access,
  notify,
  onClose,
  onChanged,
  request = api,
}: {
  name: string;
  base: string;
  path: string;
  id: string;
  mode: VersionMode;
  access: Pick<CollectionAccess, "identity" | "update">;
  notify: (message: string) => void;
  onClose: () => void;
  onChanged?: () => void | Promise<void>;
  request?: Requester;
}) {
  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [selected, setSelected] = useState<VersionEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const policy = versionPolicy(mode, access);

  async function reload() {
    setLoading(true);
    try {
      const next = await loadVersions(request, base, path, id);
      setVersions(next);
      setSelected((current) =>
        current
          ? (next.find((entry) => entry.version === current.version) ?? null)
          : null,
      );
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "版本加载失败");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void reload();
    // 版本历史只在打开目标或租户/路径变化时重查。
  }, [base, path, id]);

  async function act(approved: boolean) {
    if (!policy.canReview || !selected || busy) return;
    setBusy(true);
    setError("");
    try {
      await submitVersionAction(
        request,
        reviewSpec(base, path, id, selected.version, approved),
      );
      notify(
        approved
          ? `版本 v${selected.version} 已通过`
          : `版本 v${selected.version} 已拒绝`,
      );
      await reload();
      await onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "审核失败");
    } finally {
      setBusy(false);
    }
  }
  async function publish() {
    if (!policy.canPublish || !selected || busy) return;
    if (publishProblem(selected)) return;
    setBusy(true);
    setError("");
    try {
      await submitVersionAction(
        request,
        publishSpec(base, path, id, selected.version),
      );
      notify(`已发布版本 v${selected.version}`);
      await reload();
      await onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "发布失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`版本与发布 · ${name}`} onClose={onClose}>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {loading ? (
        <p role="status">正在加载版本</p>
      ) : (
        <VersionList
          versions={versions}
          selected={selected}
          onSelect={setSelected}
          canReview={policy.canReview}
          canPublish={policy.canPublish}
          busy={busy}
          onReview={(approved) => void act(approved)}
          onPublish={() => void publish()}
          onClose={onClose}
          mode={mode}
        />
      )}
      {!loading && error && (
        <button type="button" onClick={() => void reload()}>
          重新加载
        </button>
      )}
    </Modal>
  );
}
