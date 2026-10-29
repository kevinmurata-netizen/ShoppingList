import { itemKey, STORES } from "./items.js";
import { cleanCategory, cleanAisleOrder } from "./categories.js";

export const ITEM_FIELDS = [
  "name",
  "store",
  "quantity",
  "note",
  "bought",
  "category",
];
export const versionsOf = (item) => item?.fieldVersions || {};
export const stamped = (versions, fields, revision) => ({
  ...versions,
  ...Object.fromEntries(fields.map((field) => [field, revision])),
});
export const operationDependencies = (op) =>
  Object.values(op.before || {})
    .concat(
      (op.targets || []).flatMap((target) =>
        Object.values(target.before || {}),
      ),
    )
    .filter((value) => typeof value === "string" && value);

export function cleanItem(input) {
  const name = typeof input?.name === "string" ? input.name.trim() : "";
  const store = input?.store || "Costco";
  const quantity = input?.quantity ?? 1;
  const note =
    typeof input?.note === "string"
      ? input.note.trim()
      : input?.note == null
        ? ""
        : null;
  if (!name || name.length > 100)
    throw new Error("Use an item name between 1 and 100 characters.");
  if (!STORES.includes(store)) throw new Error("Choose a supported store.");
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99)
    throw new Error("Quantity must be between 1 and 99.");
  if (note === null || note.length > 200)
    throw new Error("Use a note of at most 200 characters.");
  return {
    name,
    store,
    quantity,
    note,
    category: cleanCategory(input?.category),
  };
}

export function makeOperation(type, payload, list, id = crypto.randomUUID()) {
  const op = { id, type, createdAt: Date.now(), status: "queued" };
  if (type === "pick") {
    if (
      !Array.isArray(payload.items) ||
      !payload.items.length ||
      payload.items.length > 100
    )
      throw new Error("Choose between 1 and 100 items.");
    op.items = payload.items.map((item) => ({
      ...cleanItem(item),
      id: crypto.randomUUID(),
    }));
    op.label =
      op.items.length === 1 ? op.items[0].name : `${op.items.length} groceries`;
  } else if (type === "patch" || type === "delete") {
    const item = list.items.find((entry) => entry.id === payload.itemId);
    if (!item)
      throw new Error("That item was removed. Your list has refreshed.");
    op.itemId = item.id;
    op.label = item.name;
    if (type === "patch") {
      const desired = {
        ...cleanItem({ ...item, ...payload.changes }),
        bought: payload.changes.bought ?? item.bought,
      };
      if (typeof desired.bought !== "boolean")
        throw new Error("Choose a valid bought status.");
      op.changes = Object.fromEntries(
        ITEM_FIELDS.filter(
          (field) => field in payload.changes && desired[field] !== item[field],
        ).map((field) => [field, desired[field]]),
      );
      if (!Object.keys(op.changes).length) return null;
      op.before = Object.fromEntries(
        Object.keys(op.changes).map((field) => [
          field,
          payload.before?.[field] ?? versionsOf(item)[field] ?? "",
        ]),
      );
    } else
      op.before = Object.fromEntries(
        ITEM_FIELDS.map((field) => [
          field,
          payload.before?.[field] ?? versionsOf(item)[field] ?? "",
        ]),
      );
  } else if (type === "clear") {
    op.targets = list.items
      .filter((item) => item.bought)
      .map((item) => ({
        id: item.id,
        name: item.name,
        before: Object.fromEntries(
          ITEM_FIELDS.map((field) => [
            field,
            payload.before?.[field] ?? versionsOf(item)[field] ?? "",
          ]),
        ),
      }));
    if (!op.targets.length) return null;
    op.label = `${op.targets.length} bought items`;
  } else if (type === "rename") {
    op.title = payload.title.trim();
    if (!op.title || op.title.length > 60)
      throw new Error("Use a list name between 1 and 60 characters.");
    if (op.title === list.title) return null;
    op.before = { title: payload.before?.title ?? list.titleRevision ?? "" };
    op.label = "List name";
  } else if (type === "aisleOrder") {
    op.store = payload.store;
    op.order = cleanAisleOrder(op.store, payload.order);
    op.before = {
      aisleOrder:
        payload.before?.aisleOrder ?? list.aisleRevisions?.[op.store] ?? "",
    };
    op.label = `${op.store} aisle order`;
  } else if (type === "favorite") {
    op.item = cleanItem(payload.item);
    op.pinned = payload.pinned;
    if (typeof op.pinned !== "boolean")
      throw new Error("Choose whether to pin this item.");
    const current = (list.favoriteStates || []).find(
      (item) => itemKey(item) === itemKey(op.item),
    );
    if (Boolean(current?.pinned) === op.pinned) return null;
    if (
      op.pinned &&
      (list.favoriteStates || []).filter((item) => item.pinned).length >= 200
    )
      throw new Error(
        "Unpin a favorite before adding another. You can pin up to 200.",
      );
    op.before = {
      favorite: payload.before?.favorite ?? current?.revision ?? "",
    };
    op.label = op.item.name;
  } else throw new Error("This change is not supported.");
  return op;
}

export function projectList(base, operations = []) {
  if (!base) return null;
  let items = base.items.map((item) => ({
    ...item,
    category: item.category || "",
    fieldVersions: { ...versionsOf(item) },
  }));
  const favorites = new Map(
    (base.favoriteStates || []).map((item) => [itemKey(item), { ...item }]),
  );
  const usuals = new Map(
    (base.usuals || []).map((item) => [itemKey(item), { ...item }]),
  );
  let title = base.title,
    titleRevision = base.titleRevision || "",
    pickResult;
  const categoryOrders = { ...base.categoryOrders },
    aisleRevisions = { ...base.aisleRevisions };
  const aliases = new Map();
  const remember = (item, when) =>
    usuals.set(itemKey(item), {
      name: item.name,
      store: item.store,
      quantity: item.quantity,
      note: item.note,
      category: item.category || "",
      lastBought: when || item.boughtAt || item.createdAt,
    });
  for (const op of operations.filter((entry) => entry.status === "queued")) {
    if (op.type === "pick") {
      pickResult = { added: 0, restored: 0, alreadyNeeded: 0 };
      for (const pick of op.items) {
        const matches = items.filter((item) => itemKey(item) === itemKey(pick));
        const existing =
          matches.find((item) => !item.bought) ||
          matches.sort((a, b) => b.boughtAt - a.boughtAt)[0];
        if (existing) {
          aliases.set(pick.id, existing.id);
          if (!existing.bought) {
            pickResult.alreadyNeeded++;
            continue;
          }
          remember(existing);
          existing.bought = false;
          existing.boughtAt = null;
          existing.fieldVersions = stamped(
            versionsOf(existing),
            ["bought"],
            op.id,
          );
          pickResult.restored++;
        } else {
          items.push({
            ...pick,
            bought: false,
            boughtAt: null,
            createdAt: op.createdAt,
            fieldVersions: stamped({}, ITEM_FIELDS, op.id),
          });
          pickResult.added++;
        }
      }
    } else if (op.type === "patch") {
      const item = items.find(
        (entry) => entry.id === (aliases.get(op.itemId) || op.itemId),
      );
      if (item) {
        const wasBought = item.bought;
        Object.assign(item, op.changes);
        item.fieldVersions = stamped(
          versionsOf(item),
          Object.keys(op.changes),
          op.id,
        );
        if ("bought" in op.changes)
          item.boughtAt = item.bought ? op.createdAt : null;
        if (item.bought) remember(item, item.boughtAt || op.createdAt);
        else if (wasBought) remember({ ...item, boughtAt: op.createdAt });
      }
    } else if (op.type === "delete" || op.type === "clear") {
      const ids = new Set(
        op.type === "delete"
          ? [aliases.get(op.itemId) || op.itemId]
          : op.targets.map((entry) => aliases.get(entry.id) || entry.id),
      );
      for (const item of items.filter(
        (item) => ids.has(item.id) && item.bought,
      ))
        remember(item);
      items = items.filter((item) => !ids.has(item.id));
    } else if (op.type === "rename") {
      title = op.title;
      titleRevision = op.id;
    } else if (op.type === "aisleOrder") {
      categoryOrders[op.store] = op.order;
      aisleRevisions[op.store] = op.id;
    } else if (op.type === "favorite") {
      const key = itemKey(op.item),
        current = favorites.get(key);
      favorites.set(key, {
        ...(op.pinned && current?.pinned ? current : op.item),
        pinned: op.pinned,
        revision: op.id,
        pinnedAt: op.createdAt,
      });
    }
  }
  return {
    ...base,
    title,
    titleRevision,
    categoryOrders,
    aisleRevisions,
    items,
    usuals: [...usuals.values()]
      .sort((a, b) => b.lastBought - a.lastBought)
      .slice(0, 200),
    favoriteStates: [...favorites.values()],
    ...(pickResult ? { pickResult } : {}),
  };
}
