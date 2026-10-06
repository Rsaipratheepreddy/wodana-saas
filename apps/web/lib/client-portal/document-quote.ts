import type { ClientQuote, PortalBrand } from "@/lib/commercial/types";
import type { PortalQuote, PortalSite } from "./types";

/** The tenant brand as the quotation cover shows it, for quotations issued before a brand was stamped on them. */
export function siteBrand(site: PortalSite): PortalBrand {
  return { name: site.brand.name, logo: site.brand.logoUrl ?? "", primaryColor: site.brand.primaryColor ?? "", accentColor: site.brand.secondaryColor ?? "",
    welcomeTitle: site.welcomeTitle, welcomeText: site.welcomeText, supportPhone: site.support.phone, layout: "minimal" };
}

/** A portal quotation in the shape the quotation document (screen and print) renders. */
export function documentQuote(quote: PortalQuote, fallbackBrand?: PortalBrand): ClientQuote {
  const decision = quote.decision;
  return {
    id: quote.id, number: quote.number, kind: quote.kind, direction: quote.direction ?? undefined, status: quote.status, title: quote.title, currency: quote.currency,
    validUntil: quote.validUntil, issuedAt: quote.issuedAt ?? undefined, createdAt: quote.issuedAt ?? "", total: quote.total, discount: quote.discount, taxRate: quote.taxRate,
    terms: quote.terms, exclusions: quote.exclusions, inclusions: quote.inclusions, hash: quote.hash ?? undefined, cover: quote.cover ?? undefined,
    presentation: quote.presentation ?? undefined, brand: quote.brand ?? fallbackBrand, letterhead: quote.letterhead ?? null, rooms: quote.rooms,
    paymentTerms: quote.paymentTerms.map((term) => ({ ...term, requiredForRelease: false })),
    lines: quote.lines.map((line) => ({
      id: line.id, deductsLineId: line.deductsLineId ?? undefined, room: line.room, title: line.title, specification: line.specification, material: line.material,
      finish: line.finish, variantLabel: line.variantLabel ?? undefined, photo: line.photo ?? undefined, pricingMode: line.pricingMode, quantity: line.quantity, unit: line.unit,
      rate: line.rate, optional: line.optional, materialRows: line.materialRows, customMaterials: line.customMaterials,
      dimensions: line.dimensions ? { length: line.dimensions.length ?? undefined, height: line.dimensions.height ?? undefined, depth: line.dimensions.depth ?? undefined,
        unit: line.dimensions.unit } : undefined,
    })),
    clientDecision: decision ? { decision: decision.decision, quoteHash: decision.quoteHash, selectedOptionLineIds: decision.selectedOptionLineIds, baseTotal: decision.baseTotal,
      optionsTotal: decision.optionsTotal, acceptedTotal: decision.acceptedTotal ?? undefined, decidedAt: decision.decidedAt, decidedBy: decision.decidedBy, note: decision.note } : undefined,
    decidedAt: decision?.decidedAt, decidedBy: decision?.decidedBy, canDecide: quote.canDecide, expired: quote.expired,
  } as unknown as ClientQuote;
}
