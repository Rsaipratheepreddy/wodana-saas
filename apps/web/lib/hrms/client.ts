export class HrmsError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly issues: string[] = [],
  ) {
    super(message);
  }
}
export function hrmsUrl(workspaceId: string, path: string, area = "hrms") {
  return `/api/workspace/${area}/${path}${path.includes("?") ? "&" : "?"}workspaceId=${encodeURIComponent(workspaceId)}`;
}
export async function hrmsRequest<T>(
  workspaceId: string,
  path: string,
  method = "GET",
  body?: unknown,
  area = "hrms",
): Promise<T> {
  const response = await fetch(hrmsUrl(workspaceId, path, area), {
    method,
    headers:
      body instanceof FormData
        ? {}
        : body
          ? { "content-type": "application/json" }
          : {},
    body:
      body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  }).catch(() => {
    throw new HrmsError(
      "Connection interrupted. Retry when you are online.",
      0,
    );
  });
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new HrmsError(
      data?.message ?? "The request could not be completed.",
      response.status,
      data?.issues ?? [],
    );
  return data;
}
export function localDay(timezone: string, date = new Date()): string {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (key: string) => p.find((x) => x.type === key)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export function minutesLabel(minutes: number) {
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
export function timeLabel(value: string | null | undefined, timezone: string) {
  return value
    ? new Intl.DateTimeFormat(undefined, {
        timeZone: timezone,
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(value))
    : "—";
}
export function statusLabel(value: string) {
  return value.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
}
