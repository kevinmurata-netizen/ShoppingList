import { STORES as STORE_NAMES } from "../shared/items.js";
import { cleanCategory } from "../shared/categories.js";
const STORES = new Set(STORE_NAMES);
export class InputError extends Error {}
export function text(value, field, max, optional = false) {
  if (typeof value !== "string") throw new InputError(`${field} must be text.`);
  const cleaned = value.trim();
  if ((!optional && !cleaned) || cleaned.length > max)
    throw new InputError(
      `${field} must be ${optional ? "at most" : "between 1 and"} ${max} characters.`,
    );
  return cleaned;
}
export function itemFields(body, partial = false) {
  const result = {};
  if (!partial || "name" in body)
    result.name = text(body.name, "Item name", 100);
  if (!partial || "store" in body) {
    result.store = body.store ?? "Costco";
    if (!STORES.has(result.store))
      throw new InputError("Choose a supported store.");
  }
  if (!partial || "quantity" in body) {
    result.quantity = body.quantity ?? 1;
    if (
      !Number.isInteger(result.quantity) ||
      result.quantity < 1 ||
      result.quantity > 99
    )
      throw new InputError("Quantity must be between 1 and 99.");
  }
  if (!partial || "note" in body)
    result.note = text(body.note ?? "", "Note", 200, true);
  if (!partial || "category" in body) {
    try {
      result.category = cleanCategory(body.category);
    } catch (error) {
      throw new InputError(error.message);
    }
  }
  if ("bought" in body) {
    if (typeof body.bought !== "boolean")
      throw new InputError("Bought must be true or false.");
    result.bought = body.bought;
  }
  return result;
}
