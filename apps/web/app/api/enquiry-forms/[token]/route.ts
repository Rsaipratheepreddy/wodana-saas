import { businessApiUrl } from "@/lib/auth/server";
import { isSameOrigin } from "@/lib/workspace/workspace-api";
import { getServerT } from "@/lib/i18n/server";

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const t = await getServerT();
  if (!isSameOrigin(request)) return Response.json({ message: t("Please submit from the enquiry form.") }, { status: 403 });
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return Response.json({ message: t("Form not found.") }, { status: 404 });
  const body = await request.text();
  if (body.length > 60000) return Response.json({ message: t("Your answers are too long.") }, { status: 413 });
  try {
    JSON.parse(body);
    const response = await fetch(businessApiUrl(`/public/crm/lead-forms/${token}`), { method: "POST", headers: { "content-type": "application/json" }, body, cache: "no-store", signal: AbortSignal.timeout(20000) });
    const result = await response.json();
    return Response.json(response.status >= 500 ? { message: t("Your enquiry could not be submitted. Please try again.") } : result, { status: response.status });
  } catch { return Response.json({ message: t("Your enquiry could not be submitted. Please try again.") }, { status: 503 }); }
}
