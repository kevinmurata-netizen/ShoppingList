import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  ListChecks,
  Copy,
  Heart,
  Link,
  LoaderCircle,
  Minus,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Share2,
  ShoppingBag,
  ShoppingBasket,
  Sparkles,
  Store,
  Target,
  Trash2,
  Users,
  WifiOff,
  X,
} from "lucide-react";
import "./styles.css";
import "./catalog.css";
import CatalogPicker from "./CatalogPicker.jsx";
import { STORES, itemKey } from "../shared/items.js";
import { useFamilyList } from "./useFamilyList.js";
import { getSyncClient, seedList } from "./sync-client.js";
import { request } from "./api.js";
import SyncStatus, { SyncReview } from "./SyncStatus.jsx";
import "./offline.css";
import "./aisles.css";
import { aisleOrderFor, groupItems } from "../shared/categories.js";
import AisleOrderEditor, { CategoryField } from "./AisleOrderEditor.jsx";

const readSaved = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const saveLocal = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* App also works without local storage. */
  }
};
function startingToken() {
  const match = location.pathname.match(/^\/l\/([^/]+)\/?$/);
  return match ? match[1] : readSaved("family-cart-list");
}

function StoreMark({ name, small = false }) {
  return (
    <span
      className={`store-mark ${name.toLowerCase()} ${small ? "small" : ""}`}
      aria-hidden="true"
    >
      {name === "Costco" ? (
        <span className="costco-letter">C</span>
      ) : name === "Walmart" ? (
        <Sparkles size={small ? 13 : 19} />
      ) : name === "Target" ? (
        <Target size={small ? 14 : 20} />
      ) : name === "Safeway" ? (
        <span className="safeway-letter">S</span>
      ) : (
        <ShoppingBag size={small ? 13 : 18} />
      )}
    </span>
  );
}

function BasketDrawing({ small = false }) {
  return (
    <svg
      className={`basket-drawing ${small ? "mini" : ""}`}
      viewBox="0 0 240 180"
      fill="none"
      aria-hidden="true"
    >
      <ellipse
        cx="124"
        cy="153"
        rx="77"
        ry="9"
        fill="currentColor"
        opacity=".06"
      />
      <path
        d="m78 81-6-37c-1-10 13-16 18-7l22 42"
        fill="#efd8b4"
        stroke="#6d7856"
        strokeWidth="3"
      />
      <path
        d="m132 84 5-35c1-9 11-13 16-5l16 39"
        fill="#e0b078"
        stroke="#6d7856"
        strokeWidth="3"
      />
      <path
        d="M117 84c-20-9-26-24-16-30 9-7 16 1 18 9-3-21 12-25 16-15 4 11-5 23-12 36"
        fill="#95aa72"
        stroke="#537056"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <path
        d="m160 83 17-28c6-10 18-1 12 8l-16 26"
        fill="#e8a66d"
        stroke="#a9744f"
        strokeWidth="3"
      />
      <path
        d="m55 86 17 54c1 5 5 7 10 7h87c5 0 9-3 10-7l16-54"
        fill="#e9c896"
        stroke="#526750"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <rect
        x="49"
        y="77"
        width="151"
        height="15"
        rx="7.5"
        fill="#f5ddb7"
        stroke="#526750"
        strokeWidth="3"
      />
      <path
        d="m87 104 6 29m29-29v29m29-29-6 29m-67-11h91"
        stroke="#b69568"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="m81 77 26-30m61 30-26-30"
        stroke="#526750"
        strokeWidth="7"
        strokeLinecap="round"
      />
      <path
        d="m33 52 3 7m-16 13 8-1m179-21-5 6m10 10 8 1"
        stroke="#c59061"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Modal({ title, children, onClose, wide = false, locked = false }) {
  const dialogRef = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = dialogRef.current;
    dialog.showModal();
    return () => {
      dialog.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialogRef}
      className={`modal ${wide ? "wide" : ""}`}
      onCancel={(e) => {
        if (locked) e.preventDefault();
        else onClose();
      }}
      onClick={(e) => {
        if (!locked && e.target === e.currentTarget) {
          const rect = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < rect.left ||
            e.clientX > rect.right ||
            e.clientY < rect.top ||
            e.clientY > rect.bottom
          )
            onClose();
        }
      }}
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          disabled={locked}
          onClick={onClose}
        >
          <X size={21} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

function ItemEditor({ item, onSave, onDelete, onClose }) {
  const [name, setName] = useState(item.name);
  const [store, setStore] = useState(item.store);
  const [quantity, setQuantity] = useState(item.quantity);
  const [note, setNote] = useState(item.note);
  const [category, setCategory] = useState(item.category || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const values = {
        name: name.trim(),
        store,
        quantity,
        note: note.trim(),
        category,
      };
      const changes = Object.fromEntries(
        Object.entries(values).filter(
          ([key, value]) =>
            value !== (key === "category" ? item.category || "" : item[key]),
        ),
      );
      await onSave(changes, item.fieldVersions || {});
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="A little more detail" onClose={onClose}>
      <form onSubmit={submit} className="edit-form">
        <label>
          Item name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={100}
            autoFocus
          />
        </label>
        <div className="two-fields">
          <label>
            Store
            <select value={store} onChange={(e) => setStore(e.target.value)}>
              {STORES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Quantity
            <input
              type="number"
              min="1"
              max="99"
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
              required
            />
          </label>
        </div>
        <CategoryField
          value={category}
          onChange={setCategory}
          disabled={busy}
        />
        <label>
          Note <span className="optional">optional</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={200}
            placeholder="Brand, size, or something to remember…"
            rows={3}
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary full" disabled={busy}>
          {busy ? (
            <LoaderCircle className="spin" size={18} />
          ) : (
            <Check size={18} />
          )}{" "}
          Save changes
        </button>
        {!confirmDelete ? (
          <button
            type="button"
            className="text-button danger center"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 size={15} /> Remove item
          </button>
        ) : (
          <div className="delete-confirm">
            <span>Remove this item?</span>
            <button
              type="button"
              disabled={busy}
              className="text-button danger"
              onClick={async () => {
                setBusy(true);
                try {
                  await onDelete();
                  onClose();
                } catch (err) {
                  setError(err.message);
                  setBusy(false);
                }
              }}
            >
              Yes, remove
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => setConfirmDelete(false)}
            >
              Keep it
            </button>
          </div>
        )}
      </form>
    </Modal>
  );
}

function App() {
  const [token, setToken] = useState(startingToken);
  const tokenRef = useRef(token);
  const creatingRef = useRef(null);
  const sync = useFamilyList(token);
  const { list, loaded, loadError, connection } = sync;
  const [filter, setFilter] = useState("All stores");
  const [grouped, setGrouped] = useState(
    () => readSaved("family-cart-group-categories") === "true",
  );
  const [tab, setTab] = useState("needed");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [name, setName] = useState("");
  const [store, setStore] = useState(() =>
    STORES.includes(readSaved("family-cart-store"))
      ? readSaved("family-cart-store")
      : "Costco",
  );
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState("");
  const [category, setCategory] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [modal, setModal] = useState(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [rename, setRename] = useState("");
  const [renameRevision, setRenameRevision] = useState("");
  const [modalBusy, setModalBusy] = useState(false);
  const [modalError, setModalError] = useState("");
  const [busyItems, setBusyItems] = useState(new Set());
  const [installEvent, setInstallEvent] = useState(null);
  const nameRef = useRef(null);
  useEffect(() => {
    if (!token) return;
    tokenRef.current = token;
    if (loaded && !loadError) {
      saveLocal("family-cart-list", token);
      document
        .querySelector('link[rel="manifest"]')
        ?.setAttribute(
          "href",
          `/api/manifest?list=${encodeURIComponent(token)}`,
        );
    }
    history.replaceState(null, "", `/l/${token}`);
  }, [token, loaded, loadError]);

  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setInstallEvent(e);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  async function ensureList() {
    if (tokenRef.current) return tokenRef.current;
    if (!creatingRef.current)
      creatingRef.current = request("/api/lists", {
        method: "POST",
        body: JSON.stringify({ title: list.title }),
      })
        .then(async (data) => {
          await seedList(data.token, data);
          tokenRef.current = data.token;
          setToken(data.token);
          return data.token;
        })
        .finally(() => {
          creatingRef.current = null;
        });
    return creatingRef.current;
  }
  async function mutate(path, method, body, baseline) {
    const id = await ensureList();
    let type, payload;
    if (path === "/pick" || (path === "/items" && method === "POST")) {
      type = "pick";
      payload = path === "/pick" ? body : { items: [body] };
    } else if (path === "/completed") {
      type = "clear";
      payload = {};
    } else if (path === "") {
      type = "rename";
      payload = { ...body, before: baseline };
    } else if (path === "/aisle-order") {
      type = "aisleOrder";
      payload = { ...body, before: baseline };
    } else if (path === "/favorites") {
      type = "favorite";
      payload = { ...body, before: baseline };
    } else {
      type = method === "DELETE" ? "delete" : "patch";
      payload = {
        itemId: path.slice("/items/".length),
        changes: body,
        before: baseline,
      };
    }
    const data = await getSyncClient(id).enqueue(type, payload);
    setError("");
    return data;
  }
  async function pinItem(item, pinned) {
    const current = (list.favoriteStates || []).find(
      (entry) => itemKey(entry) === itemKey(item),
    );
    await mutate(
      "/favorites",
      "PATCH",
      { item, pinned },
      { favorite: current?.revision || "" },
    );
  }
  async function addItem(e) {
    e.preventDefault();
    if (!name.trim() || adding) return;
    setAdding(true);
    setError("");
    try {
      await mutate("/items", "POST", {
        name: name.trim(),
        store,
        quantity,
        note,
        category,
      });
      saveLocal("family-cart-store", store);
      setName("");
      setNote("");
      setCategory("");
      setQuantity(1);
      setDetailsOpen(false);
      setTab("needed");
      if (filter !== "All stores" && filter !== store) setFilter("All stores");
      setQuery("");
      setToast(
        connection === "offline"
          ? "Saved on this phone — will sync when online"
          : "Added to your list",
      );
      nameRef.current?.focus();
    } catch (err) {
      setError(err.message);
    } finally {
      setAdding(false);
    }
  }
  async function pickItems(items, preferredStore) {
    setModalBusy(true);
    try {
      const data = await mutate("/pick", "POST", { items });
      const count = data.pickResult.added + data.pickResult.restored;
      setTab("needed");
      if (
        filter !== "All stores" &&
        items.some((item) => item.store !== filter)
      )
        setFilter("All stores");
      setQuery("");
      setStore(preferredStore);
      saveLocal("family-cart-store", preferredStore);
      setToast(
        count
          ? `${count} ${count === 1 ? "item" : "items"} added to your list`
          : "Those items are already on your list",
      );
      setModal(null);
    } finally {
      setModalBusy(false);
    }
  }
  async function toggle(item) {
    if (busyItems.has(item.id)) return;
    setBusyItems((current) => new Set(current).add(item.id));
    try {
      await mutate(
        `/items/${item.id}`,
        "PATCH",
        { bought: !item.bought },
        item.fieldVersions || {},
      );
      if (!item.bought) setToast(`${item.name} — in the cart!`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyItems((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
    }
  }
  async function showShare() {
    setShareBusy(true);
    setError("");
    try {
      await ensureList();
      setModalError("");
      setModal("share");
    } catch (err) {
      setError(err.message);
    } finally {
      setShareBusy(false);
    }
  }
  function openModal(value) {
    setModalError("");
    setModalBusy(false);
    setModal(value);
  }
  const needed = list.items.filter((item) => !item.bought);
  const bought = list.items.filter((item) => item.bought);
  const tabItems = tab === "needed" ? needed : bought;
  const visible = tabItems
    .filter(
      (item) =>
        (filter === "All stores" || item.store === filter) &&
        `${item.name} ${item.note} ${item.category || ""}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) =>
      tab === "bought" ? b.boughtAt - a.boughtAt : a.createdAt - b.createdAt,
    );
  const displayGroups = grouped
    ? groupItems(visible, aisleOrderFor(list, filter))
    : [{ category: null, items: visible }];
  function changeGrouping(value) {
    setGrouped(value);
    saveLocal("family-cart-group-categories", String(value));
  }
  const percentage = list.items.length
    ? Math.round((bought.length / list.items.length) * 100)
    : 0;
  const shareUrl = token ? `${location.origin}/l/${token}` : "";
  const unavailable =
    !loaded || Boolean(loadError) || Boolean(sync.storageError);

  return (
    <div className="app-shell">
      <header className="topbar">
        <a
          className="wordmark"
          href={token ? `/l/${token}` : "/"}
          aria-label="Family Cart home"
        >
          <span className="brand-icon">
            <ShoppingBasket size={24} strokeWidth={1.8} />
          </span>
          family<span>cart</span>
          <span className="brand-dot">.</span>
        </a>
        <div className="topbar-right">
          <span className="family-tag">
            <Heart size={14} /> A little more together
          </span>
          <button
            className="family-avatar"
            aria-label="Share with your family"
            onClick={showShare}
            disabled={shareBusy || unavailable}
          >
            <Users size={21} />
          </button>
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <div className="sidebar-label">YOUR LIST</div>
          <button
            className="list-nav"
            onClick={() => {
              setFilter("All stores");
              setTab("needed");
              setQuery("");
            }}
          >
            <ClipboardList size={19} />
            <span>Family shopping</span>
            <ChevronRight size={16} />
          </button>
          <div className="sidebar-label stores-heading">
            SHOP BY STORE <span>{STORES.length}</span>
          </div>
          <nav className="store-nav" aria-label="Filter by store">
            <button
              className={`store-nav-item all ${filter === "All stores" ? "selected" : ""}`}
              onClick={() => setFilter("All stores")}
              aria-pressed={filter === "All stores"}
            >
              <span className="store-mark all-mark">
                <Store size={18} />
              </span>
              <span>All stores</span>
              <span className="nav-count">{tabItems.length}</span>
            </button>
            {STORES.map((s) => (
              <button
                key={s}
                className={`store-nav-item ${filter === s ? "selected" : ""}`}
                aria-pressed={filter === s}
                onClick={() => setFilter(s)}
              >
                <StoreMark name={s} />
                <span>{s}</span>
                <span className="nav-count">
                  {tabItems.filter((item) => item.store === s).length}
                </span>
              </button>
            ))}
          </nav>
          <div className="together-card">
            <span className="card-spark">
              <Sparkles size={20} />
            </span>
            <h3>
              One list.
              <br />
              The whole family.
            </h3>
            <p>
              Someone remembers the milk.
              <br />
              Someone else picks it up.
            </p>
            <button onClick={showShare} disabled={shareBusy || unavailable}>
              Bring everyone along <ArrowRight size={16} />
            </button>
            <span className="card-loop" aria-hidden="true">
              ♡
            </span>
          </div>
          <button className="install-link" onClick={() => openModal("install")}>
            <ArrowDownToLine size={16} /> Add to your home screen
          </button>
        </aside>

        <main id="main-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                <span /> LESS TEXTING. MORE TOGETHER.
              </div>
              <div className="title-line">
                <h1>{list.title}</h1>
                <button
                  className="icon-button rename-button"
                  aria-label="Rename your list"
                  disabled={unavailable}
                  onClick={() => {
                    setRename(list.title);
                    setRenameRevision(list.titleRevision || "");
                    openModal("rename");
                  }}
                >
                  <Pencil size={16} />
                </button>
              </div>
              <p className="subtitle">
                For the things you need, and the people you love.
              </p>
            </div>
            <button
              className="button share-button"
              aria-label="Share list"
              onClick={showShare}
              disabled={shareBusy || unavailable}
            >
              {shareBusy ? (
                <LoaderCircle className="spin" size={17} />
              ) : (
                <Share2 size={17} />
              )}
              <span>Share list</span>
            </button>
          </div>

          <section className="overview" aria-label="Shopping progress">
            <div className="overview-copy">
              <span className="overview-icon">
                <ShoppingBag size={23} strokeWidth={1.6} />
              </span>
              <div>
                <h2>
                  {needed.length === 0 && bought.length
                    ? "That’s a good shopping trip."
                    : "A little planning. A lighter day."}
                </h2>
                <p>
                  {needed.length ? (
                    <>
                      <strong>
                        {needed.length} {needed.length === 1 ? "item" : "items"}
                      </strong>{" "}
                      to pick up
                      {filter !== "All stores"
                        ? ` · Shopping at ${filter}`
                        : " on your next run."}
                    </>
                  ) : bought.length ? (
                    "Everything’s checked off. Enjoy being home."
                  ) : (
                    "Keep it all here. Pick it up when you’re out."
                  )}
                </p>
              </div>
            </div>
            <div className="progress-area">
              <div className="progress-label">
                <span>
                  {bought.length} of {list.items.length} bought
                </span>
                <CheckCheck size={16} />
              </div>
              <div className="progress-track">
                <div style={{ width: `${percentage}%` }} />
              </div>
            </div>
          </section>

          <section className="quick-pick" aria-label="Choose groceries">
            <span className="quick-pick-icon">
              <ListChecks size={26} strokeWidth={1.6} />
            </span>
            <div>
              <h2>Less typing. More ticking.</h2>
              <p>Pick everyday essentials or bring back your usuals.</p>
            </div>
            <button
              className="button primary"
              disabled={unavailable}
              onClick={() => openModal("catalog")}
            >
              <ShoppingBasket size={17} /> Choose items
            </button>
          </section>

          <section className="composer-section" aria-label="Add an item">
            <form onSubmit={addItem} className="composer">
              <div className="composer-main">
                <Plus className="composer-plus" size={22} />
                <input
                  ref={nameRef}
                  aria-label="Item name"
                  placeholder="What do we need?"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={100}
                  required
                  disabled={adding || unavailable}
                  autoComplete="off"
                  enterKeyHint="done"
                />
                <div className="store-select">
                  <StoreMark name={store} small />
                  <select
                    aria-label="Store for new item"
                    value={store}
                    disabled={adding || unavailable}
                    onChange={(e) => setStore(e.target.value)}
                  >
                    {STORES.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                  <ChevronDown size={13} />
                </div>
                <button
                  type="submit"
                  className="button primary add-button"
                  disabled={!name.trim() || adding || unavailable}
                >
                  {adding ? (
                    <LoaderCircle size={18} className="spin" />
                  ) : (
                    <Plus size={18} />
                  )}
                  <span>Add item</span>
                </button>
              </div>
              {detailsOpen && (
                <div className="composer-details">
                  <label>
                    Quantity
                    <div className="stepper">
                      <button
                        type="button"
                        aria-label="Decrease quantity"
                        disabled={quantity <= 1 || adding}
                        onClick={() => setQuantity((q) => q - 1)}
                      >
                        <Minus size={15} />
                      </button>
                      <input
                        aria-label="Quantity"
                        type="number"
                        min="1"
                        max="99"
                        value={quantity}
                        onChange={(e) => setQuantity(Number(e.target.value))}
                        required
                        disabled={adding}
                      />
                      <button
                        type="button"
                        aria-label="Increase quantity"
                        disabled={quantity >= 99 || adding}
                        onClick={() => setQuantity((q) => q + 1)}
                      >
                        <Plus size={15} />
                      </button>
                    </div>
                  </label>
                  <CategoryField
                    value={category}
                    onChange={setCategory}
                    disabled={adding}
                    label="Category for new item"
                  />
                  <label className="note-field">
                    A note, if you need one
                    <input
                      aria-label="Note for new item"
                      placeholder="e.g. the big pack, unsalted…"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      maxLength={200}
                      disabled={adding}
                    />
                  </label>
                </div>
              )}
            </form>
            <div className="composer-footer">
              <span>
                <span className="shortcut-dot" /> The moment you think of it,
                add it.
              </span>
              <button
                className="text-button"
                onClick={() => setDetailsOpen(!detailsOpen)}
                aria-expanded={detailsOpen}
                disabled={adding || unavailable}
              >
                {detailsOpen ? <Minus size={13} /> : <Plus size={13} />} Item
                details
              </button>
            </div>
          </section>

          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() => setError("")}
              >
                <X size={17} />
              </button>
            </div>
          )}
          <SyncStatus sync={sync} onReview={() => openModal("sync")} />
          <section className="shopping-section" aria-label="Shopping items">
            <div className="list-toolbar">
              <div className="tabs" role="tablist" aria-label="Item status">
                <button
                  role="tab"
                  aria-selected={tab === "needed"}
                  className={tab === "needed" ? "active" : ""}
                  onClick={() => setTab("needed")}
                >
                  To buy <span>{needed.length}</span>
                </button>
                <button
                  role="tab"
                  aria-selected={tab === "bought"}
                  className={tab === "bought" ? "active" : ""}
                  onClick={() => setTab("bought")}
                >
                  Bought <span>{bought.length}</span>
                </button>
              </div>
              <div className="toolbar-actions">
                {tab === "bought" && bought.length > 0 && (
                  <button
                    className="text-button clear-button"
                    onClick={() => openModal("clear")}
                  >
                    <Trash2 size={14} />
                    <span>Clear bought</span>
                  </button>
                )}
                <button
                  className={`icon-button search-toggle ${searchOpen ? "active" : ""}`}
                  aria-label={searchOpen ? "Close search" : "Search items"}
                  aria-expanded={searchOpen}
                  onClick={() => {
                    setSearchOpen(!searchOpen);
                    setQuery("");
                  }}
                >
                  {searchOpen ? <X size={19} /> : <Search size={19} />}
                </button>
              </div>
            </div>
            <div
              className="mobile-store-filters"
              role="group"
              aria-label="Filter by store"
            >
              <button
                className={filter === "All stores" ? "active" : ""}
                aria-pressed={filter === "All stores"}
                onClick={() => setFilter("All stores")}
              >
                All stores <span>{tabItems.length}</span>
              </button>
              {STORES.map((s) => (
                <button
                  key={s}
                  className={filter === s ? "active" : ""}
                  aria-pressed={filter === s}
                  onClick={() => setFilter(s)}
                >
                  <StoreMark name={s} small />
                  {s}
                </button>
              ))}
            </div>
            {searchOpen && (
              <div className="search-field">
                <Search size={18} />
                <input
                  aria-label="Search items"
                  placeholder="Find something on your list…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  autoFocus
                />
                {query && (
                  <button
                    className="icon-button"
                    aria-label="Clear search"
                    onClick={() => setQuery("")}
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
            )}
            <div className="aisle-toolbar">
              <label className="group-toggle">
                <input
                  type="checkbox"
                  checked={grouped}
                  onChange={(e) => changeGrouping(e.target.checked)}
                  disabled={unavailable}
                />
                Group by category
              </label>
              <button
                className="text-button"
                disabled={unavailable}
                onClick={() => openModal("aisles")}
              >
                Aisle order <ChevronRight size={15} />
              </button>
            </div>
            <div className="list-context">
              <span>
                {query
                  ? `RESULTS FOR “${query}”`
                  : filter === "All stores"
                    ? tab === "needed"
                      ? "A LITTLE OF EVERYTHING"
                      : "ALREADY IN THE CART"
                    : filter.toUpperCase()}{" "}
                <span className="context-count">{visible.length}</span>
              </span>
              <span
                className={`sync-label ${connection === "live" ? "connected" : ""}`}
              >
                <span />
                {connection === "live"
                  ? "Live with your family"
                  : connection === "idle"
                    ? "Your family’s next good habit"
                    : connection === "syncing"
                      ? "Syncing changes…"
                      : connection === "offline"
                        ? "Saved on this phone"
                        : "Connecting…"}
              </span>
            </div>

            {!loaded ? (
              <div className="empty-state loading-state">
                <LoaderCircle className="spin" size={27} />
                <h2>Getting your family list…</h2>
              </div>
            ) : loadError ? (
              <div className="empty-state">
                <span className="empty-icon">
                  <WifiOff size={32} />
                </span>
                <h2>
                  {loadError.missing
                    ? "Let’s find your family’s list."
                    : "Your list is taking a moment."}
                </h2>
                <p>{loadError.message}</p>
                <button
                  className="button primary"
                  onClick={() => location.reload()}
                >
                  Try again
                </button>
                {loadError.missing && (
                  <button
                    className="text-button"
                    onClick={() => {
                      try {
                        localStorage.removeItem("family-cart-list");
                      } catch {}
                      location.assign("/");
                    }}
                  >
                    Start a new family list
                  </button>
                )}
              </div>
            ) : visible.length ? (
              <div className={grouped ? "category-groups" : "ungrouped-items"}>
                {displayGroups.map((group) => (
                  <section
                    key={group.category ?? "all"}
                    className="category-group"
                    aria-label={
                      grouped
                        ? `${group.category || "Uncategorized"} items`
                        : "Shopping items"
                    }
                  >
                    {grouped && (
                      <h3 className="category-heading">
                        {group.category || "Uncategorized"}
                        <span>{group.items.length}</span>
                      </h3>
                    )}
                    <ul className="item-list">
                      {group.items.map((item) => (
                        <li
                          key={item.id}
                          className={`item-row ${item.bought ? "is-bought" : ""} ${busyItems.has(item.id) ? "is-saving" : ""}`}
                        >
                          <button
                            className="item-checkbox"
                            aria-label={`${item.bought ? "Mark not bought" : "Mark bought"}: ${item.name}`}
                            role="checkbox"
                            aria-checked={item.bought}
                            disabled={unavailable || busyItems.has(item.id)}
                            onClick={() => toggle(item)}
                          >
                            {busyItems.has(item.id) ? (
                              <LoaderCircle size={15} className="spin" />
                            ) : item.bought ? (
                              <Check size={16} strokeWidth={2.8} />
                            ) : null}
                          </button>
                          <button
                            className="item-body"
                            onClick={() => openModal({ edit: item })}
                            aria-label={`Edit ${item.name}`}
                          >
                            <span className="item-name">
                              {item.name}
                              {item.quantity > 1 && (
                                <span className="quantity-badge">
                                  ×{item.quantity}
                                </span>
                              )}
                            </span>
                            {!grouped && item.category && (
                              <span className="item-category">
                                {item.category}
                              </span>
                            )}
                            {item.note && (
                              <span className="item-note">{item.note}</span>
                            )}
                          </button>
                          <span
                            className={`store-badge ${item.store.toLowerCase()}`}
                          >
                            <StoreMark name={item.store} small />
                            {item.store}
                          </span>
                          <button
                            className="icon-button item-menu"
                            aria-label={`Options for ${item.name}`}
                            onClick={() => openModal({ edit: item })}
                          >
                            <MoreHorizontal size={20} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                {query ? (
                  <span className="empty-icon">
                    <Search size={32} />
                  </span>
                ) : tab === "bought" ? (
                  <span className="empty-icon">
                    <CheckCheck size={35} />
                  </span>
                ) : (
                  <BasketDrawing />
                )}
                <h2>
                  {query
                    ? "Nothing by that name."
                    : tab === "bought"
                      ? "Good things go in the cart."
                      : filter !== "All stores"
                        ? `All set for ${filter}.`
                        : needed.length === 0 && bought.length
                          ? "All picked up. Nicely done!"
                          : "A fresh list. A little less to remember."}
                </h2>
                <p>
                  {query ? (
                    "Try another word, or check a different store."
                  ) : tab === "bought" ? (
                    "Check off an item as you shop. You’ll find it here."
                  ) : filter !== "All stores" ? (
                    "Add something above, or see what’s needed at other stores."
                  ) : bought.length ? (
                    "Add anything else you need, or see what you bought."
                  ) : (
                    <>
                      Milk? Paper towels? That snack everyone loves?
                      <br />
                      Add the first thing that comes to mind.
                    </>
                  )}
                </p>
                {!query && tab === "needed" && (
                  <button
                    className="text-button empty-cta"
                    onClick={() => {
                      if (filter !== "All stores") setStore(filter);
                      nameRef.current?.focus();
                    }}
                  >
                    <Plus size={16} />
                    Add your first {filter !== "All stores" ? `${filter} ` : ""}
                    item
                  </button>
                )}
                {(query || filter !== "All stores") && (
                  <button
                    className="text-button"
                    onClick={() => {
                      setFilter("All stores");
                      setQuery("");
                    }}
                  >
                    Show all {tab === "needed" ? "items" : "bought items"}
                  </button>
                )}
              </div>
            )}
          </section>
          <div className="bottom-note">
            <Heart size={13} /> Less “did you get it?” More “got it.”
            <span>Made for real family life.</span>
          </div>
        </main>
      </div>
      <button className="mobile-install" onClick={() => openModal("install")}>
        <ArrowDownToLine size={15} /> Keep your list one tap away
      </button>
      {toast && (
        <div className="toast" role="status">
          <span>
            <Check size={15} />
          </span>
          {toast}
        </div>
      )}

      {modal === "aisles" && (
        <Modal
          title={`${filter} aisle order`}
          locked={modalBusy}
          onClose={() => setModal(null)}
        >
          <AisleOrderEditor
            list={list}
            store={filter}
            busy={modalBusy}
            onSave={async (selectedStore, order, revision) => {
              setModalBusy(true);
              try {
                await mutate(
                  "/aisle-order",
                  "PATCH",
                  { store: selectedStore, order },
                  { aisleOrder: revision },
                );
                changeGrouping(true);
                setModal(null);
                setToast("Aisle order saved");
              } finally {
                setModalBusy(false);
              }
            }}
          />
        </Modal>
      )}
      {modal === "sync" && (
        <Modal title="A little update to review" onClose={() => setModal(null)}>
          <SyncReview
            issues={sync.issues}
            waiting={sync.waiting}
            onResolve={(id, choice) => getSyncClient(token).resolve(id, choice)}
          />
        </Modal>
      )}
      {modal === "catalog" && (
        <Modal
          title="What do we need?"
          wide
          locked={modalBusy}
          onClose={() => setModal(null)}
        >
          <CatalogPicker
            list={list}
            initialStore={filter === "All stores" ? store : filter}
            onAdd={pickItems}
            unavailable={unavailable}
            onPin={pinItem}
            offline={connection === "offline"}
          />
        </Modal>
      )}
      {modal === "share" && (
        <Modal
          title="Good lists are better shared."
          onClose={() => setModal(null)}
        >
          <div className="share-illustration">
            <Users size={32} strokeWidth={1.5} />
            <span>
              <Heart size={15} fill="currentColor" />
            </span>
          </div>
          <p className="modal-description">
            Send this link to your family. Everyone can add items and check them
            off — the same list, updated live.
          </p>
          <label className="share-label">
            Your family’s private link
            <div className="share-url">
              <Link size={17} />
              <input
                value={shareUrl}
                readOnly
                aria-label="Family sharing link"
                onFocus={(e) => e.target.select()}
              />
              <button
                className="icon-button"
                aria-label="Copy family link"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(shareUrl);
                    setToast("Family link copied");
                  } catch {
                    setModalError(
                      "Select the link above, then copy it to share.",
                    );
                  }
                }}
              >
                <Copy size={18} />
              </button>
            </div>
          </label>
          <button
            className="button primary full"
            onClick={async () => {
              if (navigator.share) {
                try {
                  await navigator.share({
                    title: list.title,
                    text: "Here’s our family shopping list. Add what we need, and check things off as you shop.",
                    url: shareUrl,
                  });
                } catch (err) {
                  if (err.name !== "AbortError")
                    setModalError(
                      "Select and copy the link above to share it.",
                    );
                }
              } else {
                try {
                  await navigator.clipboard.writeText(shareUrl);
                  setToast("Family link copied — ready to send");
                } catch {
                  setModalError(
                    "Select the link above, then copy it to share.",
                  );
                }
              }
            }}
          >
            <Share2 size={17} />
            {navigator.share ? "Send to the family" : "Copy link to share"}
          </button>
          <p className="share-privacy">
            <Users size={15} />
            Anyone with this link can view and edit the list. Share it only with
            people you trust.
          </p>
          {modalError && (
            <p className="form-error" role="alert">
              {modalError}
            </p>
          )}
        </Modal>
      )}
      {modal === "rename" && (
        <Modal title="Make it yours." onClose={() => setModal(null)}>
          <form
            className="edit-form"
            onSubmit={async (e) => {
              e.preventDefault();
              setModalBusy(true);
              try {
                await mutate(
                  "",
                  "PATCH",
                  { title: rename },
                  { title: renameRevision },
                );
                setModal(null);
              } catch (err) {
                setModalError(err.message);
              } finally {
                setModalBusy(false);
              }
            }}
          >
            <label>
              List name
              <input
                value={rename}
                onChange={(e) => setRename(e.target.value)}
                maxLength={60}
                required
                autoFocus
              />
            </label>
            {modalError && (
              <p className="form-error" role="alert">
                {modalError}
              </p>
            )}
            <button
              className="button primary full"
              disabled={modalBusy || !rename.trim()}
            >
              {modalBusy ? (
                <LoaderCircle size={18} className="spin" />
              ) : (
                <Check size={18} />
              )}{" "}
              Save name
            </button>
          </form>
        </Modal>
      )}
      {modal === "clear" && (
        <Modal title="Ready for a fresh start?" onClose={() => setModal(null)}>
          <p className="modal-description">
            Remove all {bought.length} bought{" "}
            {bought.length === 1 ? "item" : "items"} from the family list? Items
            still to buy will stay. Recent purchases stay in Your usuals for
            next time.
          </p>
          {modalError && (
            <p className="form-error" role="alert">
              {modalError}
            </p>
          )}
          <div className="modal-actions">
            <button className="button" onClick={() => setModal(null)}>
              Keep them
            </button>
            <button
              className="button primary"
              disabled={modalBusy}
              onClick={async () => {
                setModalBusy(true);
                try {
                  await mutate("/completed", "DELETE");
                  setModal(null);
                  setToast("Bought items cleared");
                } catch (err) {
                  setModalError(err.message);
                } finally {
                  setModalBusy(false);
                }
              }}
            >
              {modalBusy ? (
                <LoaderCircle size={17} className="spin" />
              ) : (
                <Trash2 size={17} />
              )}{" "}
              Clear bought items
            </button>
          </div>
        </Modal>
      )}
      {modal === "install" && (
        <Modal title="Your list, one tap away." onClose={() => setModal(null)}>
          <span className="install-illustration">
            <ShoppingBasket size={38} />
          </span>
          <p className="modal-description">
            Keep Family Cart on your phone’s home screen. It opens like an app,
            right to your family’s list.
          </p>
          {installEvent ? (
            <button
              className="button primary full"
              onClick={async () => {
                await installEvent.prompt();
                const choice = await installEvent.userChoice;
                if (choice.outcome === "accepted") {
                  setInstallEvent(null);
                  setModal(null);
                }
              }}
            >
              <ArrowDownToLine size={18} /> Add Family Cart
            </button>
          ) : (
            <div className="install-instructions">
              <div>
                <strong>iPhone · Safari</strong>
                <p>
                  Open your family link in Safari. Tap Share{" "}
                  <Share2 size={13} />, then “Add to Home Screen.”
                </p>
              </div>
              <div>
                <strong>Android · Chrome</strong>
                <p>
                  Open your family link in Chrome. Tap the ⋮ menu, then “Add to
                  home screen” or “Install app.”
                </p>
              </div>
            </div>
          )}
          <p className="share-privacy">
            Open your family list online once before heading out. You can shop
            offline after that; changes sync when the connection returns.
          </p>
        </Modal>
      )}
      {modal?.edit && (
        <ItemEditor
          item={modal.edit}
          onClose={() => setModal(null)}
          onSave={(changes, baseline) =>
            mutate(`/items/${modal.edit.id}`, "PATCH", changes, baseline)
          }
          onDelete={() =>
            mutate(
              `/items/${modal.edit.id}`,
              "DELETE",
              undefined,
              modal.edit.fieldVersions || {},
            )
          }
        />
      )}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
if ("serviceWorker" in navigator && import.meta.env.PROD)
  window.addEventListener("load", () =>
    navigator.serviceWorker.register("/sw.js").catch(() => {}),
  );
