import type { SalesFormConfiguration } from "@/lib/sales/contact-form";
import { ConsoleRequestError } from "./console";

/** Sales enquiries from Wodana's public "Contact sales" form, as Wodana Control reads them. */
export const SALES_ENQUIRY_STATUSES = ["new", "contacted", "qualified", "won", "lost"] as const;
export type SalesEnquiryStatus = typeof SALES_ENQUIRY_STATUSES[number];

export type SalesEnquirySummary = {
  id: string;
  reference: string;
  name: string;
  email: string;
  company: string | null;
  countryCode: string | null;
  phone: string | null;
  teamSize: string | null;
  status: SalesEnquiryStatus;
  assignee: { userId: string; name: string | null } | null;
  source: string;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type SalesEnquiryList = {
  enquiries: SalesEnquirySummary[];
  counts: Partial<Record<SalesEnquiryStatus, number>>;
  total: number;
  observedAt: string;
};

export type SalesEnquiryHistoryEvent = {
  id: string;
  action: "received" | "status_changed" | "assigned" | "note_added" | string;
  actorName: string | null;
  details: { from?: string | null; to?: string | null; reason?: string | null; reopened?: boolean; fromName?: string | null; toName?: string | null; reference?: string; source?: string };
  createdAt: string;
};

export type SalesEnquiryDetail = SalesEnquirySummary & {
  message: string | null;
  teamSizeId: string | null;
  consentText: string;
  consentedAt: string;
  pagePath: string | null;
  referrer: string | null;
  utm: { source: string | null; medium: string | null; campaign: string | null; term: string | null; content: string | null };
  locale: string | null;
  formVersion: number;
  contactedAt: string | null;
  qualifiedAt: string | null;
  closedAt: string | null;
  nextStatuses: SalesEnquiryStatus[];
  notes: Array<{ id: string; body: string; authorName: string | null; createdAt: string }>;
  history: SalesEnquiryHistoryEvent[];
  notices: Array<{ id: string; recipient: string; status: "pending" | "sent" | "failed" | "not_configured"; lastAttemptedAt: string | null }>;
};

export type SalesAssignee = { userId: string; name: string; email: string };

export type SalesContactFormSettings = {
  version: number;
  configuration: SalesFormConfiguration;
  history: Array<{ version: number; createdAt: string; createdByName: string | null }>;
};

async function request<T>(path: string, init?: RequestInit & { idempotencyKey?: string }): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body) headers.set("content-type", "application/json");
  if (init?.idempotencyKey) headers.set("idempotency-key", init.idempotencyKey);
  const response = await fetch(path, { ...init, headers, cache: "no-store" });
  const data = await response.json().catch(() => null) as (T & { message?: string }) | null;
  if (!response.ok) throw new ConsoleRequestError(typeof data?.message === "string" ? data.message : "", response.status);
  return data as T;
}

const post = <T>(path: string, body: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body) });

/** The export link for the current filter (a same-origin CSV download). */
export function salesEnquiriesExportUrl(filter: { status?: SalesEnquiryStatus | "all"; search?: string }) {
  const query = new URLSearchParams();
  if (filter.status && filter.status !== "all") query.set("status", filter.status);
  if (filter.search?.trim()) query.set("search", filter.search.trim().slice(0, 160));
  const suffix = query.toString();
  return `/api/internal/sales-enquiries/export${suffix ? `?${suffix}` : ""}`;
}

/** Wodana Control's sales calls, all through same-origin internal routes that add the operator session. */
export const salesApi = {
  enquiries: () => request<SalesEnquiryList>("/api/internal/sales-enquiries"),
  enquiry: (id: string) => request<SalesEnquiryDetail>(`/api/internal/sales-enquiries/${id}`),
  assignees: () => request<{ assignees: SalesAssignee[] }>("/api/internal/sales-enquiries/assignees"),
  changeStatus: (id: string, body: { expectedVersion: number; status: SalesEnquiryStatus; reason?: string }) =>
    post<SalesEnquiryDetail>(`/api/internal/sales-enquiries/${id}/status`, body),
  assign: (id: string, body: { expectedVersion: number; assigneeUserId: string | null }) =>
    post<SalesEnquiryDetail>(`/api/internal/sales-enquiries/${id}/assignee`, body),
  addNote: (id: string, body: { noteId: string; body: string }) =>
    post<SalesEnquiryDetail>(`/api/internal/sales-enquiries/${id}/notes`, body),
  form: () => request<SalesContactFormSettings>("/api/internal/sales-contact-form"),
  saveForm: (body: { expectedVersion: number; configuration: SalesFormConfiguration }, idempotencyKey: string) =>
    request<SalesContactFormSettings>("/api/internal/sales-contact-form", { method: "PUT", body: JSON.stringify(body), idempotencyKey }),
};
