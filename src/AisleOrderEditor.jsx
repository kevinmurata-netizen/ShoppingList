import { useState } from "react";
import { ArrowUp, ArrowDown, Check, LoaderCircle } from "lucide-react";
import { CATEGORIES, aisleOrderFor } from "../shared/categories.js";

export function CategoryField({
  value,
  onChange,
  disabled = false,
  label = "Category",
}) {
  return (
    <label className="category-field">
      {label} <span className="optional">optional</span>
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Uncategorized</option>
        {CATEGORIES.map((name) => (
          <option key={name}>{name}</option>
        ))}
      </select>
    </label>
  );
}

export default function AisleOrderEditor({ list, store, onSave, busy }) {
  const [order, setOrder] = useState(() => [...aisleOrderFor(list, store)]);
  const [revision] = useState(() => list.aisleRevisions?.[store] || "");
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  function move(index, direction) {
    const next = [...order],
      target = index + direction;
    [next[index], next[target]] = [next[target], next[index]];
    setOrder(next);
    setAnnouncement(`${order[index]} moved to position ${target + 1}`);
  }
  return (
    <div className="aisle-editor">
      <p className="modal-description">
        {store === "All stores"
          ? "Arrange categories for your combined list."
          : `Arrange categories in the order you walk through ${store}.`}{" "}
        This order is shared with your family. Other stores keep their own
        order.
      </p>
      <div className="aisle-presets">
        <button
          className="text-button"
          disabled={busy}
          onClick={() => setOrder([...CATEGORIES])}
        >
          Reset order
        </button>
        <button
          className="text-button"
          disabled={busy}
          onClick={() =>
            setOrder([...CATEGORIES].sort((a, b) => a.localeCompare(b)))
          }
        >
          Sort A–Z
        </button>
      </div>
      <ol className="aisle-order" aria-label={`${store} category order`}>
        {order.map((category, index) => (
          <li key={category}>
            <span className="aisle-position">{index + 1}</span>
            <span className="aisle-name">{category}</span>
            <button
              className="icon-button"
              aria-label={`Move ${category} up`}
              disabled={busy || index === 0}
              onClick={() => move(index, -1)}
            >
              <ArrowUp size={18} />
            </button>
            <button
              className="icon-button"
              aria-label={`Move ${category} down`}
              disabled={busy || index === order.length - 1}
              onClick={() => move(index, 1)}
            >
              <ArrowDown size={18} />
            </button>
          </li>
        ))}
      </ol>
      <span className="sr-only" role="status">
        {announcement}
      </span>
      <p className="aisle-footnote">
        Empty categories stay hidden. Uncategorized items always come last.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button
        className="button primary full"
        disabled={busy}
        onClick={async () => {
          setError("");
          try {
            await onSave(store, order, revision);
          } catch (err) {
            setError(err.message);
          }
        }}
      >
        {busy ? (
          <LoaderCircle size={18} className="spin" />
        ) : (
          <Check size={18} />
        )}{" "}
        Save aisle order
      </button>
    </div>
  );
}
