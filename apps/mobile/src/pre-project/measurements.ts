const metres: Record<string, number> = {mm: .001, cm: .01, m: 1, in: .0254, ft: .3048};
/** The shared measurement API accepts four decimal places in the chosen unit. */
export function convertMeasurement(value: number | null, from: string, to: string): number | null {
  if (value === null) return null;
  if (!metres[from] || !metres[to]) throw new Error('Choose a supported measurement unit.');
  const converted = Number((value * metres[from] / metres[to]).toFixed(4));
  if (!Number.isFinite(converted) || converted < .0001 || converted > 1e6) {
    throw new Error('This value cannot be represented in that unit. Keep the current unit or enter a new measurement.');
  }
  return converted;
}
