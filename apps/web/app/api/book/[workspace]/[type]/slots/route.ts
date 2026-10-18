import { forwardPublic, SLUG } from "@/lib/booking/public-proxy.server";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Free times for a date range. */
export async function GET(request: Request, { params }: { params: Promise<{ workspace: string; type: string }> }) {
  const { workspace, type } = await params;
  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? "", to = url.searchParams.get("to") ?? "", enquiryType = url.searchParams.get("enquiryType") ?? "";
  if (!SLUG.test(workspace) || !SLUG.test(type) || !DATE.test(from) || !DATE.test(to) || enquiryType.length > 100) return Response.json({ message: "Not found" }, { status: 404 });
  const query = new URLSearchParams({ from, to, ...(enquiryType ? { enquiryType } : {}) });
  return forwardPublic(request, `${workspace}/${type}/slots?${query}`);
}
