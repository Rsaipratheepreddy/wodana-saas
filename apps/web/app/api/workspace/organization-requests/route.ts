import { NextResponse } from "next/server";
import { invalidRequest, isSameOrigin, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

const ENTITY_CODE = /^[A-Z0-9][A-Z0-9_-]{1,23}$/;
const CURRENCY = /^[A-Z]{3}$/;
const COUNTRY = /^[A-Z]{2}$/;
const UNIT_SYSTEMS = new Set(["metric", "imperial", "mixed"]);

export async function GET(request: Request) {
  const t = await getServerT();
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  if (!UUID.test(workspaceId)) return invalidRequest(t("A valid workspace is required."));
  return workspaceJsonResponse(
    `/workspaces/${workspaceId}/account/organization-requests`,
    { method: "GET" },
    t("Organization requests could not be loaded."),
  );
}

export async function POST(request: Request) {
  const t = await getServerT();
  if (!isSameOrigin(request)) return NextResponse.json({ message: t("Invalid request origin.") }, { status: 403 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const workspaceId = typeof body?.workspaceId === "string" ? body.workspaceId : "";
  const idempotencyKey = typeof body?.idempotencyKey === "string" ? body.idempotencyKey : "";
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const registeredName = typeof body?.registeredName === "string" ? body.registeredName.trim() : "";
  const entityCode = typeof body?.entityCode === "string" ? body.entityCode.trim().toUpperCase() : "";
  const countryCode = typeof body?.countryCode === "string" ? body.countryCode.trim().toUpperCase() : "";
  const defaultCurrency = typeof body?.defaultCurrency === "string" ? body.defaultCurrency.trim().toUpperCase() : "";
  const defaultLocale = typeof body?.defaultLocale === "string" ? body.defaultLocale.trim() : "";
  const defaultTimezone = typeof body?.defaultTimezone === "string" ? body.defaultTimezone.trim() : "";
  const unitSystem = typeof body?.unitSystem === "string" ? body.unitSystem : "";
  const weekStartsOn = Number(body?.weekStartsOn);
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";

  if (!UUID.test(workspaceId)) return invalidRequest(t("A valid workspace is required."));
  if (!UUID.test(idempotencyKey)) return invalidRequest(t("A valid request key is required."));
  if (name.length < 2 || name.length > 160) return invalidRequest(t("Enter an organization name between 2 and 160 characters."));
  if (registeredName.length < 2 || registeredName.length > 200) return invalidRequest(t("Enter the registered company name."));
  if (!ENTITY_CODE.test(entityCode)) return invalidRequest(t("Entity code must be 2–24 letters, numbers, hyphens, or underscores."));
  if (!COUNTRY.test(countryCode) || !CURRENCY.test(defaultCurrency) || !defaultLocale || !defaultTimezone || !UNIT_SYSTEMS.has(unitSystem)) {
    return invalidRequest(t("The organization settings are incomplete."));
  }
  if (!Number.isInteger(weekStartsOn) || weekStartsOn < 0 || weekStartsOn > 6) return invalidRequest(t("Choose a valid first day of the week."));
  if (reason.length > 500) return invalidRequest(t("Reason must be 500 characters or fewer."));

  return workspaceJsonResponse(
    `/workspaces/${workspaceId}/account/organization-requests`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
      body: JSON.stringify({
        name,
        defaultCurrency,
        defaultLocale,
        defaultTimezone,
        unitSystem,
        weekStartsOn,
        firstLegalEntity: {
          code: entityCode,
          displayName: name,
          registeredName,
          countryCode,
          baseCurrency: defaultCurrency,
          locale: defaultLocale,
          timezone: defaultTimezone,
        },
        ...(reason ? { reason } : {}),
      }),
    },
    t("The organization request could not be sent."),
  );
}
