export function projectDisplayName(title: string) {
  const separator = title.indexOf(" · ");
  return (separator > 0 ? title.slice(separator + 3).trim() : title) || title;
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
