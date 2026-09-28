import { invalidRequest, isSameOrigin, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

export async function GET(request: Request) {
  const t = await getServerT();
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId") ?? "";
  const cursor = url.searchParams.get("cursor");
  if (!UUID.test(workspaceId)) return invalidRequest(t("A valid workspace is required."));
  if (cursor && (cursor.length > 500 || !/^[A-Za-z0-9_-]+$/.test(cursor))) {
    return invalidRequest(t("The leads cursor is invalid."));
  }

  const query = new URLSearchParams({ limit: "100" });
  if (cursor) query.set("cursor", cursor);
  return workspaceJsonResponse(
    `/workspaces/${workspaceId}/crm/leads?${query}`,
    { method: "GET" },
    t("Leads could not be loaded."),
  );
}

export async function POST(request: Request) {
  const t = await getServerT();
  if (!isSameOrigin(request)) return Response.json({ message: t("This request must come from your workspace.") }, { status: 403 });
  const raw = await request.text();
  if (raw.length > 30000) return invalidRequest(t("The enquiry is too large."));
  const body = await Promise.resolve().then(() => JSON.parse(raw)).catch(() => null) as Record<string, unknown> | null;
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : "";
  const requestId = typeof body?.requestId === "string" ? body.requestId : "";
  const displayName = typeof body?.displayName === "string" ? body.displayName.trim() : "";
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
  const summary = typeof body?.summary === "string" ? body.summary.trim() : "";
  const source = typeof body?.source === "string" ? body.source : "";
  const channel = typeof body?.channel === "string" ? body.channel : "";
  const serviceType = typeof body?.serviceType === "string" ? body.serviceType : "";
  const mobile = typeof body?.mobile === "string" ? body.mobile.trim() : "";
  const details = body?.details && typeof body.details === "object" && !Array.isArray(body.details) ? body.details as Record<string, unknown> : {};
  const emirate = typeof details.emirate === "string" ? details.emirate.trim() : "";

  if (!UUID.test(workspaceId) || !UUID.test(requestId)) {
    return invalidRequest(t("A valid workspace and request identifier are required."));
  }
  if (!displayName || displayName.length > 240 || title.length > 240) {
    return invalidRequest(t("Enter a valid customer name and an optional title up to 240 characters."));
  }
  if (email && (email.length > 500 || !/^\S+@\S+\.\S+$/.test(email))) {
    return invalidRequest(t("Enter a valid email address."));
  }
  if (phone.length > 80 || summary.length > 10_000) {
    return invalidRequest(t("The phone number or enquiry notes are too long."));
  }
  if (!source || !channel || !serviceType) return invalidRequest(t("Select a source, channel and enquiry type."));
  if (!mobile || !emirate) return invalidRequest(t("Enter a mobile number and select a region."));
  // LF-1: the person's answer to "existing client?", and who referred a referral enquiry.
  const identity = body?.identity === "existing" || body?.identity === "new" ? body.identity : undefined;
  const partyId = typeof body?.partyId === "string" && UUID.test(body.partyId) ? body.partyId : undefined;
  if (identity === "existing" && !partyId) return invalidRequest(t("Choose the existing client again."));
  const referral = body?.referral && typeof body.referral === "object" && !Array.isArray(body.referral) ? body.referral : undefined;
  const extraContact = Object.fromEntries(["mobile", "mobileCountryCode", "phoneCountryCode", "company", "jobPosition", "website", "address"].flatMap(key => typeof body?.[key] === "string" ? [[key, body[key]]] : []));

  return workspaceJsonResponse(
    `/workspaces/${workspaceId}/crm/intake-events`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": `lead-ui:${requestId}`,
      },
      body: JSON.stringify({
        source,
        channel,
        intakeMethod: "manual",
        party: {
          displayName,
          ...extraContact,
          ...(email ? { email } : {}),
          ...(phone ? { phone } : {}),
        },
        title,
        ...(summary ? { summary } : {}),
        serviceType,
        details,
        assignment: body?.assignment ?? { mode: "unassigned" },
        ...(referral ? { referral } : {}),
        ...(identity ? { identity, ...(identity === "existing" ? { partyId } : {}) } : {}),
        originalPayload: { origin: "wodana_leads_ui" },
      }),
    },
    t("The lead could not be created."),
  );
}
