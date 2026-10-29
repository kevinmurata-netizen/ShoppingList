import { cleanAisleOrder, aisleOrderFor } from "../shared/categories.js";
import { InputError, itemFields, text } from "./validation.js";
import { ITEM_FIELDS, stamped, versionsOf } from "../shared/operations.js";
import { itemKey, normalizeName } from "../shared/items.js";

const uuid = (value) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function before(op, fields) {
  if (
    !op.before ||
    typeof op.before !== "object" ||
    fields.some(
      (field) =>
        (field !== "category" || op.before[field] !== undefined) &&
        (typeof op.before[field] !== "string" || op.before[field].length > 64),
    )
  )
    throw new InputError(
      "This change is missing its original item details. Refresh and try again.",
    );
}
function conflict(message, fields = [], canRetry = true) {
  return { conflict: { message, fields, canRetry } };
}
const itemStatement = (token, item) => ({
  sql: "UPDATE items SET name = ?, store = ?, quantity = ?, note = ?, category = ?, bought = ?, bought_at = ?, field_versions = ? WHERE id = ? AND list_token = ?",
  args: [
    item.name,
    item.store,
    item.quantity,
    item.note,
    item.category || "",
    Number(item.bought),
    item.boughtAt,
    JSON.stringify(item.fieldVersions),
    item.id,
    token,
  ],
});

// Plan the entire operation before writing. The caller persists these statements
// and its receipt in one transaction, so a lost response is safe to retry.
export function planSync(op, list, token, remember) {
  if (!uuid(op.id)) throw new InputError("This saved change is invalid.");
  const statements = [],
    result = { operationId: op.id, aliases: [] };
  const asHistory = (item) =>
    remember(token, item, item.boughtAt || Date.now());
  if (op.type === "pick") {
    if (
      !Array.isArray(op.items) ||
      op.items.length < 1 ||
      op.items.length > 100
    )
      throw new InputError("Choose between 1 and 100 items.");
    const entries = op.items.map((item) => {
      if (!uuid(item?.id))
        throw new InputError("This item has an invalid identifier.");
      return { ...itemFields(item), id: item.id };
    });
    const working = list.items.map((item) => ({ ...item }));
    result.pickResult = { added: 0, restored: 0, alreadyNeeded: 0 };
    for (const entry of entries) {
      const matches = working.filter(
        (item) => itemKey(item) === itemKey(entry),
      );
      let item =
        matches.find((item) => !item.bought) ||
        matches.sort((a, b) => b.boughtAt - a.boughtAt)[0];
      if (item) {
        if (!item.bought) result.pickResult.alreadyNeeded++;
        else {
          statements.push(asHistory(item));
          item.bought = false;
          item.boughtAt = null;
          item.fieldVersions = stamped(versionsOf(item), ["bought"], op.id);
          statements.push(itemStatement(token, item));
          result.pickResult.restored++;
        }
      } else {
        if (working.some((item) => item.id === entry.id))
          throw new InputError("This item's identifier is already in use.");
        item = {
          ...entry,
          bought: false,
          boughtAt: null,
          createdAt: Date.now(),
          fieldVersions: stamped({}, ITEM_FIELDS, op.id),
        };
        working.push(item);
        statements.push({
          sql: "INSERT INTO items (id, list_token, name, store, quantity, note, category, created_at, field_versions) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          args: [
            item.id,
            token,
            item.name,
            item.store,
            item.quantity,
            item.note,
            item.category,
            item.createdAt,
            JSON.stringify(item.fieldVersions),
          ],
        });
        result.pickResult.added++;
      }
      result.aliases.push({
        localId: entry.id,
        itemId: item.id,
        fieldVersions: item.fieldVersions || {},
      });
    }
    if (working.length > 500)
      return conflict(
        "The family list is full. Clear some bought items, then retry this addition.",
      );
  } else if (op.type === "patch" || op.type === "delete") {
    if (typeof op.itemId !== "string" || op.itemId.length > 100)
      throw new InputError("This item is invalid.");
    const current = list.items.find((item) => item.id === op.itemId);
    if (!current) {
      if (op.type === "delete") return { statements, result };
      return conflict(
        "Your family removed this item while this phone was offline. It has not been added back.",
        [],
        false,
      );
    }
    const changes =
      op.type === "patch" ? itemFields(op.changes || {}, true) : {};
    const fields = op.type === "delete" ? ITEM_FIELDS : Object.keys(changes);
    if (!fields.length)
      throw new InputError("This change has no item details.");
    before(op, fields);
    const clashes = fields.filter(
      (field) =>
        (versionsOf(current)[field] || "") !== (op.before[field] || "") &&
        (op.type === "delete" || current[field] !== changes[field]),
    );
    if (clashes.length)
      return conflict(
        "Your family changed this item while this phone was offline. Choose which change to keep.",
        clashes.map((field) => ({
          field,
          mine: op.type === "delete" ? "Remove item" : changes[field],
          current: current[field],
        })),
      );
    if (op.type === "delete") {
      if (current.bought) statements.push(asHistory(current));
      statements.push({
        sql: "DELETE FROM items WHERE id = ? AND list_token = ?",
        args: [current.id, token],
      });
    } else {
      const updated = {
        ...current,
        ...changes,
        fieldVersions: stamped(versionsOf(current), fields, op.id),
      };
      if ("bought" in changes && current.bought !== changes.bought)
        updated.boughtAt = changes.bought ? Date.now() : null;
      if (updated.bought && !updated.boughtAt) updated.boughtAt = Date.now();
      statements.push(itemStatement(token, updated));
      if (updated.bought) {
        if (current.bought && itemKey(current) !== itemKey(updated))
          statements.push({
            sql: "DELETE FROM usual_items WHERE list_token = ? AND name_key = ? AND store = ?",
            args: [token, normalizeName(current.name), current.store],
          });
        statements.push(asHistory(updated));
      } else if (current.bought) statements.push(asHistory(current));
    }
  } else if (op.type === "clear") {
    if (
      !Array.isArray(op.targets) ||
      !op.targets.length ||
      op.targets.length > 500
    )
      throw new InputError("Choose bought items to clear.");
    const selected = [];
    for (const target of op.targets) {
      if (typeof target?.id !== "string")
        throw new InputError("This bought item is invalid.");
      const item = list.items.find((entry) => entry.id === target.id);
      if (!item) continue;
      before(target, ITEM_FIELDS);
      if (
        !item.bought ||
        ITEM_FIELDS.some(
          (field) =>
            (versionsOf(item)[field] || "") !== (target.before[field] || ""),
        )
      )
        return conflict(
          "Some bought items changed while this phone was offline. Keep the family update, then review Bought before clearing again.",
          [],
          false,
        );
      selected.push(item);
    }
    for (const item of selected)
      statements.push(asHistory(item), {
        sql: "DELETE FROM items WHERE id = ? AND list_token = ?",
        args: [item.id, token],
      });
  } else if (op.type === "rename") {
    const title = text(op.title, "List name", 60);
    before(op, ["title"]);
    if ((list.titleRevision || "") !== op.before.title && list.title !== title)
      return conflict(
        "Your family also renamed this list. Choose the name to keep.",
        [{ field: "title", mine: title, current: list.title }],
      );
    statements.push({
      sql: "UPDATE lists SET title = ?, title_revision = ? WHERE token = ?",
      args: [title, op.id, token],
    });
  } else if (op.type === "aisleOrder") {
    let order;
    try {
      order = cleanAisleOrder(op.store, op.order);
    } catch (error) {
      throw new InputError(error.message);
    }
    before(op, ["aisleOrder"]);
    const current = aisleOrderFor(list, op.store);
    if (
      (list.aisleRevisions?.[op.store] || "") !== op.before.aisleOrder &&
      JSON.stringify(current) !== JSON.stringify(order)
    )
      return conflict(
        "Your family also rearranged these aisles. Choose the order to keep.",
        [
          {
            field: "aisleOrder",
            mine: order.join(" → "),
            current: current.join(" → "),
          },
        ],
      );
    statements.push({
      sql: "UPDATE lists SET category_orders = ?, aisle_revisions = ? WHERE token = ?",
      args: [
        JSON.stringify({ ...list.categoryOrders, [op.store]: order }),
        JSON.stringify({ ...list.aisleRevisions, [op.store]: op.id }),
        token,
      ],
    });
  } else if (op.type === "favorite") {
    const item = itemFields(op.item || {});
    before(op, ["favorite"]);
    if (typeof op.pinned !== "boolean")
      throw new InputError("Choose whether to pin this favorite.");
    const current = list.favoriteStates.find(
      (entry) => itemKey(entry) === itemKey(item),
    );
    if (
      (current?.revision || "") !== op.before.favorite &&
      Boolean(current?.pinned) !== op.pinned
    )
      return conflict(
        "Your family also changed this favorite. Choose whether to keep it pinned.",
        [
          {
            field: "favorite",
            mine: op.pinned ? "Pinned" : "Not pinned",
            current: current?.pinned ? "Pinned" : "Not pinned",
          },
        ],
      );
    if (
      op.pinned &&
      !current?.pinned &&
      list.favoriteStates.filter((entry) => entry.pinned).length >= 200
    )
      return conflict(
        "The family has 200 pinned favorites. Unpin one before retrying.",
      );
    const details = op.pinned && current?.pinned ? current : item;
    statements.push({
      sql: `INSERT INTO favorite_items (list_token, name_key, store, name, quantity, note, category, pinned, pinned_at, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(list_token, name_key, store) DO UPDATE SET name=excluded.name, quantity=excluded.quantity, note=excluded.note, category=excluded.category, pinned=excluded.pinned, pinned_at=excluded.pinned_at, revision=excluded.revision`,
      args: [
        token,
        normalizeName(details.name),
        details.store,
        details.name,
        details.quantity,
        details.note,
        details.category || "",
        Number(op.pinned),
        Date.now(),
        op.id,
      ],
    });
  } else
    throw new InputError(
      "This saved change is not supported. Refresh the app.",
    );
  return { statements, result };
}
