import { caseRequest } from "@/lib/pre-project/content";

/**
 * PLM-147: value engineering on a job's estimate, as the API returns it. The lead designer leads it with the QS; the
 * Account Manager is copied. Money is decimal strings; moments are ISO strings.
 */
export type ValueEngineeringStep = "agree_options" | "present_options" | "client_decision" | "closed";
export type ValueEngineeringRound = {
  id: string; round: number; chargeable: boolean; origin: "automatic" | "manual"; status: "open" | "closed"; step: ValueEngineeringStep;
  outcome: "new_version" | "kept_price" | "withdrawn" | null; quoteId: string; familyId: string; quoteName: string; outcomeQuoteId: string | null; outcomeQuoteName: string | null;
  currency: string; quotedTotal: string; budgetAmount: string | null; overBy: string | null; note: string;
  lead: { membershipId: string | null; name: string; fallback: boolean }; qsName: string; startedByName: string; startedAt: string;
  optionsNote: string | null; optionsAgreedAt: string | null; optionsAgreedByName: string;
  meeting: { activityId: string; startsAt: string | null; endsAt: string | null; timezone: string | null; address: string | null; minutes: boolean } | null;
  outcomeNote: string | null; closedAt: string | null; idleSince: string; version: number;
};
export type ValueEngineeringView = {
  timezone: string;
  /** The client's budget as recorded on the brief now. */
  budget: { amount: string; currency: string } | null;
  freeRounds: number | null;
  designWork: boolean;
  rounds: ValueEngineeringRound[];
  open: ValueEngineeringRound | null;
  /** The estimate asked about: its price against the budget, and why a round can't start on it. */
  quote: { id: string; total: string; currency: string; overBy: string | null; problem: string | null } | null;
  can: { start: boolean; lead: boolean; decide: boolean; withdraw: boolean };
};

export function valueEngineeringApi(workspaceId: string, caseId: string) {
  const post = (path: string, body: Record<string, unknown>) => caseRequest<ValueEngineeringView>(workspaceId, caseId, `value-engineering/${path}`, "POST", body);
  return {
    view: (quoteId?: string | null) => caseRequest<ValueEngineeringView>(workspaceId, caseId, quoteId ? `value-engineering?quote=${encodeURIComponent(quoteId)}` : "value-engineering"),
    start: (quoteId: string, note: string) => post("start", { quoteId, note: note || null }),
    agree: (round: Pick<ValueEngineeringRound, "id" | "version">, note: string) => post(`${round.id}/options`, { version: round.version, note }),
    meeting: (round: Pick<ValueEngineeringRound, "id" | "version">, value: { startsAt: string; endsAt: string; timezone: string; address: string | null }) => post(`${round.id}/meeting`, { version: round.version, ...value }),
    keepPrice: (round: Pick<ValueEngineeringRound, "id" | "version">, note: string) => post(`${round.id}/keep-price`, { version: round.version, note: note || null }),
    withdraw: (round: Pick<ValueEngineeringRound, "id" | "version">, note: string) => post(`${round.id}/withdraw`, { version: round.version, note }),
  };
}
