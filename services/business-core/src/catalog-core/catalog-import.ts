import { Dec } from "./decimal";
import { STANDARD_UNITS } from "./units";

export type ImportRow = {
  line: number; sheet?: string; category?: string; code?: string; name?: string; itemType?: string; unit?: string;
  attributes?: Record<string, string>; supplier?: string; supplierSku?: string; cost?: string; currency?: string;
};
export type PlannedRow = {
  line: number; sheet?: string; action: "create" | "update" | "skip" | "error";
  code: string; name: string; category: string | null; unit: string; itemType: string;
  attributes: Record<string, string>; supplier: string | null; cost: string | null; currency: string | null;
  messages: string[];
};
export type ImportContext = {
  existingCodes: Set<string>;
  units: Set<string>;
  vendors: Map<string, string>; // lowercased display name -> vendor id
  defaultCurrency: string;
};

const ITEM_TYPES = new Set(["product", "material", "assembly", "service", "package", "ready_made"]);
/** Common spellings in supplier sheets, mapped to unit codes. */
const UNIT_ALIASES: Record<string, string> = {
  pcs: "pcs", pc: "pcs", piece: "pcs", pieces: "pcs", nos: "pcs", no: "pcs", each: "pcs", ea: "pcs", unit: "pcs", units: "pcs",
  l: "l", ltr: "l", liter: "l", litre: "l", liters: "l", litres: "l",
  m: "m", mtr: "m", meter: "m", metre: "m", mm: "mm", cm: "cm", ft: "ft", feet: "ft", in: "in", inch: "in", rft: "rft",
  sqm: "sqm", m2: "sqm", sqft: "sqft", sft: "sqft", ft2: "sqft", kg: "kg", g: "g", cum: "cum", m3: "cum", hr: "hr", hour: "hr", day: "day",
  box: "box", boxes: "box", roll: "roll", rolls: "roll", pkt: "pkt", packet: "pkt", pack: "pkt", set: "set", sets: "set", pair: "pair",
  sheet: "sheet", sheets: "sheet", bundle: "bundle", bdl: "bundle", can: "can", tube: "tube", bag: "bag", drum: "drum", length: "length",
};
/** Count-like units a workspace gets on first use. */
export const PACK_UNITS: Record<string, string> = {
  box: "box", roll: "roll", pkt: "packet", set: "set", pair: "pair", sheet: "sheet", bundle: "bundle", can: "can", tube: "tube", bag: "bag", drum: "drum", length: "length",
};

export function normalizeUnit(raw: string | undefined) {
  const key = (raw ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (!key) return { unit: "pcs", assumed: true };
  const unit = UNIT_ALIASES[key] ?? (STANDARD_UNITS.some((standard) => standard.code === key) ? key : null);
  return { unit, assumed: false };
}

const prefixFor = (category: string | null) => (category ?? "ITEM").replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 4) || "ITEM";

/**
 * Plans an import without writing anything: what each row will do and why. Rows with errors are
 * left out; nothing is guessed silently (every assumption becomes a message).
 */
export function planCatalogImport(rows: ImportRow[], context: ImportContext): { rows: PlannedRow[]; summary: Record<PlannedRow["action"], number> & { newUnits: string[]; newCategories: string[]; newAttributes: string[] } } {
  const seenCodes = new Map<string, { line: number; name: string }>();
  const usedCodes = new Set([...context.existingCodes].map((code) => code.toLowerCase()));
  const counters = new Map<string, number>();
  const newUnits = new Set<string>(), categories = new Set<string>(), attributes = new Set<string>();
  const planned = rows.map((row): PlannedRow => {
    const messages: string[] = [];
    const name = (row.name ?? "").replace(/\s+/g, " ").trim();
    const category = row.category?.replace(/\s+/g, " ").trim() || null;
    const itemType = (row.itemType ?? "material").trim().toLowerCase().replace(/[\s-]+/g, "_");
    const base = { line: row.line, sheet: row.sheet, name, category, itemType, attributes: {} as Record<string, string>, supplier: null as string | null, cost: null as string | null, currency: null as string | null };
    if (!name) return { ...base, action: "skip", code: "", unit: "pcs", messages: ["No name"] };
    if (!ITEM_TYPES.has(itemType)) return { ...base, action: "error", code: row.code ?? "", unit: "pcs", messages: [`Unknown item type ${row.itemType}`] };

    const unit = normalizeUnit(row.unit);
    if (!unit.unit) return { ...base, action: "error", code: row.code ?? "", unit: row.unit ?? "", messages: [`Unknown unit "${row.unit}"`] };
    if (unit.assumed) messages.push("Unit not given, set to pieces");
    if (!context.units.has(unit.unit) && !STANDARD_UNITS.some((standard) => standard.code === unit.unit)) newUnits.add(unit.unit);

    let code = (row.code ?? "").replace(/\s+/g, " ").trim();
    if (!code) {
      const prefix = prefixFor(category);
      let next = counters.get(prefix) ?? 0;
      do { next += 1; code = `${prefix}-${String(next).padStart(4, "0")}`; } while (usedCodes.has(code.toLowerCase()) || seenCodes.has(code.toLowerCase()));
      counters.set(prefix, next);
      messages.push(`Code generated: ${code}`);
    }
    const key = code.toLowerCase();
    const earlier = seenCodes.get(key);
    if (earlier) {
      if (earlier.name.toLowerCase() === name.toLowerCase()) return { ...base, action: "skip", code, unit: unit.unit, messages: [`Same as line ${earlier.line}`] };
      return { ...base, action: "error", code, unit: unit.unit, messages: [`Code ${code} is also used on line ${earlier.line} for a different item`] };
    }
    seenCodes.set(key, { line: row.line, name });

    for (const [label, value] of Object.entries(row.attributes ?? {})) {
      const clean = String(value ?? "").replace(/\s+/g, " ").trim();
      if (clean) { base.attributes[label.trim()] = clean; attributes.add(label.trim()); }
    }
    if (category) categories.add(category);

    if (row.supplier?.trim()) {
      const vendor = context.vendors.get(row.supplier.trim().toLowerCase());
      if (vendor) base.supplier = row.supplier.trim();
      else messages.push(`Supplier "${row.supplier.trim()}" is not in your supplier list, so no supplier link`);
    }
    if (row.cost?.toString().trim()) {
      try {
        const cost = Dec.of(String(row.cost).replace(/[, ]/g, "").replace(/^[A-Z]{3}/i, ""));
        if (cost.isNegative()) throw new Error();
        if (base.supplier) { base.cost = cost.toString(); base.currency = (row.currency ?? context.defaultCurrency).toUpperCase(); }
        else messages.push("Cost needs a supplier, so it was not kept");
      } catch { messages.push(`Cost "${row.cost}" is not a number, so it was not kept`); }
    }
    return { ...base, action: usedCodes.has(key) ? "update" : "create", code, unit: unit.unit, messages };
  });
  const count = (action: PlannedRow["action"]) => planned.filter((row) => row.action === action).length;
  return { rows: planned, summary: { create: count("create"), update: count("update"), skip: count("skip"), error: count("error"), newUnits: [...newUnits], newCategories: [...categories], newAttributes: [...attributes] } };
}
