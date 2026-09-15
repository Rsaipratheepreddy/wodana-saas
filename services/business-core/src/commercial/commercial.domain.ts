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
  ChangeRequest,
  PaymentTerm,
} from "./commercial.types";
export const emptyCommercial = (): CommercialData => ({
  revision: 0,
  quotes: [],
  requests: [],
  agreement: null,
  payments: [],
  audit: [],
  ownerReview: null,
  dealFile: null,
  materialApprovals: [],
  release: null,
});
export const defaultBrand = (name: string): PortalBrand => ({
  name,
  logo: "",
  primaryColor: "#76538f",
  accentColor: "#e99a72",
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
export const round = (n: number) =>
  Math.round((n + Number.EPSILON) * 100) / 100;
export function totals(q: Pick<Quote, "lines" | "discount" | "taxRate">) {
  const subtotal = round(
    q.lines.reduce((s, l) => s + round(l.quantity * l.rate), 0),
  );
  const cost = round(
    q.lines.reduce((s, l) => s + round(l.quantity * (l.unitCost ?? 0)), 0),
  );
  const discount = round(q.discount);
  if (discount > subtotal)
    throw new BadRequestException("Discount cannot exceed the subtotal.");
  const net = round(subtotal - discount);
  const tax = round((net * q.taxRate) / 100);
  return {
    subtotal,
    cost,
    discount,
    net,
    tax,
    total: round(net + tax),
    margin: net ? round(((net - cost) / net) * 100) : 0,
  };
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
    if (l.variant !== undefined) line.variant = text(l.variant, 240);
    if (l.photo !== undefined) {
      line.photo = text(l.photo, 60000);
      if (line.photo && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(line.photo))
        throw new BadRequestException("Use a PNG, JPEG or WebP quotation photo.");
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
export function freezeHash(q: Quote): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        direction: q.direction,
        familyId: q.familyId,
        title: q.title,
        cover: q.cover,
        rooms: q.rooms,
        inclusions: q.inclusions,
        currency: q.currency,
        lines: q.lines.map(({ unitCost, ...line }) => line),
        discount: q.discount,
        taxRate: q.taxRate,
        terms: q.terms,
        exclusions: q.exclusions,
        validUntil: q.validUntil,
        total: q.total,
        brand: q.brand,
        paymentTerms: q.paymentTerms,
        paymentTemplate: q.paymentTemplate,
      }),
    )
    .digest("hex");
}
export function clientQuote(q: Quote, grantId: string): ClientQuote {
  return {
    id: q.id,
    number: q.number,
    kind: q.kind,
    direction: q.direction,
    familyId: q.familyId,
    baselineId: q.baselineId,
    status: q.status,
    title: q.title,
    cover: q.cover,
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
      pricingMode: l.pricingMode,
      materialRows: l.materialRows,
      quantity: l.quantity,
      unit: l.unit,
      rate: l.rate,
    })),
    createdAt: q.createdAt,
    issuedAt: q.issuedAt,
    decidedAt: q.decidedAt,
    decidedBy: q.decidedBy,
    hash: q.hash,
    total: q.total,
    brand: q.brand,
    canDecide:
      q.status === "issued" &&
      q.approverId === grantId &&
      Date.parse(q.validUntil + "T23:59:59.999Z") >= Date.now(),
  };
}
export function newRequest(
  data: CommercialData,
  title: string,
  detail: string,
  quoteId?: string,
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
  };
  data.requests.push(request);
  return request;
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
    };
  });
  if (new Set(rows.map((r) => r.id)).size !== rows.length)
    throw new BadRequestException("Duplicate payment milestone.");
  if (
    rows.length &&
    Math.abs(rows.reduce((sum, r) => sum + r.percent, 0) - 100) > 0.001
  )
    throw new BadRequestException("Payment milestones must total 100%.");
  return rows;
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
