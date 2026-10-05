import { businessApiUrl } from "@/lib/auth/server";
import { forwardPublic, SLUG, TOKEN } from "@/lib/booking/public-proxy.server";

type Params = { params: Promise<{ workspace: string; token: string; action: string }> };

/** The booking's calendar file (.ics), for "Add to calendar". */
export async function GET(_request: Request, { params }: Params) {
  const { workspace, token, action } = await params;
  if (action !== "ics" || !SLUG.test(workspace) || !TOKEN.test(token)) return new Response("Not found", { status: 404 });
  const response = await fetch(businessApiUrl(`/public/booking/${workspace}/manage/${token}/ics`), { cache: "no-store", signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!response?.ok) return new Response("Not found", { status: response?.status === 404 ? 404 : 503 });
  return new Response(await response.text(), { headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": "attachment; filename=booking.ics", "cache-control": "no-store" } });
}

/** Cancel or move a booking from its manage link. */
export async function POST(request: Request, { params }: Params) {
  const { workspace, token, action } = await params;
  if (!["cancel", "reschedule"].includes(action) || !SLUG.test(workspace) || !TOKEN.test(token)) return Response.json({ message: "Not found" }, { status: 404 });
  return forwardPublic(request, `${workspace}/manage/${token}/${action}`, { method: "POST", write: true });
}
