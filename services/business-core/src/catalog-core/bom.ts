import { Dec } from "./decimal";
import { evaluateFormula, formulaInputs, parseFormula } from "./formula";
import { applyWaste } from "./waste";

/** What kind of thing a recipe line is (PLM-162): the material families a workshop buys and plans, labour, or anything else. */
export const COMPONENT_TYPES = ["board", "fabric", "foam", "hardware", "labour", "other"] as const;
export type ComponentType = (typeof COMPONENT_TYPES)[number];
/** Whether a line's formula gives the quantity for one unit made, or for a batch of `batchSize` units. */
export const QUANTITY_BASES = ["per_unit", "per_batch"] as const;
export type QuantityBasis = (typeof QUANTITY_BASES)[number];

export type BomComponent = {
  componentItemId: string; label: string; quantityFormula: string; unitCode: string; wastePercent?: string | null; purchaseRoundTo?: string | null;
  /** PLM-162: the line's kind, its quantity basis (and batch size) and, for labour, the hours; absent on older lines (other, per unit). */
  componentType?: ComponentType | null; quantityBasis?: QuantityBasis | null; batchSize?: string | null; labourHours?: string | null;
};

export class BomError extends Error {}

/** Rejects a component graph where an item (directly or through others) contains itself. */
export function assertNoCycle(parentId: string, componentIds: string[], childrenOf: (itemId: string) => string[]) {
  const seen = new Set<string>();
  const stack = [...componentIds];
  while (stack.length) {
    const next = stack.pop()!;
    if (next === parentId) throw new BomError("An item cannot contain itself, directly or through its components");
    if (seen.has(next)) continue;
    seen.add(next);
    stack.push(...childrenOf(next));
  }
}

/** Validates formulas up front, listing the inputs each one needs. */
export function checkFormulas(components: BomComponent[]) {
  return components.map((component) => {
    try { return { ...component, inputs: formulaInputs(parseFormula(component.quantityFormula)) }; }
    catch (error) { throw new BomError(`${component.label}: ${error instanceof Error ? error.message : "invalid formula"}`); }
  });
}

/** The recipe fields of a line as they are saved: a known kind and basis, a batch size only per batch, hours only on labour. */
export function checkRecipeFields(component: BomComponent) {
  const type = component.componentType ?? "other";
  if (!COMPONENT_TYPES.includes(type)) throw new BomError(`${component.label}: unknown component kind`);
  const basis = component.quantityBasis ?? "per_unit";
  if (!QUANTITY_BASES.includes(basis)) throw new BomError(`${component.label}: the quantity is per unit or per batch`);
  const decimal = (value: string | null | undefined, label: string, positive: boolean) => {
    if (value === null || value === undefined || value === "") return null;
    if (!/^\d{1,14}(\.\d{1,4})?$/.test(String(value).trim())) throw new BomError(`${component.label}: ${label} is a number`);
    const parsed = Dec.of(String(value).trim());
    if (positive && parsed.cmp(0) <= 0) throw new BomError(`${component.label}: ${label} is above zero`);
    return parsed.toString();
  };
  const batchSize = basis === "per_batch" ? decimal(component.batchSize, "the batch size", true) : null;
  if (basis === "per_batch" && batchSize === null) throw new BomError(`${component.label}: say how many units a batch makes`);
  const labourHours = type === "labour" ? decimal(component.labourHours, "the hours", false) : null;
  return { componentType: type, quantityBasis: basis, batchSize, labourHours };
}

export type ExplodedComponent = {
  componentItemId: string; label: string; unitCode: string; formula: string; componentType: ComponentType;
  /** The quantity per unit made (a per-batch formula is spread over its batch). */
  perAssembly: string;
  /** For the whole quantity made: with waste, and rounded to what is bought in. */
  quantity: string; purchaseQuantity: string;
  /** Labour lines: the hours for the whole quantity made (null on other lines, or when none are set). */
  hours: string | null;
};

/**
 * Explodes one assembly for a given quantity and measurements: each component's quantity per
 * assembly (formula; a per-batch formula divided by its batch size), times the assembly quantity, plus waste;
 * purchase quantity rounded to packs. Labour lines carry their hours for the whole quantity.
 */
export function explode(components: BomComponent[], quantity: Dec | string, measurements: Record<string, Dec | string | number>): ExplodedComponent[] {
  const count = Dec.of(quantity);
  return components.map((component) => {
    const batch = component.quantityBasis === "per_batch" && component.batchSize ? Dec.of(component.batchSize) : null;
    const formula = evaluateFormula(parseFormula(component.quantityFormula), measurements);
    if (formula.isNegative()) throw new BomError(`${component.label} works out below zero`);
    const per = batch ? formula.div(batch) : formula;
    const total = per.mul(count);
    const waste = applyWaste(total, { percent: component.wastePercent ?? undefined, roundUpTo: component.purchaseRoundTo ?? undefined });
    const type = component.componentType ?? "other";
    const hours = type === "labour" && component.labourHours ? (batch ? Dec.of(component.labourHours).div(batch) : Dec.of(component.labourHours)).mul(count).toString() : null;
    return {
      componentItemId: component.componentItemId, label: component.label, unitCode: component.unitCode, formula: component.quantityFormula, componentType: type,
      perAssembly: per.toString(), quantity: waste.quote.toString(), purchaseQuantity: waste.purchase.toString(), hours,
    };
  });
}
