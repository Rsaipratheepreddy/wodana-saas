import { createHash } from "node:crypto";
import { Dec } from "../catalog-core/decimal";

/**
 * PLM-082/084: the QS prices a quotation before it reaches the client. The QS owns the price fields of every line;
 * everyone else may describe and count, but the rate, cost, markup and build-up are the QS's. A confirmation
 * covers the exact pricing it saw: any later change to a priced field or to the lines makes it stale.
 */
export const QS_FIELDS = ["rate", "unitCost", "markupPercent", "pricingMode", "components"] as const;

export type PricedLine = {
  id: string; kind: string; quantity: string; rate: string; unitCost: string | null; markupPercent: string | null; pricingMode: string;
  optional: boolean | null; components?: Array<{ name: string; quantity: string; unitCost: string | null; rate: string | null }>;
};

const norm = (value: string | null | undefined) => (value === null || value === undefined || value === "" ? null : Dec.of(value).toString());

/** The fingerprint of what the QS confirms: every line's quantity, rate, cost, markup and build-up. */
export function pricingHash(lines: PricedLine[]) {
  const canonical = [...lines].sort((left, right) => left.id.localeCompare(right.id)).map((line) => ({
    id: line.id, kind: line.kind, quantity: norm(line.quantity), rate: norm(line.rate), unitCost: norm(line.unitCost), markup: norm(line.markupPercent),
    mode: line.pricingMode, optional: Boolean(line.optional),
    parts: (line.components ?? []).map((part) => [part.name, norm(part.quantity), norm(part.unitCost), norm(part.rate)]),
  }));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

/** Which QS-held fields a line change touches (a catalog pick fills them from the catalog and is allowed). */
export function touchesQsFields(fields: Record<string, unknown>) {
  return QS_FIELDS.filter((field) => Object.prototype.hasOwnProperty.call(fields, field));
}

export type QsReviewState = {
  id: string; status: "with_qs" | "confirmed" | "returned"; assigneeUserId: string; assigneeName: string | null;
  requestedBy: string; requestedByName: string | null; requestedAt: string; note: string;
  decidedBy: string | null; decidedByName: string | null; decidedAt: string | null; decisionNote: string; pricingHash: string | null; version: number;
};

/** Where the QS step stands for a quote: not needed, with the QS, confirmed and current, or stale/returned (to send again). */
export function qsStage(required: boolean, review: Pick<QsReviewState, "status" | "pricingHash"> | null, currentHash: string) {
  if (!required) return "not_required" as const;
  if (!review) return "to_send" as const;
  if (review.status === "with_qs") return "with_qs" as const;
  if (review.status === "returned") return "returned" as const;
  return review.pricingHash === currentHash ? ("confirmed" as const) : ("stale" as const);
}
