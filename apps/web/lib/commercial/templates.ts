import type { Quote, QuotationTemplate } from "./types";

/** Apply a reviewed copy. Identity, currency, approvals and case links stay with the destination. */
export function applyQuotationTemplate(
  quote: Quote,
  template: QuotationTemplate,
): Quote {
  if (quote.status !== "draft" || quote.kind !== "quotation")
    throw new Error("Templates can be used in draft quotations only.");
  if (quote.currency !== template.content.currency)
    throw new Error(
      `This template is in ${template.content.currency}. Choose a matching currency first; rates are never converted automatically.`,
    );
  const content = structuredClone(template.content);
  return {
    ...quote,
    rooms: content.rooms?.map((room) => ({ ...room, id: crypto.randomUUID() })),
    lines: content.lines.map((source) => {
      const line = {
        ...source,
        id: crypto.randomUUID(),
        customMaterials: source.customMaterials?.map((m) => ({
          ...m,
          id: crypto.randomUUID(),
        })),
      };
      delete line.scopeId;
      delete line.scopeVersion;
      delete line.specificationVersion;
      delete line.deductsLineId;
      return line;
    }),
    discount: content.discount,
    taxRate: content.taxRate,
    inclusions: content.inclusions,
    terms: content.terms,
    exclusions: content.exclusions,
    paymentTerms: content.paymentTerms.map((term) => ({
      ...term,
      id: crypto.randomUUID(),
    })),
    paymentTemplate: undefined,
    requestIds: [],
  };
}
