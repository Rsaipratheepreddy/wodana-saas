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

export const shortDate = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
