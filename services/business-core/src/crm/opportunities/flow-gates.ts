/**
 * PLM-121 / PLM-122: the vocabulary the sales flows share — the starter flow codes, the furniture sub-paths and the
 * kinds of payment proof. What each step needs is no longer coded here: it comes from the job's flow definition
 * (src/crm/flows), read by the interpreter. The r30 gates live on only as the oracle of the equivalence tests.
 */
export const OPPORTUNITY_FLOWS = ["furniture", "design", "fit_out", "basic"] as const;
export type OpportunityFlow = (typeof OPPORTUNITY_FLOWS)[number];

export const FURNITURE_PATHS = ["take_home_now", "in_stock_delivery", "supplier_order", "core_collection_factory", "bespoke"] as const;
export type FurniturePath = (typeof FURNITURE_PATHS)[number];

/** What a payment proof is (PLM-122): a receipt, a card slip, a transfer, a cash sheet or a photo. */
export const PAYMENT_PROOF_KINDS = ["receipt", "card_slip", "bank_transfer", "cash_sheet", "photo", "other"] as const;
export type PaymentProofKind = (typeof PAYMENT_PROOF_KINDS)[number];

/** An unset or unknown flow is the basic one. */
export function flowOf(value: unknown): OpportunityFlow {
  return OPPORTUNITY_FLOWS.includes(value as OpportunityFlow) ? value as OpportunityFlow : "basic";
}

/** A suggested flow for an enquiry type from its code or label; the administrator confirms it in Settings. */
export function suggestedFlow(text: string): OpportunityFlow {
  const value = text.toLowerCase();
  if (/furniture/.test(value) && !/design/.test(value)) return "furniture";
  if (/design|concept/.test(value)) return "design";
  if (/fit[\s_-]?out|renovation|joinery/.test(value)) return "fit_out";
  return "basic";
}

/** A client type is decided once it is set and not a placeholder such as TBC. */
export function clientTypeDecided(value: string | null | undefined) {
  const code = value?.trim().toLowerCase() ?? "";
  return Boolean(code) && !["tbc", "not_sure", "unknown", "to_be_confirmed"].includes(code);
}
