import { priceQuote, PricingError } from "../quotation/quote-pricing";
import { Dec } from "../catalog-core/decimal";
import { currencyDecimals } from "../common/currency";
import { canonicalHash } from "../crm/shared/crm-types";
import {parseQuotationRichText} from "./quotation-rich-text";
import { quotationLineVariant, quotationMaterialText } from "./quotation-presentation";
import { materialsRate } from "./quotation-pricing";
import { BadRequestException, ConflictException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type {
  CommercialData,
  Quote,
  QuoteLine,
  PortalBrand,
  ClientQuote,
  ClientChangeRequest,
  ChangeRequest,
  PaymentTerm,
  QuotePresentation,
  QuoteDecisionEvidence,
} from "./commercial.types";
export const emptyCommercial = (): CommercialData => ({
  revision: 0,
  quotes: [],
  requests: [],
  agreement: null,
  payments: [],
  financeContext: null,
  financeDocuments: [],
  receipts: [],
  allocations: [],
  credits: [],
  audit: [],
  ownerReview: null,
  dealFile: null,
  materialApprovals: [],
  release: null,
});
export const defaultBrand = (name: string): PortalBrand => ({
  name,
  logo: "",
  primaryColor: "#292d32",
  accentColor: "#292d32",
  welcomeTitle: "Your space, coming together.",
  welcomeText:
    "Review your designs, quotations and next steps. Everything in one place.",
  supportPhone: "",
  layout: "minimal",
});
export function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new BadRequestException("Invalid request.");
  return input as Record<string, unknown>;
}
export function text(input: unknown, max = 3000, required = false): string {
  if (
    typeof input !== "string" ||
    input.length > max ||
    (required && !input.trim())
  )
    throw new BadRequestException("Check the required fields and text length.");
  return input.trim();
}
export function number(input: unknown, max = 1e9, min = 0): number {
  if (
    typeof input !== "number" ||
    !Number.isFinite(input) ||
    input < min ||
    input > max
  )
    throw new BadRequestException("Enter a valid positive amount or quantity.");
  return input;
}
export function date(input: unknown): string {
  const s = text(input, 10, true);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(s) ||
    !Number.isFinite(Date.parse(s)) ||
    new Date(s).toISOString().slice(0, 10) !== s
  )
    throw new BadRequestException("Enter a valid date.");
  return s;
}
export function phone(input: unknown): string {
  const p = text(input, 30, true).replace(/[\s()-]/g, "");
  if (!/^\+[1-9]\d{7,14}$/.test(p))
    throw new BadRequestException(
      "Use the complete mobile number with country code, for example +971501234567.",
    );
  return p;
}
/** Two-place money for inputs without a currency (rates typed on a line), exactly: decimal, half away from zero. */
export const round = (n: number) => Dec.of(n).round(2).toNumber();
/** An amount as exact money in the currency's minor units (two places without one). */
export const moneyOf = (n: number, currencyCode?: string) => Dec.of(n).round(currencyCode ? currencyDecimals(currencyCode) : 2);
export function totals(q: Pick<Quote, "lines" | "discount" | "taxRate"> & Partial<Pick<Quote, "pricing" | "discounts" | "currency">>) {
  // Quotes edited in the builder carry their pricing policy: price them with the shared engine.
  if (q.pricing) {
    let priced;
    try {
      priced = priceQuote(q.lines.map((line) => ({
        id: line.id, quantity: String(line.quantity), rate: String(line.rate), unitCost: line.unitCost === undefined || line.unitCost === null ? null : String(line.unitCost),
        optional: Boolean(line.optional), areaKey: line.areaId ?? "general", tradeKey: line.workPackageId ?? "none",
        discountKind: line.discountKind ?? null, discountValue: line.discountValue === undefined || line.discountValue === null ? null : String(line.discountValue),
        taxRate: line.lineTaxRate === undefined || line.lineTaxRate === null ? String(q.taxRate) : String(line.lineTaxRate),
        credit: line.changeOp === "omit",
      })), (q.discounts ?? []).map((discount) => ({ ...discount, value: String(discount.value) })), q.pricing);
    } catch (error) {
      if (error instanceof PricingError) throw new BadRequestException(error.message);
      throw error;
    }
    return {
      subtotal: Number(priced.subtotal), cost: Number(priced.cost ?? 0), discount: Number(priced.discounts.total),
      net: Number(priced.net), tax: Number(priced.tax), total: Number(priced.total), margin: Number(priced.margin ?? 0),
      costMissing: priced.cost === null || quoteCostMissing(q.lines.filter((line) => !line.optional && line.changeOp !== "omit")),
    };
  }
  // Older quotes without a pricing policy: the same arithmetic, exact, in the currency's minor units.
  const places = q.currency ? currencyDecimals(q.currency) : 2;
  const money = (value: Dec) => value.round(places);
  const includedLines = q.lines.filter((line) => !line.optional);
  const subtotal = money(includedLines.reduce((sum, line) => sum.add(money(Dec.of(line.quantity).mul(line.rate))), Dec.ZERO));
  const cost = money(includedLines.reduce((sum, line) => sum.add(money(Dec.of(line.quantity).mul(line.unitCost ?? 0))), Dec.ZERO));
  const discount = money(Dec.of(q.discount));
  if (discount.cmp(subtotal) > 0)
    throw new BadRequestException("Discount cannot exceed the subtotal.");
  const net = subtotal.sub(discount);
  const tax = money(net.mul(q.taxRate).div(100));
  return {
    subtotal: subtotal.toNumber(),
    cost: cost.toNumber(),
    discount: discount.toNumber(),
    net: net.toNumber(),
    tax: tax.toNumber(),
    total: net.add(tax).toNumber(),
    margin: net.isZero() ? 0 : net.sub(cost).div(net).mul(100).round(2).toNumber(),
    costMissing: quoteCostMissing(includedLines),
  };
}
/**
 * Whether a charged line has no cost (none entered, or zero while it sells for something): the margin is then unknown,
 * never a false 100%.
 */
export function quoteCostMissing(lines: Array<Pick<QuoteLine, "quantity" | "rate" | "unitCost">>) {
  return lines.some((line) => Dec.of(line.quantity).mul(line.rate).cmp(0) > 0 && !(line.unitCost !== null && line.unitCost !== undefined && Dec.of(line.unitCost).cmp(0) > 0));
}
export function parseLines(input: unknown): QuoteLine[] {
  if (!Array.isArray(input) || input.length > 300)
    throw new BadRequestException("Use up to 300 quotation items.");
  const lines = input.map((value) => {
    const l = object(value);
    const line: QuoteLine = {
      id: text(l.id, 80, true),
      room: text(l.room, 120, true),
      title: text(l.title, 240, true),
      specification: text(l.specification, 32000),
      material: text(l.material, 64000),
      finish: text(l.finish, 32000),
      quantity: number(l.quantity, 1e6, 0.0001),
      unit: text(l.unit, 20, true),
      unitCost: round(number(l.unitCost, 1e8)),
      rate: round(number(l.rate, 1e8)),
    };
    if (l.optional !== undefined) line.optional = l.optional === true;
    if (l.manualReason !== undefined)
      line.manualReason = text(l.manualReason, 500);
    if (l.variant !== undefined) line.variant = text(l.variant, 240);
    if (l.photo !== undefined) {
      line.photo = text(l.photo, 60000);
      if (line.photo && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(line.photo))
        throw new BadRequestException("Use a PNG, JPEG or WebP quotation photo.");
    }
    if (l.dimensions !== undefined) {
      const dimensions = object(l.dimensions);
      if (!["mm", "cm", "m", "in", "ft"].includes(String(dimensions.unit)))
        throw new BadRequestException("Choose a valid quotation size unit.");
      const values = (["length", "height", "depth"] as const).flatMap((key) =>
        dimensions[key] === undefined || dimensions[key] === null || dimensions[key] === ""
          ? []
          : [[key, number(dimensions[key], 1e6, 0.0001)] as const],
      );
      if (!values.length) throw new BadRequestException("Enter at least one quotation size.");
      line.dimensions = { unit: dimensions.unit as NonNullable<QuoteLine["dimensions"]>["unit"], ...Object.fromEntries(values) };
    }
    if (l.pricingMode !== undefined) {
      if (l.pricingMode !== 'item' && l.pricingMode !== 'materials') throw new BadRequestException('Choose item or materials pricing.');
      line.pricingMode = l.pricingMode;
    }
    if (l.materialRows !== undefined) {
      if (!Array.isArray(l.materialRows) || l.materialRows.length > 40) throw new BadRequestException('Use up to 40 material rows per item.');
      line.materialRows = l.materialRows.map(value => {
        const m = object(value);
        if (!['material', 'finish', 'labour', 'other'].includes(String(m.type))) throw new BadRequestException('Choose a valid material row type.');
        return { id: text(m.id, 80, true), name: text(m.name, 240, true), type: m.type as 'material' | 'finish' | 'labour' | 'other', specification: text(m.specification ?? '', 64000), quantity: number(m.quantity, 1e6), unit: text(m.unit, 20, true), rate: round(number(m.rate, 1e8)), suppliedByClient: m.suppliedByClient === true };
      });
      if (new Set(line.materialRows.map(m => m.id)).size !== line.materialRows.length) throw new BadRequestException('Duplicate material row IDs.');
    }
    if (line.pricingMode === 'materials') line.rate = number(materialsRate(line.materialRows ?? []), 1e8);
    for (const key of ["scopeId", "deductsLineId"] as const)
      if (l[key]) line[key] = text(l[key], 80, true);
    for (const key of ["scopeVersion", "specificationVersion"] as const)
      if (l[key]) line[key] = number(l[key], 1e8, 1);
    if (l.customMaterials !== undefined) {
      if (!Array.isArray(l.customMaterials) || l.customMaterials.length > 20)
        throw new BadRequestException("Use up to 20 custom materials per item.");
      line.customMaterials = l.customMaterials.map((value) => {
        const m = object(value);
        return { id: text(m.id, 80, true), name: text(m.name, 240, true), code: text(m.code ?? "", 80), brand: text(m.brand ?? "", 160), specification: text(m.specification ?? "", 3000), suppliedByClient: m.suppliedByClient === true };
      });
      if (new Set(line.customMaterials.map(m => m.id)).size !== line.customMaterials.length)
        throw new BadRequestException("Duplicate custom material IDs.");
    }
    if (l.catalogLinks) {
      if (!Array.isArray(l.catalogLinks) || l.catalogLinks.length > 12)
        throw new BadRequestException(
          "Use up to 12 catalog selections per item.",
        );
      line.catalogLinks = l.catalogLinks.map((v) => {
        const c = object(v);
        return {
          role: text(c.role, 30, true),
          recordId: text(c.recordId, 80, true),
          version: number(c.version, 1e8, 1),
          snapshot: {
            id: "",
            name: "",
            code: "",
            kind: "",
            version: 0,
            catalogId: "",
          },
        };
      });
    }
    if (l.catalogPriceRequest !== undefined) {
      const request = object(l.catalogPriceRequest);
      if (request.action !== "resolve" && request.action !== "override")
        throw new BadRequestException(
          "Choose resolve or override for catalog pricing.",
        );
      line.catalogPriceRequest = {
        action: request.action,
        ...(request.pricingDate !== undefined
          ? { pricingDate: date(request.pricingDate) }
          : {}),
        ...(request.rateZoneId !== undefined
          ? { rateZoneId: text(request.rateZoneId, 80, true) }
          : {}),
        ...(request.rateZoneVersion !== undefined
          ? {
              rateZoneVersion: number(
                request.rateZoneVersion,
                1e8,
                1,
              ),
            }
          : {}),
        ...(request.reason !== undefined
          ? { reason: text(request.reason, 500) }
          : {}),
      };
      if (
        Boolean(line.catalogPriceRequest.rateZoneId) !==
        Boolean(line.catalogPriceRequest.rateZoneVersion)
      )
        throw new BadRequestException(
          "Select the current version of the pricing zone.",
        );
      if (
        line.catalogPriceRequest.action === "override" &&
        !line.catalogPriceRequest.reason
      )
        throw new BadRequestException(
          "Explain why the catalog selling price is being overridden.",
        );
    }
    return line;
  });
  if (new Set(lines.map((l) => l.id)).size !== lines.length)
    throw new BadRequestException("Duplicate item IDs.");
  if (lines.reduce((sum, line) => sum + (line.photo?.length ?? 0), 0) > 600000)
    throw new BadRequestException('Quotation photos are too large together. Remove a photo or use smaller images.');
  return lines;
}
export function editable(q: Quote) {
  if (q.status !== "draft")
    throw new ConflictException(
      "Only drafts can be edited. Return this version to draft or create a revision.",
    );
}
export function actionable(q: Quote, now = new Date()) {
  if (
    q.status !== "issued" ||
    Date.parse(q.validUntil + "T23:59:59.999Z") < now.getTime()
  )
    throw new ConflictException(
      "This quotation is no longer awaiting a decision. Open the current version.",
    );
}
export function quoteExpired(q: Pick<Quote, "validUntil">, now = new Date()) {
  return Date.parse(q.validUntil + "T23:59:59.999Z") < now.getTime();
}
/** What a client sees and agrees to; changing any of it needs a new revision. */
function snapshotFields(q: Quote) {
  return {
        round: q.round,
        direction: q.direction,
        familyId: q.familyId,
        definitionBaseline: q.definitionBaseline,
        designEvidence: q.designEvidence,
        title: q.title,
        cover: q.cover,
        presentation: q.presentation,
        rooms: q.rooms,
        inclusions: q.inclusions,
        currency: q.currency,
        lines: q.lines.map(({ unitCost, manualReason, ...line }) => line),
        discount: q.discount,
        taxRate: q.taxRate,
        terms: q.terms,
        exclusions: q.exclusions,
        validUntil: q.validUntil,
        total: q.total,
        brand: q.brand,
        // Quotes issued before letterheads (PLM-112) keep their hash.
        ...(q.letterhead === undefined ? {} : { letterhead: q.letterhead }),
        paymentTerms: q.paymentTerms,
        paymentTemplate: q.paymentTemplate,
      };
}

/**
 * Canonical snapshot hash: keys sorted at every level, so a quote reloaded from rows (where key
 * order can differ) still matches what the client approved.
 */
export function freezeHash(q: Quote): string {
  return canonicalHash(snapshotFields(q));
}

/** Hashes issued before canonical hashing used insertion order; they remain valid. */
function legacyFreezeHash(q: Quote): string {
  return createHash("sha256").update(JSON.stringify(snapshotFields(q))).digest("hex");
}

export function matchesQuoteSnapshot(q: Quote) {
  return Boolean(q.hash) && (q.hash === freezeHash(q) || q.hash === legacyFreezeHash(q));
}
export function assertQuoteSnapshot(q: Quote): string {
  if (
    !q.hash ||
    !matchesQuoteSnapshot(q) ||
    moneyOf(totals(q).total, q.currency).cmp(moneyOf(q.total, q.currency)) !== 0
  )
    throw new ConflictException(
      "This quotation no longer matches its issued snapshot. Ask the project team to issue a new revision.",
    );
  return q.hash;
}
export function quoteDecisionEvidence(
  q: Quote,
  decision: QuoteDecisionEvidence["decision"],
  selectedOptionLineIds: unknown,
  decidedBy: string,
  decidedAt: string,
  note = "",
): QuoteDecisionEvidence {
  const quoteHash = assertQuoteSnapshot(q);
  if (!Array.isArray(selectedOptionLineIds) || selectedOptionLineIds.length > 300)
    throw new BadRequestException("Choose valid quotation options.");
  const requested = selectedOptionLineIds.map((id) => text(id, 80, true));
  if (new Set(requested).size !== requested.length)
    throw new BadRequestException("Choose each quotation option once.");
  if (decision !== "accept" && requested.length)
    throw new BadRequestException("Options can only be selected when accepting a quotation.");
  const optionIds = new Set(q.lines.filter((line) => line.optional).map((line) => line.id));
  if (requested.some((id) => !optionIds.has(id)))
    throw new BadRequestException("Choose options from this quotation version only.");
  const accepted = new Set(requested);
  const selected = q.lines
    .filter((line) => line.optional && accepted.has(line.id))
    .map((line) => line.id);
  const selectedTotals = totals({
    ...q,
    lines: q.lines.map((line) =>
      line.optional && accepted.has(line.id) ? { ...line, optional: false } : line,
    ),
  });
  const baseTotal = moneyOf(q.total, q.currency);
  const acceptedTotal = moneyOf(selectedTotals.total, q.currency);
  return {
    decision,
    quoteHash,
    selectedOptionLineIds: selected,
    baseTotal: baseTotal.toNumber(),
    optionsTotal: decision === "accept" ? acceptedTotal.sub(baseTotal).toNumber() : 0,
    ...(decision === "accept" ? { acceptedTotal: acceptedTotal.toNumber() } : {}),
    decidedAt,
    decidedBy,
    ...(note ? { note } : {}),
  };
}
export function acceptedQuoteLines(q: Quote) {
  const selected = new Set(
    q.clientDecision?.decision === "accept"
      ? q.clientDecision.selectedOptionLineIds
      : [],
  );
  return q.lines.filter((line) => !line.optional || selected.has(line.id));
}
export function acceptedQuoteTotals(q: Quote) {
  const selected = new Set(acceptedQuoteLines(q).map((line) => line.id));
  return totals({
    ...q,
    lines: q.lines.map((line) =>
      line.optional && selected.has(line.id) ? { ...line, optional: false } : line,
    ),
  });
}
export function acceptedQuoteValue(q: Quote) {
  return q.clientDecision?.decision === "accept" &&
    q.clientDecision.acceptedTotal !== undefined
    ? q.clientDecision.acceptedTotal
    : q.total;
}
export function clientQuote(q: Quote, grantId: string): ClientQuote {
  const expired = quoteExpired(q);
  return {
    id: q.id,
    number: q.number,
    kind: q.kind,
    direction: q.direction,
    familyId: q.familyId,
    baselineId: q.baselineId,
    definitionBaseline: q.definitionBaseline,
    status: q.status,
    title: q.title,
    cover: q.cover,
    presentation: q.presentation,
    rooms: q.rooms?.map(({ id, name }) => ({ id, name })),
    inclusions: q.inclusions,
    currency: q.currency,
    paymentTerms: q.paymentTerms ?? [],
    paymentTemplate: q.paymentTemplate,
    validUntil: q.validUntil,
    discount: q.discount,
    taxRate: q.taxRate,
    terms: q.terms,
    exclusions: q.exclusions,
    lines: q.lines.map((l) => ({
      id: l.id,
      deductsLineId: l.deductsLineId,
      room: l.room,
      title: l.title,
      specification: l.specification,
      material: quotationMaterialText(l, "material"),
      finish: quotationMaterialText(l, "finish"),
      variantLabel: quotationLineVariant(l),
      customMaterials: l.customMaterials,
      variant: l.variant,
      photo: l.photo,
      dimensions: l.dimensions,
      pricingMode: l.pricingMode,
      materialRows: l.materialRows,
      quantity: l.quantity,
      unit: l.unit,
      rate: l.rate,
      optional: l.optional,
    })),
    createdAt: q.createdAt,
    issuedAt: q.issuedAt,
    decidedAt: q.decidedAt,
    decidedBy: q.decidedBy,
    clientDecision: q.clientDecision,
    hash: q.hash,
    total: q.total,
    brand: q.brand,
    canDecide:
      q.status === "issued" &&
      q.approverId === grantId &&
      !expired,
    expired,
  };
}
export function newRequest(
  data: CommercialData,
  title: string,
  detail: string,
  quoteId?: string,
  structured?: ChangeRequest["decisionRequest"],
  raisedBy?: ChangeRequest["raisedBy"],
): ChangeRequest {
  const request: ChangeRequest = {
    id: randomUUID(),
    number: data.requests.length + 1,
    title,
    detail,
    quoteId,
    status: "open",
    owner: "",
    dueDate: "",
    resolution: "",
    comments: [],
    createdAt: new Date().toISOString(),
    ...(structured ? { decisionRequest: structured } : {}),
    ...(raisedBy?.name ? { raisedBy } : {}),
  };
  data.requests.push(request);
  return request;
}
export function clientChangeRequest(request: ChangeRequest): ClientChangeRequest {
  const projected: ClientChangeRequest = {
    id: request.id,
    number: request.number,
    ...(request.quoteId ? { quoteId: request.quoteId } : {}),
    title: request.title,
    detail: request.detail,
    status: request.status,
    owner: request.owner,
    dueDate: request.dueDate,
    resolution: request.resolution,
    comments: request.comments.filter((comment) => comment.visibility === "client"),
    createdAt: request.createdAt,
  };
  if (request.decisionRequest) {
    const decision = request.decisionRequest.decision;
    projected.decisionRequest = {
      target: { ...request.decisionRequest.target },
      allowedChoices: request.decisionRequest.allowedChoices.map((choice) => ({ ...choice })),
      escalationMinutes: request.decisionRequest.escalationMinutes,
      notificationPolicy: {
        remindersEnabled: request.decisionRequest.notificationPolicy.remindersEnabled,
        channels: [...request.decisionRequest.notificationPolicy.channels],
      },
      decision: decision
        ? {
            responseId: decision.responseId,
            choiceId: decision.choiceId,
            choiceLabel: decision.choiceLabel,
            note: decision.note,
            decidedAt: decision.decidedAt,
            decidedBy: decision.decidedBy,
          }
        : null,
    };
  }
  return projected;
}
export function parseBrand(input: unknown): PortalBrand {
  const b = object(input);
  const primaryColor = text(b.primaryColor, 7, true),
    accentColor = text(b.accentColor, 7, true);
  if (
    !/^#[\da-f]{6}$/i.test(primaryColor) ||
    !/^#[\da-f]{6}$/i.test(accentColor)
  )
    throw new BadRequestException("Choose valid brand colours.");
  const logo = text(b.logo, 450000);
  if (logo && !/^data:image\/(png|jpeg|webp);base64,[a-z\d+/=]+$/i.test(logo))
    throw new BadRequestException("Upload a PNG, JPEG or WebP logo.");
  return {
    name: text(b.name, 100, true),
    logo,
    primaryColor,
    accentColor,
    welcomeTitle: text(b.welcomeTitle, 120, true),
    welcomeText: text(b.welcomeText, 500),
    supportPhone: b.supportPhone ? phone(b.supportPhone) : "",
    layout: b.layout === "minimal" ? "minimal" : "soft",
  };
}

export function parsePaymentTerms(
  input: unknown,
  required = false,
): PaymentTerm[] {
  if (!Array.isArray(input) || input.length > 20 || (required && !input.length))
    throw new BadRequestException("Add between 1 and 20 payment milestones.");
  const rows = input.map((v) => {
    const r = object(v);
    return {
      id: text(r.id, 80, true),
      title: text(r.title, 160, true),
      percent: number(r.percent, 100, 0.01),
      trigger: text(r.trigger, 300, true),
      requiredForRelease: r.requiredForRelease === true,
      requiredForProduction: r.requiredForProduction === true,
    };
  });
  if (new Set(rows.map((r) => r.id)).size !== rows.length)
    throw new BadRequestException("Duplicate payment milestone.");
  if (
    rows.length &&
    Math.abs(rows.reduce((sum, r) => sum + r.percent, 0) - 100) > 0.001
  )
    throw new BadRequestException("Payment milestones must total 100%.");
  if (required && !rows.some((row) => row.requiredForRelease))
    throw new BadRequestException(
      "Choose at least one payment milestone required before project release.",
    );
  return rows;
}

/** The firm's logo on a proposal: an embedded picture, or the tenant's own logo address (never an outside link). */
function companyLogo(value: unknown): string {
  const logo = text(value ?? "", 500000);
  if (!logo || /^\/api\/auth\/tenant-logo\/[a-z0-9-]+\?v=[0-9a-f-]+$/i.test(logo) || /^data:image\/(png|jpeg|webp);base64,[a-z\d+/=]+$/i.test(logo)) return logo;
  throw new BadRequestException("Use the firm's own logo on the proposal.");
}

export function parseCover(input: unknown) {
  const c = object(input);
  const image = (key: string) => {
    const value = text(c[key], 300000);
    if (value && !/^data:image\/(png|jpeg|webp);base64,[a-z\d+/=]+$/i.test(value))
      throw new BadRequestException(`Upload a PNG, JPEG or WebP ${key}.`);
    return value;
  };
  return {
    preparedFor: text(c.preparedFor, 160),
    location: text(c.location, 300),
    subtitle: text(c.subtitle, 500),
    ...(c.coordinates !== undefined
      ? {
          coordinates: {
            latitude: number(object(c.coordinates).latitude, 90, -90),
            longitude: number(object(c.coordinates).longitude, 180, -180),
            ...(object(c.coordinates).accuracy !== undefined
              ? { accuracy: number(object(c.coordinates).accuracy, 100000, 0) }
              : {}),
          },
        }
      : {}),
    ...(c.logo !== undefined ? { logo: image('logo') } : {}),
    ...(c.banner !== undefined ? { banner: image('banner') } : {}),
    ...(c.signature !== undefined ? { signature: image('signature') } : {}),
    ...(c.signerName !== undefined ? { signerName: text(c.signerName, 160) } : {}),
    ...(c.signerTitle !== undefined ? { signerTitle: text(c.signerTitle, 160) } : {}),
    ...(c.clientSignature !== undefined ? { clientSignature: c.clientSignature === true } : {}),
    ...(c.taxLabel !== undefined ? { taxLabel: text(c.taxLabel, 40) } : {}),
    ...(c.taxRegistration !== undefined ? { taxRegistration: text(c.taxRegistration, 120) } : {}),
  };
}

const canvasHex = (value: unknown, fallback: string) => {
  if (value === undefined || value === null || value === "") return fallback;
  const result = text(value, 7, true);
  if (!/^#[\da-f]{6}$/i.test(result))
    throw new BadRequestException("Choose a valid document colour.");
  return result;
};

/** Keep visual freedom bounded, portable and safe for deterministic PDF output. */
export function parseQuotePresentation(input: unknown): QuotePresentation {
  const value = object(input);
  if (value.version !== 1)
    throw new BadRequestException("Use the current quotation page format.");
  if (!Array.isArray(value.pages) || value.pages.length > 40)
    throw new BadRequestException("Use up to 40 quotation pages.");
  let imageBytes = 0;
  const image = (candidate: unknown) => {
    const source = text(candidate ?? "", 500000);
    if (source && !/^data:image\/(png|jpeg|webp);base64,[a-z\d+/=]+$/i.test(source))
      throw new BadRequestException("Upload a PNG, JPEG or WebP quotation image.");
    imageBytes += source.length;
    if (imageBytes > 1_500_000)
      throw new BadRequestException("Quotation page images are too large together.");
    return source;
  };
  const position = (candidate: unknown, max = 2000) => number(candidate, max);
  const pages = value.pages.map((candidate) => {
    const page = object(candidate);
    if (!Array.isArray(page.elements) || page.elements.length > 100)
      throw new BadRequestException("Use up to 100 elements on each quotation page.");
    const elements = page.elements.map((candidateElement) => {
      const element = object(candidateElement);
      if (element.type !== "text" && element.type !== "image")
        throw new BadRequestException("Choose a text or image page element.");
      const common = {
        id: text(element.id, 80, true),
        type: element.type,
        x: position(element.x),
        y: position(element.y),
        width: number(element.width, 2000, 24),
        height: number(element.height, 2000, 24),
      } as const;
      return element.type === "text"
        ? {
            ...common,
            type: "text" as const,
            text: text(element.text ?? "", 4000),
            ...(element.richText !== undefined ? { richText: parseQuotationRichText(element.richText) } : {}),
            color: canvasHex(element.color, "#000000"),
            fontSize: number(element.fontSize ?? 24, 96, 8),
            align: (element.align === "center" || element.align === "right"
              ? element.align
              : "left") as "left" | "center" | "right",
          }
        : { ...common, type: "image" as const, src: image(element.src) };
    });
    if (new Set(elements.map((element) => element.id)).size !== elements.length)
      throw new BadRequestException("Give every page element a unique ID.");
    return {
      id: text(page.id, 160, true),
      ...(page.kind === "custom" ? { kind: "custom" as const } : {}),
      ...(page.title !== undefined ? { title: text(page.title, 160) } : {}),
      ...(page.background !== undefined ? { background: canvasHex(page.background, "#ffffff") } : {}),
      ...(page.backgroundImage !== undefined ? { backgroundImage: image(page.backgroundImage) } : {}),
      elements,
    };
  });
  if (new Set(pages.map((page) => page.id)).size !== pages.length)
    throw new BadRequestException("Give every quotation page a unique ID.");
  let pageOrder: string[] | undefined;
  if (value.pageOrder !== undefined) {
    const allowed = new Set(["cover", "scope", "summary", "payments", "terms", "acceptance", ...pages.filter(page => page.kind === "custom").map(page => page.id)]);
    if (!Array.isArray(value.pageOrder) || !value.pageOrder.length || value.pageOrder.length > 40 ||
      value.pageOrder.some(id => typeof id !== "string" || !allowed.has(id)) ||
      new Set(value.pageOrder).size !== value.pageOrder.length || !value.pageOrder.includes("scope"))
      throw new BadRequestException("Choose unique quotation pages and keep the scope section.");
    pageOrder = value.pageOrder as string[];
  }
  let hiddenPages: string[] | undefined;
  if (value.hiddenPages !== undefined) {
    const allowed = new Set(["cover","scope","summary","payments","terms","acceptance",...pages.map(page=>page.id)]);
    if (!Array.isArray(value.hiddenPages) || value.hiddenPages.length>40 || value.hiddenPages.some(id=>typeof id!=="string" || !allowed.has(id))) throw new BadRequestException("Choose valid pages to hide.");
    hiddenPages=[...new Set(value.hiddenPages as string[])];
  }
  let scopeColumns: QuotePresentation["scopeColumns"];
  if (value.scopeColumns !== undefined) {
    const config = object(value.scopeColumns);
    const allowed = ['index','image','item','description','dimensions','quantity','unit','rate','amount','actions'];
    if (!Array.isArray(config.hidden) || config.hidden.some(id => !allowed.includes(String(id))) || !Array.isArray(config.custom) || config.custom.length > 20)
      throw new BadRequestException("Use valid columns and up to 20 custom columns.");
    const custom = config.custom.map(raw => {
      const column = object(raw), values = object(column.values);
      if (Object.keys(values).length > 300) throw new BadRequestException("Use up to 300 custom cells per column.");
      return { id: text(column.id, 80, true), name: text(column.name, 80, true), values: Object.fromEntries(Object.entries(values).map(([id, content]) => [text(id, 80, true), text(content, 2000)])) };
    });
    if (new Set(custom.map(column => column.id)).size !== custom.length) throw new BadRequestException("Use unique column IDs.");
    scopeColumns = { hidden: [...new Set(config.hidden as string[])], custom };
  }
  return {
    version: 1,
    ...(value.template === 'palm-reference-v1' ? {template: 'palm-reference-v1' as const} : {}),
    ...(value.details !== undefined ? {details: Object.fromEntries(Object.entries(object(value.details)).filter(([key]) => ['companyName','clientName','clientPhone','clientEmail','projectName','location','reference','date','preparedBy','estimator','manager','clientLogo','companyLogo'].includes(key)).map(([key, content]) => [key, key === 'clientLogo' ? image(content) : key === 'companyLogo' ? companyLogo(content) : text(content, 500)]))} : {}),
    ...(pageOrder ? { pageOrder } : {}),
    ...(hiddenPages ? { hiddenPages } : {}),
    ...(scopeColumns ? { scopeColumns } : {}),
    pageBackground: canvasHex(value.pageBackground, "#E4E3DE"),
    textColor: canvasHex(value.textColor, "#000000"),
    accentColor: canvasHex(value.accentColor, "#000000"),
    pages,
  };
}
