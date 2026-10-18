/** §0.3 P3/P4: the firm's invoice layout (the server's shape; configuration only, never amounts). */
export type InvoiceLayout = { title: string; lineTax: boolean; reference: boolean; balance: boolean; payment: string; terms: string; footer: string };
export const DEFAULT_INVOICE_LAYOUT: InvoiceLayout = { title: "Tax invoice", lineTax: true, reference: true, balance: true, payment: "", terms: "", footer: "" };

async function call<T>(workspaceId: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/workspace/setup/documents/client-invoice?workspaceId=${workspaceId}`, { ...init, cache: "no-store", headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof payload?.message === "string" ? payload.message : "Setup could not be saved.");
  return payload as T;
}
export const loadInvoiceLayout = (workspaceId: string) => call<{ layout: InvoiceLayout; revision: number }>(workspaceId);
export const saveInvoiceLayout = (workspaceId: string, revision: number, layout: InvoiceLayout) =>
  call<{ layout: InvoiceLayout; revision: number }>(workspaceId, { method: "PUT", body: JSON.stringify({ revision, layout }) });
