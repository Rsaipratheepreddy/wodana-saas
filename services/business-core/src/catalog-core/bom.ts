import { Dec } from "./decimal";
import { evaluateFormula, formulaInputs, parseFormula } from "./formula";
import { applyWaste } from "./waste";

export type BomComponent = { componentItemId: string; label: string; quantityFormula: string; unitCode: string; wastePercent?: string | null; purchaseRoundTo?: string | null };

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

/**
 * Explodes one assembly for a given quantity and measurements: each component's quantity per
 * assembly (formula), times the assembly quantity, plus waste; purchase quantity rounded to packs.
 */
export function explode(components: BomComponent[], quantity: Dec | string, measurements: Record<string, Dec | string | number>) {
  const count = Dec.of(quantity);
  return components.map((component) => {
    const per = evaluateFormula(parseFormula(component.quantityFormula), measurements);
    if (per.isNegative()) throw new BomError(`${component.label} works out below zero`);
    const total = per.mul(count);
    const waste = applyWaste(total, { percent: component.wastePercent ?? undefined, roundUpTo: component.purchaseRoundTo ?? undefined });
    return {
      componentItemId: component.componentItemId, label: component.label, unitCode: component.unitCode, formula: component.quantityFormula,
      perAssembly: per.toString(), quantity: waste.quote.toString(), purchaseQuantity: waste.purchase.toString(),
    };
  });
}
