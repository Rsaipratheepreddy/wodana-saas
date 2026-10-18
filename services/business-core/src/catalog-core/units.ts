import { Dec } from "./decimal";

export type UnitKind = "count" | "length" | "area" | "volume" | "weight" | "time";
export type Unit = { code: string; kind: UnitKind; toBase: string; label: string };

/** Standard units with exact factors to the base unit of their kind (m, m², m³, kg, hour, piece). */
export const STANDARD_UNITS: Unit[] = [
  { code: "pcs", kind: "count", toBase: "1", label: "piece" },
  { code: "mm", kind: "length", toBase: "0.001", label: "millimetre" },
  { code: "cm", kind: "length", toBase: "0.01", label: "centimetre" },
  { code: "m", kind: "length", toBase: "1", label: "metre" },
  { code: "in", kind: "length", toBase: "0.0254", label: "inch" },
  { code: "ft", kind: "length", toBase: "0.3048", label: "foot" },
  { code: "rft", kind: "length", toBase: "0.3048", label: "running foot" },
  { code: "sqm", kind: "area", toBase: "1", label: "square metre" },
  { code: "sqft", kind: "area", toBase: "0.09290304", label: "square foot" },
  { code: "cum", kind: "volume", toBase: "1", label: "cubic metre" },
  { code: "l", kind: "volume", toBase: "0.001", label: "litre" },
  { code: "kg", kind: "weight", toBase: "1", label: "kilogram" },
  { code: "g", kind: "weight", toBase: "0.001", label: "gram" },
  { code: "hr", kind: "time", toBase: "1", label: "hour" },
  { code: "day", kind: "time", toBase: "8", label: "working day" },
];

/**
 * Item-specific conversions bridge kinds: a sheet covers 32 sqft, a box holds 12 pcs, a litre of
 * paint covers 10 sqm. `from` 1 = `factor` × `to`.
 */
export type ItemConversion = { from: string; to: string; factor: string };

export class UnitError extends Error {}

export function convert(quantity: Dec | string, from: string, to: string, units: Unit[] = STANDARD_UNITS, conversions: ItemConversion[] = []): Dec {
  const q = Dec.of(quantity);
  if (from === to) return q;
  const direct = conversions.find((c) => c.from === from && c.to === to);
  if (direct) return q.mul(direct.factor);
  const reverse = conversions.find((c) => c.from === to && c.to === from);
  if (reverse) return q.div(reverse.factor);
  const a = units.find((u) => u.code === from), b = units.find((u) => u.code === to);
  if (!a || !b) throw new UnitError(`Unknown unit ${!a ? from : to}`);
  if (a.kind === b.kind) return q.mul(a.toBase).div(b.toBase);
  // Through an item conversion on either side (e.g. sqft → sheet via sheet = 32 sqft).
  for (const c of conversions) {
    const cFrom = units.find((u) => u.code === c.from), cTo = units.find((u) => u.code === c.to);
    if (cTo && cTo.kind === a.kind && (c.from === to)) return convert(q, from, c.to, units).div(c.factor);
    if (cFrom && cFrom.kind === a.kind && (c.to === to)) return convert(q, from, c.from, units).mul(c.factor);
  }
  throw new UnitError(`Cannot convert ${a.label} to ${b.label}`);
}
