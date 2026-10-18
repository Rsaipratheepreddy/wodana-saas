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
  return `/api/workspace/${area}${path ? `/${path}` : ""}${path.includes("?") ? "&" : "?"}workspaceId=${encodeURIComponent(workspaceId)}`;
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
/** A calendar date (YYYY-MM-DD) as it is in a time zone at a moment. */
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
/** The instant a wall-clock time (HH:MM) on a calendar date is in a time zone. */
export function zonedInstant(date: string, time: string, timezone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const offset = (at: number) => {
    const parts = format.formatToParts(new Date(at));
    const get = (key: string) => Number(parts.find((x) => x.type === key)!.value);
    return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - at;
  };
  // Twice, so a guess on the other side of a daylight-saving change settles.
  const first = wall - offset(wall);
  return new Date(wall - offset(first));
}
/** HH:MM of a moment in a time zone (24-hour, for time fields). */
export function wallTime(value: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(value));
  const get = (key: string) => parts.find((x) => x.type === key)!.value;
  return `${get("hour")}:${get("minute")}`;
}
