import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  ClipboardList,
  LoaderCircle,
  Plus,
  Search,
  ShoppingBasket,
  Store,
  Star,
  WifiOff,
  X,
} from "lucide-react";
import { CATALOG, CATEGORIES } from "./catalog.js";
import {
  STORES,
  familyUsuals,
  itemKey,
  normalizeName,
} from "../shared/items.js";

export default function CatalogPicker({
  list,
  initialStore,
  onAdd,
  unavailable,
  onPin,
  offline,
}) {
  const [mode, setMode] = useState(() =>
    (list.favoriteStates || []).some((item) => item.pinned)
      ? "favorites"
      : "essentials",
  );
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [store, setStore] = useState(initialStore);
  const [usualStore, setUsualStore] = useState("All stores");
  const [selected, setSelected] = useState(new Map());
  const [busy, setBusy] = useState(false);
  const [pinning, setPinning] = useState(null);
  const favorites = useMemo(
    () => (list.favoriteStates || []).filter((item) => item.pinned),
    [list.favoriteStates],
  );
  const favoriteKeys = useMemo(
    () => new Set(favorites.map(itemKey)),
    [favorites],
  );
  const [error, setError] = useState("");
  const usuals = useMemo(() => familyUsuals(list), [list.items, list.usuals]);
  const needed = useMemo(
    () => new Set(list.items.filter((item) => !item.bought).map(itemKey)),
    [list.items],
  );
  const bought = useMemo(
    () =>
      new Map(
        list.items
          .filter((item) => item.bought)
          .map((item) => [itemKey(item), item]),
      ),
    [list.items],
  );

  useEffect(() => {
    setSelected((previous) => {
      const remaining = new Map(
        [...previous].filter(([key]) => !needed.has(key)),
      );
      return remaining.size === previous.size ? previous : remaining;
    });
  }, [needed]);

  const words = normalizeName(query).split(" ").filter(Boolean);
  const allEntries =
    mode === "essentials"
      ? CATALOG.map((item) => ({ ...item, store, quantity: 1, note: "" }))
      : mode === "favorites"
        ? favorites
        : mode === "usuals"
          ? usuals
          : [...selected.values()];
  const entries = allEntries.filter((item) => {
    const searchable = normalizeName(
      `${item.name} ${item.aliases || ""} ${item.category || ""} ${item.note || ""}`,
    );
    return (
      words.every((word) => searchable.includes(word)) &&
      (mode !== "essentials" ||
        category === "All" ||
        item.category === category) &&
      ((mode !== "usuals" && mode !== "favorites") ||
        usualStore === "All stores" ||
        item.store === usualStore)
    );
  });
  if (mode !== "selected")
    entries.sort(
      (a, b) =>
        Number(favoriteKeys.has(itemKey(b))) -
        Number(favoriteKeys.has(itemKey(a))),
    );
  const picks = [...selected.values()].filter(
    (item) => !needed.has(itemKey(item)),
  );
  const stores = new Set(picks.map((item) => item.store));
  const customName = query.trim();
  const canAddCustom =
    mode === "essentials" &&
    customName &&
    !CATALOG.some(
      (item) => normalizeName(item.name) === normalizeName(customName),
    );
  const custom = {
    name: customName,
    store,
    quantity: 1,
    note: "",
    category: category === "All" ? "" : category,
  };
  const customSelected = selected.has(itemKey(custom));

  function choose(item) {
    const key = itemKey(item);
    if (needed.has(key) || busy) return;
    setError("");
    setSelected((previous) => {
      const next = new Map(previous);
      if (next.has(key)) next.delete(key);
      else if (next.size < 100)
        next.set(key, {
          name: item.name,
          store: item.store,
          quantity: item.quantity || 1,
          note: item.note || "",
          category: item.category || "",
        });
      return next;
    });
  }

  async function pin(item) {
    const key = itemKey(item);
    setPinning(key);
    setError("");
    try {
      await onPin(item, !favoriteKeys.has(key));
    } catch (err) {
      setError(err.message);
    } finally {
      setPinning(null);
    }
  }

  async function submit() {
    setBusy(true);
    setError("");
    try {
      await onAdd(picks, store);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="catalog-picker" aria-busy={busy}>
      <p className="catalog-intro">
        Check what you need. Add it all in one go.
      </p>
      <div
        className="catalog-modes"
        role="tablist"
        aria-label="Choose items from"
      >
        <button
          role="tab"
          aria-selected={mode === "favorites"}
          onClick={() => {
            setMode("favorites");
            setQuery("");
          }}
          disabled={busy}
        >
          Favorites <span>{favorites.length}</span>
        </button>
        <button
          role="tab"
          aria-selected={mode === "essentials"}
          onClick={() => {
            setMode("essentials");
            setQuery("");
          }}
          disabled={busy}
        >
          Essentials
        </button>
        <button
          role="tab"
          aria-selected={mode === "usuals"}
          onClick={() => {
            setMode("usuals");
            setQuery("");
          }}
          disabled={busy}
        >
          Your usuals <span>{usuals.length}</span>
        </button>
        <button
          role="tab"
          aria-selected={mode === "selected"}
          onClick={() => {
            setMode("selected");
            setQuery("");
          }}
          disabled={busy}
        >
          Selected <span>{picks.length}</span>
        </button>
      </div>
      <div className="catalog-controls">
        <label className="catalog-search">
          <Search size={18} />
          <input
            type="search"
            aria-label="Search the grocery catalog"
            placeholder="Search groceries & household items"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            maxLength={100}
            disabled={busy}
            autoComplete="off"
          />
          {query && (
            <button
              type="button"
              className="icon-button"
              aria-label="Clear catalog search"
              onClick={() => setQuery("")}
              disabled={busy}
            >
              <X size={17} />
            </button>
          )}
        </label>
        {mode !== "selected" && (
          <label className="catalog-store">
            <Store size={17} />
            <span>{mode === "essentials" ? "Add to" : "From"}</span>
            <select
              aria-label={
                mode === "essentials"
                  ? "Store for catalog items"
                  : mode === "favorites"
                    ? "Filter favorites by store"
                    : "Filter your usuals by store"
              }
              value={mode === "essentials" ? store : usualStore}
              onChange={(e) =>
                mode === "essentials"
                  ? setStore(e.target.value)
                  : setUsualStore(e.target.value)
              }
              disabled={busy}
            >
              {(mode === "usuals" || mode === "favorites") && (
                <option>All stores</option>
              )}
              {STORES.map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
            <ChevronDown size={13} />
          </label>
        )}
      </div>
      {mode === "essentials" && (
        <div
          className="catalog-categories"
          role="group"
          aria-label="Grocery categories"
        >
          {["All", ...CATEGORIES].map((name) => (
            <button
              key={name}
              aria-pressed={category === name}
              onClick={() => setCategory(name)}
              disabled={busy}
            >
              {name}
            </button>
          ))}
        </div>
      )}
      <div className="catalog-scroll">
        <div className="catalog-results-heading">
          <span>
            {mode === "favorites"
              ? "PINNED FOR THE FAMILY"
              : mode === "usuals"
                ? "READY FOR ANOTHER RUN"
                : mode === "selected"
                  ? "YOUR PICKS"
                  : category === "All"
                    ? "EVERYDAY ESSENTIALS"
                    : category.toUpperCase()}
          </span>
          <span>
            {entries.length} {entries.length === 1 ? "item" : "items"}
          </span>
        </div>
        {entries.length > 0 ? (
          <ul className="catalog-results">
            {entries.map((item) => {
              const key = itemKey(item);
              const onList = needed.has(key);
              const checked = onList || selected.has(key);
              const previous = bought.get(key);
              const quantity = previous?.quantity || item.quantity || 1;
              return (
                <li key={key} className="catalog-result-row">
                  <label
                    className={`catalog-choice ${checked ? "chosen" : ""} ${onList ? "already-needed" : ""}`}
                  >
                    <input
                      type="checkbox"
                      aria-label={`Choose ${item.name} from ${item.store}`}
                      checked={checked}
                      onChange={() => choose(item)}
                      disabled={
                        busy || onList || (!checked && selected.size >= 100)
                      }
                    />
                    <span className="catalog-check" aria-hidden="true">
                      {checked && <Check size={16} strokeWidth={2.5} />}
                    </span>
                    <span className="catalog-item-copy">
                      <span className="catalog-item-name">
                        {item.name}
                        {quantity > 1 && (
                          <span className="quantity-badge">×{quantity}</span>
                        )}
                      </span>
                      <span className="catalog-item-detail">
                        {mode === "essentials"
                          ? item.category
                          : item.note ||
                            (mode === "usuals"
                              ? "Ready to add again"
                              : "Ready for your list")}
                        {mode === "essentials" && previous?.note
                          ? ` · ${previous.note}`
                          : ""}
                      </span>
                    </span>
                    <span className="catalog-item-meta">
                      <span
                        className={`store-badge ${item.store.toLowerCase()}`}
                      >
                        {item.store}
                      </span>
                      {onList ? (
                        <span className="catalog-status">On your list</span>
                      ) : previous ? (
                        <span className="catalog-status">Buy again</span>
                      ) : null}
                    </span>
                  </label>
                  <button
                    className="catalog-favorite-toggle"
                    aria-label={`${favoriteKeys.has(key) ? "Unpin" : "Pin"} ${item.name} from ${item.store}`}
                    aria-pressed={favoriteKeys.has(key)}
                    disabled={busy || pinning === key || unavailable}
                    onClick={() =>
                      pin(
                        previous ||
                          usuals.find((entry) => itemKey(entry) === key) ||
                          item,
                      )
                    }
                  >
                    {pinning === key ? (
                      <LoaderCircle size={17} className="spin" />
                    ) : (
                      <Star
                        size={18}
                        fill={favoriteKeys.has(key) ? "currentColor" : "none"}
                      />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="catalog-empty">
            <span>
              {mode === "favorites" ? (
                <Star size={29} />
              ) : mode === "usuals" ? (
                <ShoppingBasket size={29} />
              ) : (
                <ClipboardList size={29} />
              )}
            </span>
            <h3>
              {query
                ? "Nothing here by that name."
                : mode === "favorites"
                  ? "Keep your go-tos close."
                  : mode === "usuals"
                    ? "Your next trip gets easier."
                    : "A little planning starts here."}
            </h3>
            <p>
              {query
                ? "Try another search or change the category."
                : mode === "favorites"
                  ? "Tap the star beside an essential or a usual to pin it here for everyone."
                  : mode === "usuals"
                    ? "Items you mark bought will be saved here, even after you clear Bought."
                    : "Check a few essentials or your usuals. You’ll find your selections here."}
            </p>
            {(mode === "selected" || mode === "favorites") && (
              <button
                className="text-button"
                onClick={() => {
                  setMode("essentials");
                  setQuery("");
                }}
              >
                Browse essentials
              </button>
            )}
          </div>
        )}
        {canAddCustom && (
          <button
            className="catalog-custom"
            onClick={() => choose(custom)}
            disabled={
              busy ||
              needed.has(itemKey(custom)) ||
              (!customSelected && selected.size >= 100)
            }
          >
            {customSelected || needed.has(itemKey(custom)) ? (
              <Check size={18} />
            ) : (
              <Plus size={18} />
            )}
            <span>
              {needed.has(itemKey(custom))
                ? `“${customName}” is already on your list`
                : customSelected
                  ? `“${customName}” selected`
                  : `Add “${customName}” as a custom item`}
            </span>
          </button>
        )}
      </div>
      <div className="catalog-footer">
        {offline && (
          <p className="catalog-offline-note">
            <WifiOff size={13} />
            Saved on this phone. Changes sync when you're back online.
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {selected.size >= 100 && (
          <p className="catalog-limit">
            Add these 100 items, then choose more.
          </p>
        )}
        <div className="catalog-footer-actions">
          <span className="catalog-selection-summary">
            {picks.length ? (
              <>
                <strong>{picks.length} selected</strong>
                <span>
                  {stores.size > 1
                    ? `Across ${stores.size} stores`
                    : [...stores][0]}
                </span>
              </>
            ) : (
              <>
                Nothing selected yet<span>Check items you want to buy</span>
              </>
            )}
          </span>
          <button
            type="button"
            className="button primary"
            disabled={!picks.length || busy || unavailable}
            onClick={submit}
          >
            {busy ? (
              <LoaderCircle size={18} className="spin" />
            ) : (
              <Plus size={18} />
            )}{" "}
            {busy
              ? "Adding…"
              : `Add ${picks.length || "selected"} ${picks.length === 1 ? "item" : "items"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
