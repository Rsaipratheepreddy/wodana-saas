import { Dec } from "../catalog-core/decimal";
import { evaluateFormula, FormulaError, formulaInputs, parseFormula } from "../catalog-core/formula";
import { applyWaste } from "../catalog-core/waste";

/**
 * A line's measurements; a formula can use these names (and the derived area and perimeter). Sizes are
 * written in their unit (e.g. cm) and a formula always works in metres, so `area` of 240 × 60 cm is 1.44 m².
 */
export type Measurements = { length?: string | null; width?: string | null; height?: string | null; count?: string | null; dimensionUnit?: string | null };
/** Metres per size unit; a size without a unit is taken as metres. */
const TO_METRES: Record<string, string> = { mm: "0.001", cm: "0.01", m: "1", in: "0.0254", ft: "0.3048" };
export const MEASUREMENT_NAMES = ["length", "width", "height", "count", "area", "perimeter", "wall"] as const;

export function measurementVariables(input: Measurements) {
  const variables: Record<string, Dec> = {};
  const scale = Dec.of(TO_METRES[input.dimensionUnit ?? "m"] ?? "1");
  for (const name of ["length", "width", "height", "count"] as const) {
    const value = input[name];
    if (value !== null && value !== undefined && value !== "") variables[name] = name === "count" ? Dec.of(value) : Dec.of(value).mul(scale);
  }
  const { length, width, height } = variables;
  if (length && width) { variables.area = length.mul(width); variables.perimeter = length.add(width).mul(2); }
  if (length && height) variables.wall = length.mul(height);
  // Short names for quick typing: l, w, h, n.
  if (length) variables.l = length;
  if (width) variables.w = width;
  if (height) variables.h = height;
  if (variables.count) variables.n = variables.count;
  return variables;
}

export type QuantityResult = { quantity: string; formula: string | null; inputs: string[]; error: string | null };

/**
 * The line's quantity: its formula over the measurements when it has one (e.g. `area * 1.05` or
 * `ceil(length / 0.6)`), otherwise the typed quantity. A formula that can't be worked out keeps the
 * typed quantity and reports why, so a draft is never silently wrong.
 */
export function lineQuantity(input: Measurements & { formula?: string | null; quantity: string | number }): QuantityResult {
  const formula = input.formula?.trim() || null;
  if (!formula) return { quantity: Dec.of(input.quantity).toString(), formula: null, inputs: [], error: null };
  try {
    const tree = parseFormula(formula);
    const inputs = formulaInputs(tree);
    const unknown = inputs.filter((name) => !isKnownName(name));
    if (unknown.length) return { quantity: Dec.of(input.quantity).toString(), formula, inputs, error: `Unknown value: ${unknown.join(", ")}` };
    const value = evaluateFormula(tree, measurementVariables(input));
    if (value.isNegative()) return { quantity: Dec.of(input.quantity).toString(), formula, inputs, error: "Works out below zero" };
    return { quantity: value.round(4).toString(), formula, inputs, error: null };
  } catch (error) {
    return { quantity: Dec.of(input.quantity).toString(), formula, inputs: [], error: error instanceof FormulaError ? error.message : "Invalid formula" };
  }
}
const isKnownName = (name: string) => (MEASUREMENT_NAMES as readonly string[]).includes(name) || ["l", "w", "h", "n"].includes(name);

export function checkFormula(formula: string) {
  const tree = parseFormula(formula);
  const unknown = formulaInputs(tree).filter((name) => !isKnownName(name));
  if (unknown.length) throw new FormulaError(`Unknown value: ${unknown.join(", ")}. Use length, width, height, count, area, perimeter or wall.`, 0);
}

export type ComponentInput = {
  name: string; quantityFormula?: string | null; quantity?: string | number | null; unitCost?: string | number | null;
  rate?: string | number | null; wastePercent?: string | number | null; suppliedByClient?: boolean;
};
export type BuiltComponent = { quantity: string; rate: string | null; cost: string | null; amount: string; error: string | null };
export type BuildUp = { rate: string; cost: string | null; components: BuiltComponent[]; complete: boolean };

/**
 * What one unit of the line is made of. Each row's quantity is per one line unit (its formula uses
 * the line's measurements), plus waste. The sell rate of a row is its own rate, or its cost plus the
 * line's markup; a row the client supplies adds nothing. The line's rate and cost are the sums.
 */
export function buildUp(components: ComponentInput[], measurements: Measurements, markupPercent: string | number | null | undefined, decimals: number): BuildUp {
  const variables = measurementVariables(measurements);
  const markup = markupPercent === null || markupPercent === undefined ? null : Dec.of(markupPercent);
  let rate = Dec.ZERO, cost: Dec | null = Dec.ZERO, complete = true;
  const built = components.map((component) => {
    let quantity = Dec.of(component.quantity ?? 0), error: string | null = null;
    if (component.quantityFormula?.trim()) {
      try { quantity = evaluateFormula(parseFormula(component.quantityFormula), variables); }
      catch (failure) { error = failure instanceof Error ? failure.message : "Invalid formula"; complete = false; }
    }
    if (component.wastePercent !== null && component.wastePercent !== undefined) quantity = applyWaste(quantity, { percent: String(component.wastePercent) }).quote;
    const unitCost = component.unitCost === null || component.unitCost === undefined ? null : Dec.of(component.unitCost);
    const sell = component.suppliedByClient ? Dec.ZERO
      : component.rate !== null && component.rate !== undefined ? Dec.of(component.rate)
      : unitCost && markup ? unitCost.mul(markup.add(100)).div(100)
      : unitCost;
    if (sell === null) complete = false;
    const amount = sell ? quantity.mul(sell) : Dec.ZERO;
    rate = rate.add(amount);
    if (component.suppliedByClient) { /* no cost to us */ }
    else if (unitCost === null) cost = null;
    else if (cost) cost = cost.add(quantity.mul(unitCost));
    return { quantity: quantity.round(4).toString(), rate: sell === null ? null : sell.toFixed(decimals), cost: unitCost === null ? null : unitCost.toFixed(decimals), amount: amount.toFixed(decimals), error };
  });
  return { rate: rate.toFixed(decimals), cost: cost === null ? null : cost.toFixed(decimals), components: built, complete };
}
