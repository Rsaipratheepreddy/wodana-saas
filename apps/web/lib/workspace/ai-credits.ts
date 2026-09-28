import { tKey, type MessageKey } from "@/lib/i18n/keys";

/** Credits are decimal strings (numeric(14,4) in the database); 1 credit is US$0.001 of AI model use. */
export type CreditEntryType = "grant" | "top_up" | "usage" | "adjustment" | "refund";
export type CreditState = "ok" | "low" | "exhausted";

export type CreditLedgerEntry = {
  id: string;
  entryType: CreditEntryType;
  credits: string;
  balanceAfter: string;
  model: string | null;
  feature: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  reference: string | null;
  note: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
};

export type CreditOverview = {
  workspaceId: string;
  balance: string;
  state: CreditState;
  threshold: string;
  customThreshold: string | null;
  version: number;
  lastTopUp: { credits: string | null; at: string } | null;
  usedThisMonth: string;
  byFeature: Array<{ feature: string; credits: string; calls: number }>;
  usedToday: string;
  dailyLimit: string;
  ledger: CreditLedgerEntry[];
};

export const ENTRY_LABELS: Record<CreditEntryType, MessageKey> = {
  grant: tKey("Welcome credits"),
  top_up: tKey("Top-up"),
  usage: tKey("AI use"),
  adjustment: tKey("Adjustment"),
  refund: tKey("Refund"),
};

/** Where AI was used, by the gateway's feature code. */
const FEATURE_LABELS: Record<string, MessageKey> = {
  "crm.chat": tKey("Woddy chat"),
  "crm.assist": tKey("Enquiry review"),
  "commercial.assist": tKey("Quotation assistant"),
  "quotation.plan": tKey("Quotation plan"),
  "quotation.draft": tKey("Quote draft"),
  "quotation.edit": tKey("Quote changes"),
  "catalog.import_clean": tKey("Catalog import"),
  "catalog.suggest_components": tKey("Catalog components"),
};
export const featureLabel = (feature: string): MessageKey => FEATURE_LABELS[feature] ?? tKey("Other AI");

/** A credit amount in the reader's locale, exact from its decimal string (never through a float). */
export function formatCredits(value: string | null | undefined, locale: string, maximumFractionDigits = 2) {
  if (value === null || value === undefined || !/^-?\d+(\.\d+)?$/.test(value)) return "—";
  return new Intl.NumberFormat(locale, { maximumFractionDigits, minimumFractionDigits: 0 }).format(value as Intl.StringNumericLiteral);
}

export class AiCreditsRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function readAiCredits(workspaceId: string): Promise<CreditOverview> {
  const response = await fetch(`/api/workspace/ai-credits?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" });
  const data = await response.json().catch(() => null) as (CreditOverview & { message?: string }) | null;
  if (!response.ok || !data) throw new AiCreditsRequestError(typeof data?.message === "string" ? data.message : tKey("AI credits didn't load."), response.status);
  return data;
}
