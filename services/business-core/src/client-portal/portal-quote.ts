import { quoteExpired, round, totals } from "../commercial/commercial.domain";
import type { Quote, QuoteLine } from "../commercial/commercial.types";
import { quotationLineVariant, quotationMaterialText } from "../commercial/quotation-presentation";

/**
 * A quotation or variation as the client reads it: the issued document, field by field. Costs, QS review,
 * manual-line reasons, catalogue links, scope ids and who inside the firm approved it never leave.
 */
export function portalQuote(quote: Quote, grantId: string, role: "approver" | "viewer") {
  const expired = quoteExpired(quote);
  const decision = quote.clientDecision;
  return {
    id: quote.id,
    number: quote.number,
    kind: quote.kind,
    direction: quote.direction ?? null,
    status: quote.status,
    title: quote.title,
    currency: quote.currency,
    validUntil: quote.validUntil,
    issuedAt: quote.issuedAt ?? null,
    total: quote.total,
    discount: quote.discount,
    taxRate: quote.taxRate,
    terms: quote.terms,
    exclusions: quote.exclusions,
    inclusions: quote.inclusions ?? "",
    hash: quote.hash ?? null,
    expired,
    // The one named decision-maker decides; the first valid decision wins and everyone sees it.
    canDecide: quote.status === "issued" && quote.approverId === grantId && role === "approver" && !expired,
    cover: quote.cover ? {
      preparedFor: quote.cover.preparedFor, location: quote.cover.location, subtitle: quote.cover.subtitle, logo: quote.cover.logo ?? null,
      banner: quote.cover.banner ?? null, signature: quote.cover.signature ?? null, signerName: quote.cover.signerName ?? null,
      signerTitle: quote.cover.signerTitle ?? null, clientSignature: quote.cover.clientSignature ?? false, taxLabel: quote.cover.taxLabel ?? null,
      taxRegistration: quote.cover.taxRegistration ?? null,
    } : null,
    // The page design the firm issued (styling and its own client-facing text) is the document itself.
    presentation: quote.presentation ?? null,
    brand: quote.brand ? {
      name: quote.brand.name, logo: quote.brand.logo, primaryColor: quote.brand.primaryColor, accentColor: quote.brand.accentColor,
      welcomeTitle: quote.brand.welcomeTitle, welcomeText: quote.brand.welcomeText, supportPhone: quote.brand.supportPhone, layout: quote.brand.layout,
    } : null,
    rooms: (quote.rooms ?? []).map((room) => ({ id: room.id, name: room.name })),
    paymentTerms: (quote.paymentTerms ?? []).map((term) => ({ id: term.id, title: term.title, percent: term.percent, trigger: term.trigger })),
    lines: quote.lines.map((line) => portalQuoteLine(line, line.optional ? optionPrice(quote, line.id) : null)),
    decision: decision ? {
      decision: decision.decision, quoteHash: decision.quoteHash, selectedOptionLineIds: [...decision.selectedOptionLineIds], baseTotal: decision.baseTotal,
      optionsTotal: decision.optionsTotal, acceptedTotal: decision.acceptedTotal ?? null, decidedAt: decision.decidedAt, decidedBy: decision.decidedBy,
      note: decision.note ?? "",
    } : null,
  };
}

function portalQuoteLine(line: QuoteLine, optionPrice: number | null) {
  return {
    id: line.id,
    deductsLineId: line.deductsLineId ?? null,
    room: line.room,
    title: line.title,
    specification: line.specification,
    material: quotationMaterialText({ ...line, material: line.material ?? "", finish: line.finish ?? "" }, "material"),
    finish: quotationMaterialText({ ...line, material: line.material ?? "", finish: line.finish ?? "" }, "finish"),
    variantLabel: quotationLineVariant(line) ?? null,
    photo: line.photo ?? null,
    dimensions: line.dimensions ? { length: line.dimensions.length ?? null, height: line.dimensions.height ?? null, depth: line.dimensions.depth ?? null, unit: line.dimensions.unit } : null,
    pricingMode: line.pricingMode ?? "item",
    quantity: line.quantity,
    unit: line.unit,
    rate: line.rate,
    optional: line.optional ?? false,
    // What choosing this option adds to the total (with its discount and tax), priced by the quotation engine.
    optionPrice,
    materialRows: (line.materialRows ?? []).map((row) => ({
      id: row.id, name: row.name, type: row.type, specification: row.specification, quantity: row.quantity, unit: row.unit, rate: row.rate, suppliedByClient: row.suppliedByClient,
    })),
    customMaterials: (line.customMaterials ?? []).map((material) => ({
      id: material.id, name: material.name, brand: material.brand, code: material.code, specification: material.specification, suppliedByClient: material.suppliedByClient,
    })),
  };
}

/** The difference one option makes to the quotation's total. */
function optionPrice(quote: Quote, lineId: string) {
  try {
    const base = totals(quote).total;
    return round(totals({ ...quote, lines: quote.lines.map((line) => (line.id === lineId ? { ...line, optional: false } : line)) }).total - base);
  } catch {
    return null;
  }
}

export type PortalQuote = ReturnType<typeof portalQuote>;
