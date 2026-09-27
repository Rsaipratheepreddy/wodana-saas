import type { Quote, QuotationTemplate } from "./types";
import { translatorFor, type Translate } from "@/lib/i18n/keys";

/** Apply a reviewed copy. Identity, currency, approvals and case links stay with the destination. */
export function applyQuotationTemplate(
  quote: Quote,
  template: QuotationTemplate,
  t: Translate = translatorFor({}),
): Quote {
  if (quote.status !== "draft" || quote.kind !== "quotation")
    throw new Error(t("Templates can be used in draft quotations only."));
  if (quote.currency !== template.content.currency)
    throw new Error(
      t("This template is in {currency}. Choose a matching currency first; rates are never converted automatically.", { currency: template.content.currency }),
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
    presentation: content.presentation
      ? {
          ...content.presentation,
          pages: content.presentation.pages.map((page) => ({
            ...page,
            id: page.kind === "custom" ? `custom:${crypto.randomUUID()}` : page.id,
            elements: page.elements.map((element) => ({
              ...element,
              id: crypto.randomUUID(),
            })),
          })),
        }
      : undefined,
    paymentTerms: content.paymentTerms.map((term) => ({
      ...term,
      id: crypto.randomUUID(),
    })),
    paymentTemplate: undefined,
    requestIds: [],
  };
}
