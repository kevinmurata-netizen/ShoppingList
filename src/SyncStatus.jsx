import { useState } from "react";
import {
  AlertTriangle,
  CheckCheck,
  CloudUpload,
  LoaderCircle,
  WifiOff,
} from "lucide-react";

export default function SyncStatus({ sync, onReview }) {
  return (
    <div className="sync-status" aria-live="polite">
      {sync.offlineReady &&
        sync.savedAt &&
        sync.connection !== "offline" &&
        !sync.pending &&
        !sync.issues.length &&
        !sync.storageError && (
          <div className="offline-ready">
            <CheckCheck size={15} />
            Ready for offline shopping
          </div>
        )}
      {sync.storageError && (
        <div className="offline-banner sync-warning" role="alert">
          <AlertTriangle size={20} />
          <div>
            <strong>Changes couldn't be saved on this phone</strong>
            <p>{sync.storageError}</p>
          </div>
        </div>
      )}
      {sync.notice && (
        <div className="offline-banner sync-warning" role="alert">
          <AlertTriangle size={20} />
          <div>
            <strong>Check your family link</strong>
            <p>
              {sync.notice} Your saved list and changes are still on this phone.
            </p>
          </div>
        </div>
      )}
      {!sync.storageError &&
        sync.loaded &&
        !sync.loadError &&
        sync.connection === "offline" && (
          <div className="offline-banner">
            <WifiOff size={20} />
            <div>
              <strong>
                {sync.pending
                  ? `Offline · ${sync.pending} ${sync.pending === 1 ? "change" : "changes"} saved on this phone`
                  : "Offline · Your saved list is ready"}
              </strong>
              <p>
                Keep shopping. Changes will sync when the connection returns.
              </p>
            </div>
          </div>
        )}
      {sync.connection !== "offline" &&
        sync.pending > 0 &&
        !sync.storageError && (
          <div className="offline-banner syncing-banner">
            <CloudUpload size={20} />
            <div>
              <strong>
                {sync.waiting === sync.pending
                  ? "Some changes are waiting for your review"
                  : `Syncing ${sync.pending} saved ${sync.pending === 1 ? "change" : "changes"}…`}
              </strong>
              <p>
                Your changes stay on this phone until the family list receives
                them.
              </p>
            </div>
          </div>
        )}
      {sync.issues.length > 0 && (
        <div className="offline-banner sync-warning">
          <AlertTriangle size={20} />
          <div>
            <strong>
              {sync.issues.length}{" "}
              {sync.issues.length === 1 ? "change needs" : "changes need"} your
              review
            </strong>
            <p>Someone in the family also changed these items.</p>
          </div>
          <button className="button" onClick={onReview}>
            Review changes
          </button>
        </div>
      )}
    </div>
  );
}

const fieldNames = {
  bought: "Shopping status",
  name: "Item name",
  store: "Store",
  quantity: "Quantity",
  note: "Note",
  title: "List name",
  favorite: "Favorite",
};
const value = (field, entry) =>
  field === "bought" && typeof entry === "boolean"
    ? entry
      ? "Bought"
      : "To buy"
    : String(entry ?? "—") || "No note";
export function SyncReview({ issues, waiting, onResolve }) {
  const [busy, setBusy] = useState(null),
    [error, setError] = useState("");
  async function resolve(id, choice) {
    setBusy(id);
    setError("");
    try {
      await onResolve(id, choice);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="sync-review">
      <p className="modal-description">
        Your offline changes are safe. Keep your family's update, or choose your
        own change when it is still possible.
      </p>
      {issues.length ? (
        issues.map((op) => (
          <section key={op.id} className="sync-issue">
            <h3>{op.label || "Saved change"}</h3>
            <p>{op.conflict?.message}</p>
            {op.conflict?.fields?.map((entry) => (
              <div className="sync-comparison" key={entry.field}>
                <strong>{fieldNames[entry.field] || entry.field}</strong>
                <div>
                  <span>Your change</span>
                  <span>{value(entry.field, entry.mine)}</span>
                </div>
                <div>
                  <span>Family list</span>
                  <span>{value(entry.field, entry.current)}</span>
                </div>
              </div>
            ))}
            <div className="sync-issue-actions">
              <button
                className="button"
                disabled={Boolean(busy)}
                onClick={() => resolve(op.id, "dismiss")}
              >
                Keep family update
              </button>
              {op.conflict?.canRetry && (
                <button
                  className="button primary"
                  disabled={Boolean(busy)}
                  onClick={() => resolve(op.id, "retry")}
                >
                  {busy === op.id ? (
                    <LoaderCircle size={15} className="spin" />
                  ) : null}{" "}
                  Use my change
                </button>
              )}
            </div>
          </section>
        ))
      ) : (
        <div className="sync-review-empty">
          <CheckCheck size={30} />
          <h3>All caught up.</h3>
          <p>No changes need your review.</p>
        </div>
      )}
      {waiting > 0 && (
        <p className="sync-waiting">
          Later changes to these items will follow after you review the earlier
          change.
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
