import { invalidRequest, isSameOrigin, UUID } from "@/lib/workspace/workspace-api";
import { providerResponse } from "@/lib/workspace/provider-api";
import { workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

type Context = { params: Promise<{ connectionId: string }> };
export async function GET(request: Request, context: Context) {
  const t = await getServerT();
  const { connectionId } = await context.params;
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId") ?? "";
  const kind = url.searchParams.get("kind") ?? "";
  if (!UUID.test(workspaceId) || !UUID.test(connectionId)) return invalidRequest(t("Invalid connection."));
  const health = { workspaceId, connectionId, operation: `provider.read.${kind || "unknown"}` };
  if (kind === "calendars") return providerResponse(`/integrations/google/workspaces/${workspaceId}/connections/${connectionId}/calendars`, {}, health);
  if (kind === "events") return providerResponse(`/integrations/providers/workspaces/${workspaceId}/connections/${connectionId}/events`, {}, health);
  if (kind === "invoice") {
    const invoiceId = url.searchParams.get("invoiceId") ?? "";
    if (!/^[a-zA-Z0-9]{1,100}$/.test(invoiceId)) return invalidRequest(t("Choose an invoice."));
    return providerResponse(`/integrations/providers/workspaces/${workspaceId}/connections/${connectionId}/invoices/${invoiceId}`, {}, health);
  }
  if (!["invoices", "customers", "items", "vendors", "bills", "payments", "purchaseorders", "expenses", "templates", "accounts", "taxes"].includes(kind)) return invalidRequest(t("Unsupported resource."));
  const page = Number(url.searchParams.get("page") ?? 1);
  if (!Number.isInteger(page) || page < 1 || page > 10000) return invalidRequest(t("Invalid page."));
  return providerResponse(`/integrations/providers/workspaces/${workspaceId}/connections/${connectionId}/records/${kind}?page=${page}`, {}, health);
}

export async function POST(request: Request, context: Context) {
  const t = await getServerT();
  if (!isSameOrigin(request)) return invalidRequest(t("Invalid request origin."));
  const { connectionId } = await context.params;
  const body = await request.json().catch(() => null);
  if (!UUID.test(body?.workspaceId ?? "") || !UUID.test(connectionId)) return invalidRequest(t("Invalid connection."));
  const { workspaceId, action } = body;
  if (action === "whatsapp.complete") return providerResponse("/integrations/providers/whatsapp/complete", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body.payload, workspaceId, connectionId }),
  });
  if (action === "calendars.select") return workspaceJsonResponse(`/workspaces/${workspaceId}/integration-connections/${connectionId}/resources`, {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body.payload),
  }, t("Calendar selection could not be saved."));
  if (action === "calendar.create") return providerResponse("/integrations/google/events", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body.payload, workspaceId, connectionId, idempotencyKey: body.idempotencyKey }),
  });
  if (action === "inbox.sync") return providerResponse(`/integrations/providers/workspaces/${workspaceId}/connections/${connectionId}/inbox/sync`, { method: "POST" });
  return providerResponse(`/integrations/providers/workspaces/${workspaceId}/connections/${connectionId}/operations`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, idempotencyKey: body.idempotencyKey, payload: body.payload }),
  });
}
