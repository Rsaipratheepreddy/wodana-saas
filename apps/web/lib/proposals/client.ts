/** R3: how a firm shows its markup to the client. */
export type MarkupDisclosure = "all_inclusive" | "disclosed_markup" | "fee_based";

export type ClientLine = {
  id: string; title: string; quantity: string; unit: string; rate: string; amount: string; optional: boolean;
  cost: string | null; markupPercent: string | null; markupAmount: string | null;
};
export type ClientSummaryRow = { key: "Cost of items" | "Markup" | "Items at cost" | "Our fee" | "Subtotal" | "Discount" | "Tax" | "Total"; amount: string; rate?: string };
export type ClientPresentation = { mode: MarkupDisclosure; lines: ClientLine[]; summary: ClientSummaryRow[] };

export type TemplatePage = { slot: 1 | 2 | 3 | 5; fileName: string; mimeType: string; byteSize: number; sha256: string; pageCount: number; createdAt: string };
export type ProposalTemplate = { version: number; pages: TemplatePage[]; canManage: boolean };

export type DocumentVersion = { number: number; purpose: "upload" | "issued" | "signed"; fileName: string; mimeType: string; byteSize: number; sha256: string; note: string; createdAt: string; createdByName: string | null };
export type SigningRequest = { id: string; status: "pending" | "signed" | "revoked"; state: "open" | "signed" | "revoked" | "expired"; signerName: string; documentVersion: number;
  expiresAt: string; signedAt: string | null; signedDocumentVersion: number | null; version: number };
export type DocumentCard = {
  id: string; kind: "proposal" | "external_quotation"; title: string; reference: string | null; amount: string | null; currency: string | null; quoteId: string | null;
  currentVersion: number; version: number; createdAt: string; versions: DocumentVersion[]; signing: SigningRequest[];
};

export type QsStage = "not_required" | "to_send" | "with_qs" | "confirmed" | "stale" | "returned";
export type QsState = {
  required: boolean; stage: QsStage; reference: string | null; canSend: boolean; canDecide: boolean;
  review: null | { id: string; status: "with_qs" | "confirmed" | "returned"; assigneeUserId: string; assigneeName: string | null; requestedBy: string; requestedByName: string | null;
    requestedAt: string; note: string; decidedBy: string | null; decidedByName: string | null; decidedAt: string | null; decisionNote: string; version: number };
  people: Array<{ userId: string; name: string }>;
};

export class ProposalRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export const proposalsPath = (workspaceId: string, path: string, query?: Record<string, string>) =>
  `/api/proposals/${path}?${new URLSearchParams({ workspaceId, ...query })}`;

async function request<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const form = body instanceof FormData;
  const response = await fetch(url, { method, cache: "no-store", headers: form || body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : form ? body : JSON.stringify(body) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new ProposalRequestError(typeof data?.message === "string" ? data.message : "Could not update the proposal.", response.status);
  return data as T;
}

/** The firm's five-page proposal template (pages 1–3 and 5; page 4 is the quotation). */
export const proposalTemplateApi = (workspaceId: string) => ({
  get: () => request<ProposalTemplate>(proposalsPath(workspaceId, "template")),
  set: (slot: number, file: File, version: number) => {
    const body = new FormData();
    body.set("version", String(version));
    body.set("file", file);
    return request<ProposalTemplate>(proposalsPath(workspaceId, `template/pages/${slot}`), "PUT", body);
  },
  remove: (slot: number, version: number) => request<ProposalTemplate>(proposalsPath(workspaceId, `template/pages/${slot}/remove`), "POST", { version }),
  fileUrl: (slot: number) => proposalsPath(workspaceId, `template/pages/${slot}/file`),
});

/** One case's quotation documents, a quote's proposal and signing, and its QS hand-off. */
export const proposalApi = (workspaceId: string, caseId: string) => ({
  documents: () => request<{ documents: DocumentCard[]; canEdit: boolean }>(proposalsPath(workspaceId, `cases/${caseId}/documents`)),
  uploadExternal: (input: { id: string; reference: string; title: string; amount?: string; currency?: string; note?: string; file: File }) => {
    const body = new FormData();
    for (const [key, value] of Object.entries(input)) if (typeof value === "string" && value) body.set(key, value);
    body.set("file", input.file);
    return request<{ documents: DocumentCard[] }>(proposalsPath(workspaceId, `cases/${caseId}/documents/external`), "POST", body);
  },
  addVersion: (documentId: string, version: number, file: File, note = "") => {
    const body = new FormData();
    body.set("version", String(version));
    if (note) body.set("note", note);
    body.set("file", file);
    return request<{ documents: DocumentCard[] }>(proposalsPath(workspaceId, `cases/${caseId}/documents/${documentId}/versions`), "POST", body);
  },
  fileUrl: (documentId: string, number: number, download = false) => proposalsPath(workspaceId, `cases/${caseId}/documents/${documentId}/versions/${number}/file`, download ? { download: "1" } : undefined),
  previewUrl: (quoteId: string) => proposalsPath(workspaceId, `cases/${caseId}/quotes/${encodeURIComponent(quoteId)}/proposal.pdf`),
  issue: (quoteId: string) => request<{ documents: DocumentCard[] }>(proposalsPath(workspaceId, `cases/${caseId}/quotes/${encodeURIComponent(quoteId)}/proposal`), "POST", {}),
  clientView: (quoteId: string) => request<{ presentation: ClientPresentation; currency: string; decimals: number; taxLabel?: string }>(proposalsPath(workspaceId, `cases/${caseId}/quotes/${encodeURIComponent(quoteId)}/client-view`)),
  requestSignature: (quoteId: string, commandId: string) => request<{ request: SigningRequest; link: string | null; emailed: string | null }>(
    proposalsPath(workspaceId, `cases/${caseId}/quotes/${encodeURIComponent(quoteId)}/signature`), "POST", { commandId }),
  revokeSignature: (requestId: string, version: number) => request<SigningRequest>(proposalsPath(workspaceId, `cases/${caseId}/signatures/${requestId}/revoke`), "POST", { version }),
  qs: (quoteId: string) => request<QsState>(proposalsPath(workspaceId, `cases/${caseId}/quotes/${encodeURIComponent(quoteId)}/qs`)),
  sendToQs: (quoteId: string, assigneeUserId: string, note: string) => request<QsState>(proposalsPath(workspaceId, `cases/${caseId}/quotes/${encodeURIComponent(quoteId)}/qs/send`), "POST", { assigneeUserId, note }),
  decideQs: (quoteId: string, input: { decision: "confirm" | "return"; note?: string; version: number; commandId: string }) =>
    request<QsState>(proposalsPath(workspaceId, `cases/${caseId}/quotes/${encodeURIComponent(quoteId)}/qs/decide`), "POST", input),
});

/** PLM-106: the firm's intro deck and the opportunity's page 3. */
export const introDeckApi = (workspaceId: string, opportunityId: string) => ({
  get: () => request<{ url: string | null }>(proposalsPath(workspaceId, `opportunities/${opportunityId}/intro-deck`)),
  pageUrl: () => proposalsPath(workspaceId, `opportunities/${opportunityId}/intro-page.pdf`),
});

/** The public signing page's calls (no account; the token is the key). */
export type SigningView = {
  state: "open" | "signed" | "revoked" | "expired";
  brand: { name: string; logo: string | null; primaryColor: string | null };
  document: { title: string; reference: string; amount: string | null; currency: string | null; sha256: string };
  signer: { name: string; email: string | null; phone: string | null };
  expiresAt: string;
  signed: { at: string; name: string; sha256: string } | null;
};
export const signingApi = (token: string) => ({
  view: () => request<SigningView>(`/api/esign/${token}`),
  documentUrl: (signedCopy = false) => `/api/esign/${token}/document${signedCopy ? "?copy=signed" : ""}`,
  sign: (input: { name: string; email?: string; phone?: string; consent: boolean; documentSha256: string; signature: { kind: "typed"; text: string } | { kind: "drawn"; png: string } }) =>
    request<{ state: "signed"; replayed: boolean; signedAt: string; signedSha256: string }>(`/api/esign/${token}/sign`, "POST", input),
});
