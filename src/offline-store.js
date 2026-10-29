import { makeOperation, projectList } from "../shared/operations.js";
import { itemKey } from "../shared/items.js";

let database;
const request = (value) =>
  new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error);
  });
async function open() {
  if (!database)
    database = new Promise((resolve, reject) => {
      const opening = indexedDB.open("family-cart-offline", 1);
      opening.onupgradeneeded = () => {
        const db = opening.result;
        db.createObjectStore("lists", { keyPath: "token" });
        const ops = db.createObjectStore("operations", {
          keyPath: "sequence",
          autoIncrement: true,
        });
        ops.createIndex("token", "token");
        ops.createIndex("id", "id", { unique: true });
      };
      opening.onerror = () => {
        database = null;
        reject(opening.error);
      };
      opening.onblocked = () => {
        database = null;
        reject(
          new Error(
            "Close another Family Cart tab to finish preparing offline storage.",
          ),
        );
      };
      opening.onsuccess = () => {
        const db = opening.result;
        db.onversionchange = () => {
          db.close();
          database = null;
        };
        resolve(db);
      };
    });
  return database;
}
async function transaction(mode, action) {
  const db = await open(),
    tx = db.transaction(["lists", "operations"], mode);
  const completed = new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onabort = tx.onerror = () =>
      reject(
        tx.error ||
          new Error("Your browser couldn't save changes on this phone."),
      );
  });
  const lists = tx.objectStore("lists"),
    operations = tx.objectStore("operations");
  try {
    const result = await action(lists, operations);
    await completed;
    return result;
  } catch (error) {
    try {
      tx.abort();
    } catch {}
    await completed.catch(() => {});
    throw error;
  }
}
const readWithin = async (token, lists, operations) => {
  const [record, queue] = await Promise.all([
    request(lists.get(token)),
    request(operations.index("token").getAll(token)),
  ]);
  return {
    base: record?.base || null,
    savedAt: record?.savedAt || null,
    queue: queue.sort((a, b) => a.sequence - b.sequence),
  };
};
function snapshot(data) {
  if (!data || !Number.isInteger(data.version) || !Array.isArray(data.items))
    throw new Error(
      "The family list response was incomplete. Please reconnect.",
    );
  const { syncResult, pickResult, token, ...base } = data;
  return base;
}
async function saveWithin(token, data, lists) {
  const old = await request(lists.get(token));
  const base = snapshot(data);
  if (!old || base.version >= old.base.version)
    await request(lists.put({ token, base, savedAt: Date.now() }));
}

export const offlineStore = {
  read(token) {
    return transaction("readonly", (lists, ops) =>
      readWithin(token, lists, ops),
    );
  },
  save(token, data) {
    return transaction("readwrite", (lists) => saveWithin(token, data, lists));
  },
  enqueue(token, type, payload) {
    return transaction("readwrite", async (lists, ops) => {
      const state = await readWithin(token, lists, ops);
      if (!state.base)
        throw new Error(
          "Open your family list online once before shopping offline.",
        );
      const current = projectList(state.base, state.queue);
      const operation = makeOperation(type, payload, current);
      if (!operation) return { operation: null, optimistic: current };
      operation.token = token;
      operation.sequence = await request(ops.add(operation));
      return {
        operation,
        optimistic: projectList(state.base, [...state.queue, operation]),
      };
    });
  },
  mark(id, status, details = {}) {
    return transaction("readwrite", async (_lists, ops) => {
      const op = await request(ops.index("id").get(id));
      if (op) await request(ops.put({ ...op, status, ...details }));
    });
  },
  acknowledge(token, id, data) {
    return transaction("readwrite", async (lists, ops) => {
      await saveWithin(token, data, lists);
      const queue = await request(ops.index("token").getAll(token));
      for (const op of queue) {
        if (op.id === id) {
          await request(ops.delete(op.sequence));
          continue;
        }
        for (const alias of data.syncResult?.aliases || []) {
          const remap = (entry) => {
            const field = "itemId" in entry ? "itemId" : "id";
            if (entry[field] !== alias.localId) return;
            entry[field] = alias.itemId;
            for (const name of Object.keys(entry.before || {}))
              if (entry.before[name] === id)
                entry.before[name] = alias.fieldVersions[name] || "";
          };
          if (op.itemId) remap(op);
          for (const target of op.targets || []) remap(target);
        }
        if (op.status === "waiting") {
          op.dependsOn = (op.dependsOn || []).filter((parent) => parent !== id);
          if (!op.dependsOn.length) op.status = "queued";
        }
        await request(ops.put(op));
      }
    });
  },
  resolve(token, id, choice) {
    return transaction("readwrite", async (lists, ops) => {
      const { base, queue } = await readWithin(token, lists, ops);
      const op = queue.find((entry) => entry.id === id);
      if (!op) return;
      if (choice === "dismiss") {
        await request(ops.delete(op.sequence));
        for (const child of queue.filter(
          (entry) =>
            entry.status === "waiting" && entry.dependsOn?.includes(id),
        )) {
          await request(
            ops.put({
              ...child,
              status: "blocked",
              conflict: {
                message:
                  "An earlier offline change was discarded. Review this later change before syncing it.",
                canRetry: child.type !== "clear",
                fields: [],
              },
            }),
          );
        }
        return;
      }
      const current = projectList(
        base,
        queue.filter((entry) => entry.sequence < op.sequence),
      );
      if (op.type === "patch" || op.type === "delete") {
        const item = current.items.find((entry) => entry.id === op.itemId);
        if (!item && op.type === "patch")
          throw new Error(
            "Your family removed this item. Keep the family update, then add it again if you need it.",
          );
        op.before = Object.fromEntries(
          Object.keys(op.before).map((field) => [
            field,
            item?.fieldVersions?.[field] || "",
          ]),
        );
      } else if (op.type === "favorite")
        op.before = {
          favorite:
            current.favoriteStates?.find(
              (item) => itemKey(item) === itemKey(op.item),
            )?.revision || "",
        };
      else if (op.type === "rename")
        op.before = { title: current.titleRevision || "" };
      op.status = "queued";
      delete op.conflict;
      delete op.dependsOn;
      await request(ops.put(op));
    });
  },
};
