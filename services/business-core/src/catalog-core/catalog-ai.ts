import { UnprocessableEntityException } from "@nestjs/common";
import { normalizeUnit, type ImportRow } from "./catalog-import";

export type CleanSuggestion = { line: number; name?: string; size?: string; colour?: string; brand?: string; unit?: string; category?: string; note?: string };

export const CLEAN_SYSTEM = [
  "You tidy supplier and stock spreadsheets for an interior design and fit-out company.",
  "For each row return only what you are confident about:",
  "- name: a clean display name in sentence or title case, without prices, quantities, bundle or batch notes;",
  "- size: dimensions or size stated in the text (keep the original units);",
  "- colour: colour or finish stated in the text;",
  "- brand: the brand only if it is clearly named;",
  "- unit: only one of the allowed units, and only if the text states how it is sold;",
  "- category: only one of the given categories, and only when the row clearly belongs to another one;",
  "- note: a short note when the text holds a price or pack size worth checking.",
  "Never invent values. Omit a field when unsure. Keep the row's line number.",
  'Answer as {"rows":[{"line":1,"name":"…"}]}.',
].join("\n");

export function cleanPrompt(rows: ImportRow[], categories: string[], units: string[]) {
  return JSON.stringify({
    allowedUnits: units, categories,
    rows: rows.map((row) => ({ line: row.line, name: row.name, code: row.code, unit: row.unit, category: row.category, ...row.attributes })),
  });
}

const text = (value: unknown, max: number) => (typeof value === "string" && value.replace(/\s+/g, " ").trim() ? value.replace(/\s+/g, " ").trim().slice(0, max) : undefined);

/** Keeps only well-formed suggestions for lines that were asked about, with allowed units and categories. */
export function validateClean(value: unknown, rows: ImportRow[], categories: string[]): CleanSuggestion[] {
  const list = (value as { rows?: unknown })?.rows;
  if (!Array.isArray(list)) throw new UnprocessableEntityException("The AI answer did not fit. Try again, or continue manually.");
  const byLine = new Map(rows.map((row) => [row.line, row]));
  const allowedCategories = new Map(categories.map((category) => [category.toLowerCase(), category]));
  const out: CleanSuggestion[] = [];
  for (const entry of list) {
    const line = Number((entry as { line?: unknown })?.line);
    const source = byLine.get(line);
    if (!source) continue;
    const raw = entry as Record<string, unknown>;
    const suggestion: CleanSuggestion = { line };
    const name = text(raw.name, 200);
    if (name && name !== source.name) suggestion.name = name;
    for (const key of ["size", "colour", "brand", "note"] as const) {
      const value = text(raw[key], key === "note" ? 200 : 120);
      const existing = key === "size" ? source.attributes?.Size : key === "colour" ? source.attributes?.Colour : undefined;
      if (value && value !== existing) suggestion[key] = value;
    }
    const unit = text(raw.unit, 20);
    if (unit && !source.unit) { const normalized = normalizeUnit(unit); if (normalized.unit && !normalized.assumed) suggestion.unit = normalized.unit; }
    const category = text(raw.category, 160);
    if (category && allowedCategories.has(category.toLowerCase()) && category.toLowerCase() !== (source.category ?? "").toLowerCase()) suggestion.category = allowedCategories.get(category.toLowerCase());
    if (Object.keys(suggestion).length > 1) out.push(suggestion);
  }
  return out;
}

export type ComponentSuggestion = { componentItemId: string; name: string; quantityFormula: string; unitCode: string; reason?: string };
export const MEASUREMENT_VARIABLES = ["width", "height", "depth", "length", "area", "perimeter", "count"];

export const COMPONENTS_SYSTEM = [
  "You help an interior fit-out company build assemblies (wardrobes, kitchen runs, false ceilings, panelling) from catalog items.",
  "Suggest the components one unit of the assembly needs, choosing only item ids from the given catalog list.",
  `Quantity formulas may use numbers, + - * / ( ), ceil floor round min max abs, and only these measurements in millimetres or square metres: ${MEASUREMENT_VARIABLES.join(", ")}.`,
  "Use the component's own unit. Keep formulas simple and explain each in a short reason. Suggest nothing you are unsure about.",
  'Answer as {"components":[{"itemId":"…","formula":"…","unit":"…","reason":"…"}]}.',
].join("\n");

export function componentsPrompt(item: { name: string; itemType: string; description?: string | null; unitCode: string }, candidates: Array<{ id: string; name: string; code: string; unitCode: string; itemType: string }>) {
  return JSON.stringify({ assembly: item, catalog: candidates.map((candidate) => ({ itemId: candidate.id, name: candidate.name, code: candidate.code, unit: candidate.unitCode, type: candidate.itemType })) });
}

/** Keeps suggestions that name real catalog items and whose formulas parse with allowed variables. */
export function validateComponents(value: unknown, candidates: Array<{ id: string; name: string; unitCode: string }>, parse: (formula: string) => string[], units: string[]): ComponentSuggestion[] {
  const list = (value as { components?: unknown })?.components;
  if (!Array.isArray(list)) throw new UnprocessableEntityException("The AI answer did not fit. Try again, or continue manually.");
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const seen = new Set<string>();
  const out: ComponentSuggestion[] = [];
  for (const entry of list.slice(0, 20)) {
    const raw = entry as Record<string, unknown>;
    const item = byId.get(String(raw.itemId ?? ""));
    const formula = text(raw.formula, 200);
    if (!item || !formula || seen.has(item.id)) continue;
    try {
      const inputs = parse(formula);
      if (inputs.some((input) => !MEASUREMENT_VARIABLES.includes(input))) continue;
    } catch { continue; }
    const unit = text(raw.unit, 16);
    seen.add(item.id);
    out.push({ componentItemId: item.id, name: item.name, quantityFormula: formula, unitCode: unit && units.includes(unit) ? unit : item.unitCode, reason: text(raw.reason, 200) });
  }
  return out;
}
