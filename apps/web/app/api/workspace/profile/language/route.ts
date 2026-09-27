import { NextResponse } from "next/server";
import { getServerT } from "@/lib/i18n/server";
import { supportedLanguage } from "@/lib/i18n/languages";
import { invalidRequest, isSameOrigin, UUID, workspaceJsonResponse } from "@/lib/workspace/workspace-api";

const bypass = () => process.env.NODE_ENV !== "production" && process.env.E2E_AUTH_BYPASS === "true";
const LOCALE = /^[a-z]{2,3}(-([A-Z]{2}|\d{3}))?$/;

/** Saves the person's interface language on their profile, so it follows them to other devices. */
export async function PUT(request: Request) {
  const t = await getServerT();
  if (!isSameOrigin(request)) return invalidRequest(t("This request must come from the workspace."));
  const body = await request.json().catch(() => null) as { workspaceId?: string; preferredLocale?: string } | null;
  if (!UUID.test(body?.workspaceId ?? "")) return invalidRequest(t("A valid workspace is required."));
  const preferredLocale = body?.preferredLocale ?? "";
  if (!LOCALE.test(preferredLocale) || !supportedLanguage(preferredLocale)) return invalidRequest(t("Choose one of the listed languages."));
  if (bypass()) return NextResponse.json({ preferredLocale });
  return workspaceJsonResponse(`/workspaces/${body!.workspaceId}/me/language`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ preferredLocale }),
  }, t("Your language could not be saved."));
}
