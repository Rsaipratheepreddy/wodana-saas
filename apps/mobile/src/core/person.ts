/**
 * A person's name as shown in the app: their display name, else the part of their email before the @.
 * Same rule as the web's PersonName; the full email is shown separately, never as the name.
 */
export function personDisplayName(name: string | null | undefined, email?: string | null): string {
  const trimmed = (name ?? "").trim();
  if (trimmed && !trimmed.includes("@")) return trimmed;
  const address = (trimmed.includes("@") ? trimmed : email ?? "").trim();
  return address.split("@")[0] || trimmed || address;
}
