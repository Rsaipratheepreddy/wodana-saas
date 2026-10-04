import { tKey, type MessageKey } from "@/lib/i18n/keys";
import { CrmRequestError, type MissingRequirement } from "./client";

/** PLM-121/122: the step-by-step pipeline, as the opportunity detail returns it. */
export type OpportunityFlowCode = "furniture" | "design" | "fit_out" | "basic";
export type FlowStepState = "done" | "current" | "upcoming";
export type FurniturePath = "take_home_now" | "in_stock_delivery" | "supplier_order" | "core_collection_factory" | "bespoke";
export type PaymentProof = { id: string; kind: string; fileName: string; mimeType: string; hasPreview: boolean; note: string | null; recordedAt: string; recordedBy: string | null };
/** One step of the job's line, as the flow reads it from the records. */
export type FlowLineStep = {
  key: string; name: string; check: string; column: string; optional: boolean;
  state: "done" | "current" | "upcoming" | "skipped"; doneAt: string | null; doneBy: string | null;
  missing: Array<{ key: string; label: string }>;
};
export type OpportunityFlowView = {
  flow: OpportunityFlowCode;
  steps: Array<{ stageId: string; name: string; step: string | null; state: FlowStepState; optional: boolean }>;
  done: number;
  total: number;
  next: { stageId: string; name: string; step: string } | null;
  missing: MissingRequirement[];
  toWon: MissingRequirement[];
  negotiationOptional: boolean;
  enquiryType: string | null;
  furniture: { path: FurniturePath | null; feasibility: { at: string; by: string | null } | null; materialsChange: boolean } | null;
  clientApproval: { at: string; by: string | null } | null;
  quotationExists: boolean;
  paymentVerified: boolean;
  proofs: PaymentProof[];
  /** The job's line (each step done or not); absent from older responses. */
  line?: FlowLineStep[];
};

export const FLOW_CHOICES: Array<{ id: OpportunityFlowCode; label: MessageKey }> = [
  { id: "design", label: tKey("Design") },
  { id: "fit_out", label: tKey("Fit-out") },
  { id: "furniture", label: tKey("Furniture") },
  { id: "basic", label: tKey("Basic") },
];

/** A flow suggested from an enquiry type's name; the administrator confirms it. */
export function suggestedFlow(text: string): OpportunityFlowCode {
  const value = text.toLowerCase();
  if (/furniture/.test(value) && !/design/.test(value)) return "furniture";
  if (/design|concept/.test(value)) return "design";
  if (/fit[\s_-]?out|renovation|joinery/.test(value)) return "fit_out";
  return "basic";
}

export const FURNITURE_PATHS: Array<{ id: FurniturePath; letter: string; label: MessageKey; description: MessageKey; lead: MessageKey }> = [
  { id: "take_home_now", letter: "A", label: tKey("Take home now"), description: tKey("From the showroom floor, leaves with the client"), lead: tKey("Same day") },
  { id: "in_stock_delivery", letter: "B", label: tKey("In-stock delivery"), description: tKey("In stock, delivered to the client"), lead: tKey("Days") },
  { id: "supplier_order", letter: "C", label: tKey("Supplier order"), description: tKey("Ordered from a supplier for this client"), lead: tKey("Weeks") },
  { id: "core_collection_factory", letter: "D", label: tKey("Core collection"), description: tKey("Made in the factory from the core collection"), lead: tKey("Made to order") },
  { id: "bespoke", letter: "E", label: tKey("Bespoke"), description: tKey("Designed for the client; the factory confirms feasibility"), lead: tKey("Made to order") },
];

export const PROOF_KINDS: Array<{ id: string; label: MessageKey }> = [
  { id: "receipt", label: tKey("Receipt") },
  { id: "card_slip", label: tKey("Card slip") },
  { id: "bank_transfer", label: tKey("Bank transfer") },
  { id: "cash_sheet", label: tKey("Cash sheet") },
  { id: "photo", label: tKey("Photo") },
  { id: "other", label: tKey("Other") },
];

/** The requirement → step mapping lives in one place. */
export { requirementAction, type RequirementTarget } from "./now-step";

/** The requirement labels the server sends, kept here so they are translated. */
export const REQUIREMENT_LABELS: MessageKey[] = [
  tKey("Enquiry type chosen"), tKey("Payment proof attached"), tKey("Client email"), tKey("Property location"), tKey("Floor plan or area"),
  tKey("Intro meeting completed"), tKey("Client type chosen (not TBC)"), tKey("Furniture sub-path chosen"),
  tKey("Feasibility confirmed by Factory/Technical"), tKey("Quotation prepared"), tKey("Floor plan"), tKey("Area"), tKey("Client type"),
  tKey("Number of spaces"), tKey("Value"), tKey("Expected close date"), tKey("Next follow-up"), tKey("Sales owner"), tKey("Stakeholders"),
];

/** The requirements a refused move lists, or none when the error is something else. */
export function missingFrom(error: unknown): MissingRequirement[] {
  return error instanceof CrmRequestError && error.status === 422 ? error.missing : [];
}

/** Attach a payment proof: the opportunity becomes Won in the same step. */
export async function attachPaymentProof(workspaceId: string, opportunityId: string, input: { version: number; kind: string; note: string; file: File }) {
  const body = new FormData();
  body.set("version", String(input.version));
  body.set("kind", input.kind);
  if (input.note.trim()) body.set("note", input.note.trim());
  body.set("file", input.file);
  const response = await fetch(`/api/workspace/crm/opportunity-proofs/${opportunityId}?workspaceId=${encodeURIComponent(workspaceId)}`, { method: "POST", body });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new CrmRequestError(result?.message ?? tKey("The payment proof could not be attached."), response.status, Array.isArray(result?.missing) ? result.missing : []);
  return result as { opportunity: Record<string, unknown>; proof: PaymentProof };
}

export function proofHref(workspaceId: string, opportunityId: string, proofId: string) {
  return `/api/workspace/crm/opportunity-proofs/${opportunityId}/${proofId}?workspaceId=${encodeURIComponent(workspaceId)}`;
}
