import type { QuoteLine } from "./types";

/**
 * Deterministic parser for the quotation quick-add line. Teams moving from
 * spreadsheets can type one sentence — "Master bedroom: 2 wardrobes 2400x2600
 * oak veneer 18500" — and see it become a structured, priced line. No provider
 * call is involved, so it works offline and never invents data.
 */
export type QuickLineDraft = {
  room: string | null;
  title: string;
  quantity: number;
  unit: string;
  material: string;
  finish: string;
  rate: number | null;
  dimensions: QuoteLine["dimensions"] | undefined;
  optional: boolean;
};

const UNITS: Record<string, string> = {
  nos: "nos", no: "nos", pcs: "nos", pc: "nos", piece: "nos", pieces: "nos", unit: "nos", units: "nos",
  set: "set", sets: "set", lot: "lot", lots: "lot", pair: "pair", pairs: "pair",
  sqm: "sqm", m2: "sqm", "m²": "sqm", sqft: "sqft", ft2: "sqft", lm: "lm", rm: "lm", rmt: "lm", m: "m", mtr: "m", metres: "m", meters: "m",
  hr: "hr", hrs: "hr", hours: "hr", day: "day", days: "day",
};
const MATERIALS = ["oak", "walnut", "teak", "ash", "beech", "veneer", "laminate", "lacquer", "pu", "duco", "marble", "quartz", "granite", "porcelain", "terrazzo", "mdf", "plywood", "ply", "hdf", "glass", "mirror", "brass", "steel", "stainless", "aluminium", "aluminum", "fabric", "leather", "velvet", "linen", "rattan", "acrylic", "corian", "solid surface"];
const FINISHES = ["matte", "matt", "gloss", "satin", "natural", "stained", "painted", "brushed", "polished", "textured", "fluted", "smoked", "bleached", "white", "black", "grey", "gray", "beige", "sand", "charcoal", "walnut-stain"];

const tidy = (text: string) => text.replace(/\s+/g, " ").trim();
const cap = (text: string) => text ? text[0].toUpperCase() + text.slice(1) : text;

export function parseQuickLine(input: string, rooms: string[] = []): QuickLineDraft | null {
  let text = tidy(input);
  if (!text) return null;
  let room: string | null = null;
  const colon = text.indexOf(":");
  if (colon > 0 && colon < 48) {
    const candidate = tidy(text.slice(0, colon));
    room = rooms.find((name) => name.toLowerCase() === candidate.toLowerCase()) ?? cap(candidate);
    text = tidy(text.slice(colon + 1));
  } else {
    const known = rooms.find((name) => text.toLowerCase().startsWith(`${name.toLowerCase()} `));
    if (known) { room = known; text = tidy(text.slice(known.length)); }
  }
  const optional = /\b(optional|alternate|option)\b/i.test(text);
  text = text.replace(/\b(optional|alternate|option)\b/gi, " ");

  // dimensions: 2400x2600[x600] [mm|cm|m]
  let dimensions: QuickLineDraft["dimensions"];
  const dim = text.match(/(\d{2,5}(?:\.\d+)?)\s*[x×*]\s*(\d{2,5}(?:\.\d+)?)(?:\s*[x×*]\s*(\d{2,5}(?:\.\d+)?))?\s*(mm|cm|m)?\b/i);
  if (dim) {
    const unit = (dim[4]?.toLowerCase() as "mm" | "cm" | "m" | undefined) ?? "mm";
    dimensions = { length: Number(dim[1]), height: Number(dim[2]), ...(dim[3] ? { depth: Number(dim[3]) } : {}), unit };
    text = tidy(text.replace(dim[0], " "));
  }

  // rate: trailing money, e.g. "18500", "AED 18,500", "@ 18.5k", "= 1200"
  let rate: number | null = null;
  const price = text.match(/(?:(?:@|=|at|for|price|rate|aed|usd|inr|gbp|eur|sar|qar)\s*)?(?:aed|usd|inr|gbp|eur|sar|qar)?\s*(\d[\d,]*(?:\.\d+)?)\s*(k)?\s*(?:each|ea|per\s+\w+|\/\s*\w+)?\s*$/i);
  if (price && (price.index ?? 0) > 0) {
    const value = Number(price[1].replaceAll(",", "")) * (price[2] ? 1000 : 1);
    if (Number.isFinite(value) && value > 0) { rate = value; text = tidy(text.slice(0, price.index)); }
  }

  // quantity: leading "2", "2 nos", "3 sets", "12 sqm"
  let quantity = 1;
  let unit = "nos";
  const qty = text.match(/^(\d+(?:\.\d+)?)\s*(?:x\s*)?([a-zA-Z²]+)?\s*/);
  if (qty && Number(qty[1]) > 0) {
    const maybeUnit = qty[2]?.toLowerCase();
    if (maybeUnit && UNITS[maybeUnit]) { quantity = Number(qty[1]); unit = UNITS[maybeUnit]; text = tidy(text.slice(qty[0].length)); }
    else if (!maybeUnit || !/^(and|with|in|of)$/i.test(maybeUnit)) { quantity = Number(qty[1]); text = tidy(text.slice(qty[1].length)); }
  }
  // trailing unit: "… 12 sqm" handled above; also "wardrobe x2"
  const suffix = text.match(/\s[x×](\d+)$/i);
  if (suffix) { quantity = Number(suffix[1]); text = tidy(text.slice(0, suffix.index)); }

  // material / finish words
  const words = text.split(" ");
  const materialWords: string[] = [];
  const finishWords: string[] = [];
  const titleWords: string[] = [];
  for (const word of words) {
    const lower = word.toLowerCase().replace(/[.,;]$/, "");
    if (MATERIALS.includes(lower)) materialWords.push(lower);
    else if (FINISHES.includes(lower) && titleWords.length) finishWords.push(lower);
    else titleWords.push(word);
  }
  const title = cap(tidy(titleWords.join(" ").replace(/\b(in|with|of)\s*$/i, "")));
  if (!title) return null;
  return {
    room,
    title,
    quantity,
    unit,
    material: cap(materialWords.join(" ")),
    finish: cap(finishWords.join(" ")),
    rate,
    dimensions,
    optional,
  };
}

export function describeQuickLine(draft: QuickLineDraft, currency: string): string[] {
  const parts = [draft.room ?? "General", `${draft.quantity} ${draft.unit}`, draft.title];
  if (draft.dimensions) parts.push([draft.dimensions.length, draft.dimensions.height, draft.dimensions.depth].filter((value) => value !== undefined).join("×") + ` ${draft.dimensions.unit}`);
  if (draft.material) parts.push(draft.material);
  if (draft.finish) parts.push(draft.finish);
  parts.push(draft.rate !== null ? new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: 0 }).format(draft.rate) : "Unpriced");
  if (draft.optional) parts.push("Optional");
  return parts;
}
