export const STORES = ["Costco", "Walmart", "Target", "Safeway", "Other"];

export function normalizeName(name) {
  return name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

export function itemKey(item) {
  return JSON.stringify([normalizeName(item.name), item.store]);
}

export function familyUsuals(list) {
  const entries = new Map();
  for (const item of [
    ...(list.usuals || []),
    ...list.items
      .filter((item) => item.bought)
      .map((item) => ({
        ...item,
        lastBought: item.boughtAt || item.createdAt,
      })),
  ]) {
    const key = itemKey(item);
    if (!entries.has(key) || entries.get(key).lastBought <= item.lastBought)
      entries.set(key, item);
  }
  return [...entries.values()].sort(
    (a, b) => b.lastBought - a.lastBought || a.name.localeCompare(b.name),
  );
}
