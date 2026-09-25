import type { Quote, QuotationTemplate } from "./commercial.types";

/** Deliberate allowlist: never turn a client's identity, approval or source-scope IDs into a template. */
export function quotationTemplateContent(
  q: Quote,
): QuotationTemplate["content"] {
  return structuredClone({
    rooms: q.rooms?.map(({ id, name, catalog }) => ({ id, name, catalog })),
    lines: q.lines.map(
      ({
        id,
        room,
        title,
        specification,
        material,
        finish,
        quantity,
        unit,
        unitCost,
        rate,
        catalogLinks,
        customMaterials,
        variant,
        pricingMode,
        materialRows,
        dimensions,
      }) => ({
        id,
        room,
        title,
        specification,
        material,
        finish,
        quantity,
        unit,
        unitCost,
        rate,
        catalogLinks,
        customMaterials,
        variant,
        pricingMode,
        materialRows,
        dimensions,
      }),
    ),
    currency: q.currency,
    discount: q.discount,
    taxRate: q.taxRate,
    inclusions: q.inclusions,
    terms: q.terms,
    exclusions: q.exclusions,
    presentation: q.presentation?{...q.presentation,details:q.presentation.details?Object.fromEntries(Object.entries(q.presentation.details).filter(([key])=>['companyName','preparedBy','estimator','manager'].includes(key))):undefined}:undefined,
    paymentTerms: q.paymentTerms.map(
      ({ id, title, percent, trigger, requiredForRelease, requiredForProduction }) => ({
        id,
        title,
        percent,
        trigger,
        requiredForRelease,
        requiredForProduction: requiredForProduction === true,
      }),
    ),
  });
}
