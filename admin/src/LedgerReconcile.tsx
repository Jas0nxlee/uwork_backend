import { useState } from "react";
import { api, display, type Row } from "./api.js";
import { Modal } from "./forms.js";
import { submitReconcile, type Requester } from "./collectionActions.js";

/**
 * 待核实账目的人工核实：先展示真实状态与预留上限，再由管理员填写实际成本与证据。
 * 只有 uncertain 账目可以提交，且请求体严格匹配后端 reconcile schema。
 */
export function LedgerReconcile({
  entry,
  base,
  notify,
  onClose,
  onDone,
  request = api,
}: {
  entry: Row;
  base: string;
  notify: (message: string) => void;
  onClose: () => void;
  onDone?: () => void | Promise<void>;
  request?: Requester;
}) {
  const [amount, setAmount] = useState("");
  const [evidence, setEvidence] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = entry.status === "uncertain";
  const reserved = Number(entry.reserved);
  const ready =
    amount !== "" && Number.isInteger(Number(amount)) && evidence.trim() !== "";

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    setError("");
    try {
      await submitReconcile(request, base, entry, Number(amount), evidence);
      notify("账目已核实并结算");
      await onDone?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "核实失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="人工核实账目" onClose={onClose}>
      {!valid ? (
        <p className="error" role="alert">
          仅待核实账目可以人工核实。
        </p>
      ) : (
        <>
          <dl className="capabilities">
            <div>
              <dt>账目 ID</dt>
              <dd>{display(entry.id)}</dd>
            </div>
            <div>
              <dt>成员</dt>
              <dd>{display(entry.user_id)}</dd>
            </div>
            <div>
              <dt>应用 / 模型</dt>
              <dd>
                {display(entry.application)} / {display(entry.model_id)}
              </dd>
            </div>
            <div>
              <dt>当前状态</dt>
              <dd>uncertain（待核实）</dd>
            </div>
            <div>
              <dt>预留上限</dt>
              <dd>{display(entry.reserved)} Credit</dd>
            </div>
          </dl>
          <p className="field-description">
            核实会把该账目一次性结算为 settled；实际成本必须是 0
            到预留上限之间的整数
            Credit，并记录证据引用。提交后不可重复核实，操作写入审计。
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <div className="form-grid">
              <label>
                <span>实际成本（Credit）*</span>
                <input
                  type="number"
                  min={0}
                  max={Number.isFinite(reserved) ? reserved : undefined}
                  step={1}
                  required
                  disabled={busy}
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />
              </label>
              <label>
                <span>证据引用 *</span>
                <input
                  type="text"
                  maxLength={200}
                  required
                  disabled={busy}
                  value={evidence}
                  placeholder="例如：上游账单编号或工单链接"
                  onChange={(event) => setEvidence(event.target.value)}
                />
              </label>
            </div>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <footer>
              <button type="button" disabled={busy} onClick={onClose}>
                取消
              </button>
              <button
                className="primary"
                type="submit"
                disabled={!ready || busy}
              >
                {busy ? "提交中" : "确认核实并结算"}
              </button>
            </footer>
          </form>
        </>
      )}
      {!valid && (
        <footer>
          <button type="button" onClick={onClose}>
            关闭
          </button>
        </footer>
      )}
    </Modal>
  );
}
