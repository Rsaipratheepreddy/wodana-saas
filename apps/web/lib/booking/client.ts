import { tKey } from "@/lib/i18n/keys";

export class BookingRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/** Calls the booking API of the signed-in workspace (Sales settings). */
export async function bookingRequest<T>(workspaceId: string, path: string, method = "GET", body?: unknown): Promise<T> {
  const [resource, search = ""] = path.split("?");
  const query = new URLSearchParams(search);
  query.set("workspaceId", workspaceId);
  const response = await fetch(`/api/workspace/booking/${resource}?${query}`, { method, cache: "no-store", headers: { "content-type": "application/json" }, ...(method !== "GET" && method !== "DELETE" ? { body: JSON.stringify(body ?? {}) } : {}) });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new BookingRequestError(Array.isArray(result?.message) ? result.message.join(". ") : result?.message ?? tKey("Booking is unavailable right now. Please try again."), response.status);
  return result as T;
}
