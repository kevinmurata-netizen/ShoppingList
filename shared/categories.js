import { STORES } from "./items.js";

// Category IDs are the displayed names; an empty value deliberately means ungrouped.
export const CATEGORIES = [
  "Fruit",
  "Vegetables",
  "Bread & bakery",
  "Meat & seafood",
  "Dairy & eggs",
  "Pantry",
  "Snacks",
  "Beverages",
  "Frozen",
  "Household",
  "Personal care",
  "Pets",
];
export const ORDER_STORES = ["All stores", ...STORES];
export function cleanCategory(value = "") {
  if (
    typeof value !== "string" ||
    (value !== "" && !CATEGORIES.includes(value))
  )
    throw new Error("Choose a supported category, or leave it uncategorized.");
  return value;
}
export function cleanAisleOrder(store, order) {
  if (!ORDER_STORES.includes(store))
    throw new Error("Choose a supported store.");
  if (
    !Array.isArray(order) ||
    order.length !== CATEGORIES.length ||
    new Set(order).size !== CATEGORIES.length ||
    order.some((name) => !CATEGORIES.includes(name))
  )
    throw new Error("Include each category once in the aisle order.");
  return [...order];
}
export const aisleOrderFor = (list, store) =>
  list.categoryOrders?.[store] || CATEGORIES;
export function groupItems(items, order) {
  return [...order, ""]
    .map((category) => ({
      category,
      items: items.filter((item) => (item.category || "") === category),
    }))
    .filter((group) => group.items.length);
}
