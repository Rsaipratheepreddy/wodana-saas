// Explicit interpretation of the supplied workbook's 40 units.
// Factors use Wodana's bases: m, m², m³, kg, each, hours.
// Pack quantities and technical ratings are intentionally not convertible.
export const roomBuilderUnits = Object.freeze({
  U001: { dimension: 'area', baseFactor: 0.09290304 }, // sqft
  U002: { dimension: 'area', baseFactor: 1 }, // sqm
  U003: { dimension: 'pack' }, // sheet, product-specific cutting/yield
  U004: { dimension: 'pack' },
  U005: { dimension: 'pack' },
  U006: { dimension: 'length', baseFactor: 0.3048 }, // running foot
  U007: { dimension: 'length', baseFactor: 1 }, // running metre
  U008: { dimension: 'length', baseFactor: 1 },
  U009: { dimension: 'length', baseFactor: 0.01 },
  U010: { dimension: 'length', baseFactor: 0.001 },
  U011: { dimension: 'length', baseFactor: 0.0254 },
  U012: { dimension: 'length', baseFactor: 0.3048 },
  U013: { dimension: 'count', baseFactor: 1 }, // piece
  U014: { dimension: 'count', baseFactor: 2 }, // pair
  U015: { dimension: 'pack' }, // a set has product-specific contents
  U016: { dimension: 'count', baseFactor: 1 }, // number
  U017: { dimension: 'mass', baseFactor: 1 }, // kg
  U018: { dimension: 'mass', baseFactor: 0.001 }, // g
  U019: { dimension: 'volume', baseFactor: 0.001 }, // litre
  U020: { dimension: 'volume', baseFactor: 0.000001 }, // ml
  U021: { dimension: 'pack' }, // box
  U022: { dimension: 'pack' }, // bundle
  U023: { dimension: 'volume', baseFactor: 0.028316846592 }, // cubic foot
  U024: { dimension: 'volume', baseFactor: 1 }, // cubic metre
  U025: { dimension: 'pack' }, // roll: nominal length is not a universal unit
  U026: { dimension: 'pack' }, // carton
  U027: { dimension: 'pack' }, // tin
  U028: { dimension: 'pack' }, // bucket
  U029: { dimension: 'pack' }, // strip
  U030: { dimension: 'pack' }, // coil
  U031: { dimension: 'pack' }, // tube
  U032: { dimension: 'area', baseFactor: 0.83612736 }, // square yard
  U033: { dimension: 'area', baseFactor: 0.09290304 }, // tile sqft
  U034: { dimension: 'area', baseFactor: 0.09290304 }, // per sqft area
  U035: { dimension: 'count', baseFactor: 1 }, // point
  U036: { dimension: 'count', baseFactor: 12 }, // dozen
  U037: { dimension: 'count', baseFactor: 144 }, // gross
  U038: { dimension: 'reference' }, // watt: technical rating, not order quantity
  U039: { dimension: 'reference' }, // lumen
  U040: { dimension: 'reference' }, // kelvin; affine temperature conversions unsupported
});

export function roomBuilderUnit(row) {
  const mapped = roomBuilderUnits[String(row.unit_id ?? '')];
  if (!mapped) throw new Error(`Unreviewed Room Builder unit: ${row.unit_id}`);
  return mapped;
}
