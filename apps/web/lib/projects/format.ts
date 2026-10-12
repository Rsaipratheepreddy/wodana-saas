/**
 * A project or case title without its client's name in front ("Mariam Al Suwaidi · Villa 27 furniture" → "Villa 27
 * furniture"). Only the client's own name is dropped: a title that merely contains " · " ("Business Bay office ·
 * reception and boardroom") is kept whole.
 */
export function projectDisplayName(title: string, client?: string | null) {
  const prefix = client?.trim() ? `${client.trim()} · ` : null;
  return (prefix && title.startsWith(prefix) ? title.slice(prefix.length).trim() : title) || title;
}

export const initials = (name: string) =>
  name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((x) => x[0])
    .join("")
    .toUpperCase();

/** A calendar day ("2026-09-27") in the workspace `locale`. */
export const shortDate = (day: string, locale?: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
