import { invalidRequest, isSameOrigin, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

function validCode(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z0-9][A-Z0-9_-]{1,23}$/.test(value.trim().toUpperCase());
}

function validText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length >= 2 && value.trim().length <= max;
}

export async function POST(request: Request) {
  const t = await getServerT();
  if (!isSameOrigin(request)) return invalidRequest(t("This request must come from the workspace."));
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : "";
  if (!UUID.test(workspaceId)) return invalidRequest(t("A valid workspace is required."));
  if (!validCode(body?.code) || !validText(body?.displayName, 160) || !validText(body?.registeredName, 200)) {
    return invalidRequest(t("Enter a valid entity code, display name, and registered name."));
  }
  const countryCode = typeof body?.countryCode === "string" ? body.countryCode.trim().toUpperCase() : "";
  const baseCurrency = typeof body?.baseCurrency === "string" ? body.baseCurrency.trim().toUpperCase() : "";
  const locale = typeof body?.locale === "string" ? body.locale.trim() : "";
  const timezone = typeof body?.timezone === "string" ? body.timezone.trim() : "";
  if (!/^[A-Z]{2}$/.test(countryCode) || !/^[A-Z]{3}$/.test(baseCurrency) || !locale || !timezone) {
    return invalidRequest(t("Country, currency, locale, and time zone are required."));
  }
  return workspaceJsonResponse(`/workspaces/${workspaceId}/legal-entities`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code: body.code.trim().toUpperCase(),
      displayName: body.displayName.trim(),
      registeredName: body.registeredName.trim(),
      countryCode,
      baseCurrency,
      locale,
      timezone,
      taxRegistrationNumber: typeof body.taxRegistrationNumber === "string" ? body.taxRegistrationNumber.trim() : undefined,
      registrationNumber: typeof body.registrationNumber === "string" ? body.registrationNumber.trim() : undefined,
      address: body.address && typeof body.address === "object" && !Array.isArray(body.address) ? body.address : undefined,
      phone: typeof body.phone === "string" ? body.phone.trim() : undefined,
      email: typeof body.email === "string" ? body.email.trim() : undefined,
      letterheadFooter: typeof body.letterheadFooter === "string" ? body.letterheadFooter.trim() : undefined,
    }),
  }, t("The legal entity could not be created."));
}

