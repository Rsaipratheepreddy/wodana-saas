/**
 * The display name a workspace keeps for an invited person until they choose one. It is derived
 * from the email address, so it is never used to greet them.
 */
export function placeholderDisplayName(email: string): string {
  return email
    .split("@")[0]
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/**
 * The name an invitation email may greet: the invited person's display name when one was given;
 * nothing (a neutral greeting) when the name is missing or was only derived from the address.
 */
export function invitationGreetingName(displayName: string | null | undefined, email: string): string | null {
  const name = displayName?.trim() ?? "";
  if (!name) return null;
  const derived = [email.trim(), email.split("@")[0], placeholderDisplayName(email)].map((value) => value.trim().toLowerCase());
  return derived.includes(name.toLowerCase()) ? null : name;
}
