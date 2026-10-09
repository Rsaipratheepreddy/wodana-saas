import type { PoolClient } from "pg";

/**
 * A calendar day (YYYY-MM-DD, no time zone shift) as people read it in the workspace's locale: "9 Oct 2026" in en-GB,
 * "Oct 9, 2026" in en-US. Text people read never shows the ISO date; an unknown locale falls back to English.
 */
export function formatCalendarDay(day: string, locale: string) {
  const options: Intl.DateTimeFormatOptions = { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" };
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return day;
  try { return new Intl.DateTimeFormat(locale || "en", options).format(date); } catch { return new Intl.DateTimeFormat("en", options).format(date); }
}

/** The workspace's locale (its region's), for text written into records. */
export async function workspaceLocale(db: Pick<PoolClient, "query">, workspaceId: string) {
  return (await db.query<{ locale: string }>(`SELECT coalesce(nullif(default_locale, ''), 'en') AS locale FROM workspaces WHERE id = $1`, [workspaceId])).rows[0]?.locale ?? "en";
}
