import { internalBinaryResponse } from "@/lib/internal/proxy";
import { SALES_ENQUIRY_STATUSES } from "@/lib/internal/sales";
import { invalidRequest } from "@/lib/workspace/workspace-api";

/** The CSV export for the list's current filter. */
export async function GET(request: Request) {
  const incoming = new URL(request.url).searchParams;
  const query = new URLSearchParams();
  const status = incoming.get("status");
  const search = incoming.get("search")?.trim();
  if (status) {
    if (!(SALES_ENQUIRY_STATUSES as readonly string[]).includes(status)) return invalidRequest("Choose a valid status.");
    query.set("status", status);
  }
  if (search) query.set("search", search.slice(0, 160));
  const suffix = query.toString();
  return internalBinaryResponse(`/internal/operator/sales-enquiries/export${suffix ? `?${suffix}` : ""}`, "The export could not be downloaded.");
}
