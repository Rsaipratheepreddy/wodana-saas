import { invalidRequest, isSameOrigin, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

const collections = new Set(["flows", "enquiry-types", "settings", "sales-owners", "enquiry-fields", "lead-options", "lead-forms", "relationships", "parties", "leads", "queues", "assignment-policies", "sla-policies", "intake-inbox", "intake-events", "enquiries", "activities", "pipelines", "opportunities", "conversations", "sequences", "automations", "automation-presets", "automation-runs", "automation-approvals", "ai-suggestions", "today", "reports", "taxonomies", "custom-fields", "qualification-forms", "saved-views", "duplicate-candidates", "sequence-enrollments", "notification-templates", "notification-policies", "notification-preferences", "notifications", "party-merges", "inbox", "sales-settings", "enquiry-requirements"]);
const segments = new Set(["versions", "flow", "demo-whatsapp", "blank", "fields", "discovery", "intro", "designer", "responses", "details", "lead-flow", "default-managers", "requirement-notes", "decision", "members", "qualification", "qualify", "assign", "auto-assign", "assignment-simulation", "status", "complete", "appointment", "transition", "stages", "stakeholders", "team", "project-link", "messages", "read", "read-all", "publish", "pause", "validate", "dry-run", "enrollments", "stop", "review", "contact-points", "addresses", "consents", "relationships", "sources", "pipeline", "funnel", "sla", "assignment", "forecast", "approve", "archive", "history", "rollback", "privacy-erasure", "merge", "reverse", "summary", "owners", "bulk", "labels", "quick-replies", "templates", "variables", "context", "settings", "starter-pack", "client-messages", "payment-reminders", "schedule", "block", "hidden", "auto-replies", "follow-ups", "scheduled-messages", "cancel", "attachments", "crm.enquiry.created", "portal.quote_issued", "portal.invoice_issued", "receivables.payment_received", "portal.decision_waiting", "portal.update_published", "project.stage_started", "payments.reminder", "contact-match", "confirm-client", "reopen-duplicate", "me", "save", "save-targets", "spam", "whatsapp-check", "whatsapp-test", "proposals", "design", "main", "value", "decide", "fulfilment", "closing", "migration", "site-visit", "slots"]);

async function handle(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const t = await getServerT();
  const { path } = await params;
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId") ?? "";
  if (path.length === 1 && path[0] === "members" && request.method === "GET" && UUID.test(workspaceId)) return workspaceJsonResponse(`/workspaces/${workspaceId}/members`, { method: "GET" }, t("Members could not be loaded."));
  const validPreset = (path[0] === "automation-presets" && path.length === 2 && /^[a-z][a-z_]{1,48}$/.test(path[1]))
    // PLM-096: one field's requirement per enquiry type (a product field, a team role or the workspace's own field).
    || (path[0] === "enquiry-requirements" && path.length === 2 && /^(email|area|address|budgetRange|customerType|summary|team:[a-z_]{2,40}|cf:[0-9a-f-]{36})$/.test(path[1]))
    // E2-5 / PLM-081: a job marks one of its steps (by its key) not needed, or needed again.
    || (path[0] === "opportunities" && path.length === 5 && UUID.test(path[1]) && path[2] === "steps" && /^[a-z][a-z0-9_]{0,39}$/.test(path[3]) && ["skip", "unskip"].includes(path[4]));
  if (!UUID.test(workspaceId) || !collections.has(path[0]) || path.length > 5 || (!validPreset && path.slice(1).some((part) => !UUID.test(part) && !segments.has(part)))) return invalidRequest(t("Invalid CRM resource."));
  if (request.method !== "GET") {
    if (!isSameOrigin(request)) return Response.json({ message: t("This request must come from your workspace.") }, { status: 403 });
  }
  const query = new URLSearchParams(url.searchParams);
  query.delete("workspaceId");
  if (query.toString().length > 2500) return invalidRequest(t("The request filters are too long."));
  let body: string | undefined;
  if (!["GET", "DELETE"].includes(request.method)) {
    body = await request.text();
    if (body.length > 250_000) return invalidRequest(t("The request is too large."));
    try { const parsed: unknown = JSON.parse(body || "{}"); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return invalidRequest(t("A JSON object is required.")); body = JSON.stringify(parsed); }
    catch { return invalidRequest(t("Invalid JSON request.")); }
  }
  return workspaceJsonResponse(`/workspaces/${workspaceId}/crm/${path.join("/")}${query.size ? `?${query}` : ""}`, {
    method: request.method, headers: { "content-type": "application/json" }, body,
  }, t("The CRM request could not be completed."));
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
