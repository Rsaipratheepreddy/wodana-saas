import type {
  AccountView, CompanySummary, LedgerSettingsView, PaymentAccountView, RegionOption, RoleView, TaxCodeView, TemplateOption,
} from "../../../../services/business-core/src/books/settings/books-settings";
import type { ManualJournalRow, ManualLineView } from "../../../../services/business-core/src/books/journals/manual-journal-store";
import type { OpeningPreview } from "../../../../services/business-core/src/books/journals/manual-journals";
import type { ApprovalStatus } from "../../../../services/business-core/src/approvals/approval-policy";

/**
 * The Ledger's settings and manual-journal API for one workspace (plan §6.21b, slice A2). Every command carries a
 * fresh command id, so a retried request changes nothing twice; the server checks the version it names.
 */

export type { AccountView, CompanySummary, LedgerSettingsView, ManualJournalRow, ManualLineView, OpeningPreview, PaymentAccountView, RegionOption, RoleView, TaxCodeView, TemplateOption };

export type LedgerOverview = { companies: CompanySummary[]; canManage: boolean };
export type JournalDetail = {
  journal: ManualJournalRow; lines: ManualLineView[]; approval: ApprovalStatus | null;
  canEdit: boolean; canSubmit: boolean; canApprove: boolean; canCancel: boolean;
};
export type JournalList = { journals: ManualJournalRow[]; canPost: boolean; me: string };
export type JournalOptions = {
  company: { id: string; name: string; currency: string; decimals: number };
  settings: { enabled: boolean; startDate: string; lockDate: string | null } | null;
  accounts: Array<{ id: string; code: string; name: string; type: string; isControl: boolean; allowManual: boolean }>;
  projects: Array<{ id: string; name: string }>;
  parties: Array<{ type: "client" | "vendor" | "employee" | "team"; id: string; name: string }>;
};
export type JournalLineDraft = {
  accountId: string; debit: string; credit: string; description: string; projectId: string | null; party: { type: string; id: string } | null;
};

export class BooksRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function request<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new BooksRequestError(typeof data?.message === "string" ? data.message : "Could not save.", response.status);
  return data as T;
}

const commandId = () => crypto.randomUUID();
export const newId = commandId;

export function booksSettingsApi(workspaceId: string) {
  const at = (path = "") => `/api/books/settings${path}?${new URLSearchParams({ workspaceId })}`;
  return {
    overview: () => request<LedgerOverview>(at()),
    company: (legalEntityId: string) => request<LedgerSettingsView>(at(`/${legalEntityId}`)),
    /** One settings command for a company; returns its settings after it. */
    command: (legalEntityId: string, action: string, input: Record<string, unknown> = {}) =>
      request<LedgerSettingsView>(at(), "POST", { ...input, action, legalEntityId, commandId: commandId() }),
  };
}
export type BooksSettingsApi = ReturnType<typeof booksSettingsApi>;

export function manualJournalsApi(workspaceId: string) {
  const at = (path = "", query: Record<string, string> = {}) => `/api/books/manual-journals${path}?${new URLSearchParams({ workspaceId, ...query })}`;
  return {
    list: (legalEntityId?: string) => request<JournalList>(at("", legalEntityId ? { legalEntityId } : {})),
    detail: (id: string) => request<JournalDetail>(at(`/${id}`)),
    options: (legalEntityId: string) => request<JournalOptions>(at("/options", { legalEntityId })),
    previewOpening: (legalEntityId: string, csv: string) => request<OpeningPreview>(at("/opening-preview"), "POST", { legalEntityId, csv }),
    /** One journal command (save, submit, approve, return, cancel, import_opening); returns the journal after it. */
    command: (id: string, action: string, input: Record<string, unknown> = {}) => request<JournalDetail>(at(), "POST", { ...input, action, id, commandId: commandId() }),
  };
}
export type ManualJournalsApi = ReturnType<typeof manualJournalsApi>;
