/** Site measurements: named dimensions in a unit, with the area and volume they imply. Pure functions. */
export type Unit = 'mm' | 'cm' | 'm' | 'in' | 'ft';
export const UNITS: Unit[] = ['mm', 'cm', 'm', 'in', 'ft'];
const METRES: Record<Unit, number> = { mm: 0.001, cm: 0.01, m: 1, in: 0.0254, ft: 0.3048 };
export const imperial = (unit: Unit) => unit === 'in' || unit === 'ft';

export const toMetres = (value: number, unit: Unit) => value * METRES[unit];

/** A typed measurement as the server takes it: at most 4 decimals, between 0.0001 and 1,000,000. */
export function parseMeasure(text: string): number | null {
  const clean = text.replace(',', '.').trim();
  if (!/^\d{1,7}(\.\d{1,4})?$/.test(clean)) return null;
  const value = Number(clean);
  return value >= 0.0001 && value <= 1_000_000 ? value : null;
}

/** Floor area (length × width) and volume (× height): m² and m³, or ft² and ft³ for imperial units. */
export function areaAndVolume(input: { length?: string; width?: string; height?: string }, unit: Unit) {
  const [length, width, height] = [input.length, input.width, input.height].map((value) => (value ? parseMeasure(value) : null));
  const base = imperial(unit) ? 0.3048 : 1;
  const side = (value: number | null) => (value === null ? null : toMetres(value, unit) / base);
  const [l, w, h] = [side(length), side(width), side(height)];
  const area = l !== null && w !== null ? Math.round(l * w * 100) / 100 : null;
  const volume = area !== null && h !== null ? Math.round(l! * w! * h * 100) / 100 : null;
  return { area, volume, areaUnit: imperial(unit) ? 'ft²' : 'm²', volumeUnit: imperial(unit) ? 'ft³' : 'm³' };
}

export type Basis = 'finished_item' | 'site_opening' | 'fabrication';
export type Dimension = { id: string; name: string; unit: Unit; basis: Basis; approximate: number | null; measured: number | null; source: 'team' | 'client'; evidence: string };

/** Rows to send: every named value that parses, measured by the team on site. */
export function toDimensions(rows: Array<{ id: string; name: string; value: string }>, unit: Unit, basis: Basis): Dimension[] {
  return rows.flatMap((row) => {
    const measured = parseMeasure(row.value);
    const name = row.name.trim().slice(0, 120);
    return measured !== null && name ? [{ id: row.id, name, unit, basis, approximate: null, measured, source: 'team' as const, evidence: '' }] : [];
  }).slice(0, 40);
}
