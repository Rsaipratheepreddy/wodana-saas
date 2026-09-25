import { round } from "../commercial/commercial.domain";
import { quotationMaterialText } from "../commercial/quotation-material-text";
import type { QuoteLine } from "../commercial/commercial.types";
import type { ReleasedScopeLine } from "./execution.types";

/**
 * Creates the execution-safe snapshot of an accepted commercial line.
 * Internal cost stays in Commercial; approved item photos follow their scope.
 */
export function releasedScopeLine(line: QuoteLine): ReleasedScopeLine {
  return {
    id: line.id,
    deductsLineId: line.deductsLineId,
    sourceScopeId: line.scopeId,
    sourceScopeVersion: line.scopeVersion,
    sourceSpecificationVersion: line.specificationVersion,
    title: line.title,
    photo: line.photo,
    room: line.room,
    specification: line.specification,
    material: quotationMaterialText(line),
    finish: line.finish,
    dimensions: line.dimensions ? { ...line.dimensions } : undefined,
    quantity: line.quantity,
    unit: line.unit,
    rate: line.rate,
    lineTotal: round(line.quantity * line.rate),
    variant: line.variant,
    pricingMode: line.pricingMode,
    materialRows: line.materialRows?.map((row) => ({ ...row })),
    customMaterials: line.customMaterials?.map((material) => ({ ...material })),
    catalogSelections: line.catalogLinks?.map((selection) => ({
      ...selection,
      snapshot: {
        ...selection.snapshot,
        configuration: selection.snapshot.configuration
          ? { ...selection.snapshot.configuration }
          : undefined,
      },
    })),
  };
}
