import { COMPONENT_TYPES, explode, type BomComponent, type ComponentType, type ExplodedComponent } from "./bom";
import type { Dec } from "./decimal";

/**
 * PLM-162 / PLM-166: a catalogue product's structured production recipe (its component lines by kind, each per unit or
 * per batch, labour with hours) and the one rule for using it on a project: quantities come only from a verified recipe.
 * A recipe the factory or technical team hasn't verified gives no quantities, and nothing is guessed in its place.
 */
export type RecipeVerification = { at: string; byName: string | null };

export type LineRequirements =
  /** No recipe: the item has no components (or the line has no catalogue item). */
  | { state: "none" }
  /** A recipe exists but nobody verified it: the line needs its factory requirements recorded instead. */
  | { state: "unverified"; components: number }
  /** Verified, but a formula needs a measurement the line doesn't have. */
  | { state: "needs_measurements"; problem: string }
  /** Verified: the quantities for the line, by kind, and the labour hours. */
  | { state: "verified"; lines: ExplodedComponent[]; labourHours: string; verified: RecipeVerification };

/** The material and labour requirements of one line from its catalogue recipe, for the line's quantity and measurements. */
export function recipeRequirements(recipe: { components: BomComponent[]; verified: RecipeVerification | null } | null, quantity: Dec | string,
  measurements: Record<string, Dec | string | number>): LineRequirements {
  if (!recipe || !recipe.components.length) return { state: "none" };
  if (!recipe.verified) return { state: "unverified", components: recipe.components.length };
  try {
    const lines = explode(recipe.components, quantity, measurements);
    const labourHours = lines.reduce((sum, line) => sum + Number(line.hours ?? 0), 0);
    return { state: "verified", lines, labourHours: String(Math.round(labourHours * 10_000) / 10_000), verified: recipe.verified };
  } catch (error) {
    return { state: "needs_measurements", problem: error instanceof Error ? error.message : "The recipe can't be worked out" };
  }
}

/** Lines grouped by kind in the standard order (board, fabric, foam, hardware, labour, other); empty kinds are left out. */
export function groupByType<T extends { componentType: ComponentType }>(lines: T[]): Array<{ type: ComponentType; lines: T[] }> {
  return COMPONENT_TYPES.map((type) => ({ type, lines: lines.filter((line) => line.componentType === type) })).filter((group) => group.lines.length > 0);
}

/** The measurements a quotation line gives a recipe's formulas (only what it has; a missing one is reported, never guessed). */
export function lineMeasurements(line: { width: string | null; height: string | null; length: string | null; depth?: string | null }) {
  const measurements: Record<string, string> = {};
  for (const [key, value] of Object.entries({ width: line.width, height: line.height, length: line.length, depth: line.depth ?? null })) if (value) measurements[key] = value;
  if (measurements.width && measurements.length) measurements.area = String(Number(measurements.width) * Number(measurements.length));
  else if (measurements.width && measurements.height) measurements.area = String(Number(measurements.width) * Number(measurements.height));
  return measurements;
}
