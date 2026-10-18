// Structural copy of packages/contracts/src/person-name.ts (business-core does not depend on contracts); the parity
// spec keeps the two the same.
//
// The one rule for a person's name that staff type (a customer, a client, a contact): letters of any script and
// spaces, with a hyphen or an apostrophe between letters (Al-Suwaidi, D'Souza) and a full stop after a letter (Jr.).
// Names that arrive from a channel (WhatsApp, a public form, an email, an import) are never checked.

const WORD = String.raw`\p{L}[\p{L}\p{M}]*`;
const JOIN = String.raw`(?:\s+|['’‘-]|\.\s*)`;
export const PERSON_NAME_PATTERN = new RegExp(String.raw`^${WORD}(?:${JOIN}${WORD})*\.?$`, "u");

/** The name as it is saved: no spaces around it, one space between words. */
export function normalizePersonName(name: string): string {
  return name.replace(/\s+/gu, " ").trim();
}

/** Why a typed name can't be saved: "required" when empty, "characters" for digits or symbols; null when it's fine. */
export function personNameProblem(name: string | null | undefined): "required" | "characters" | null {
  const value = normalizePersonName(name ?? "");
  if (!value) return "required";
  return PERSON_NAME_PATTERN.test(value) ? null : "characters";
}

/** What the person reads when a typed name has digits or symbols (the web shows the same line under the field). */
export const PERSON_NAME_MESSAGE = "Use letters and spaces only";

/**
 * True when a save brings a name that was typed, not the one kept as it came: a new record, or a name that differs
 * from the stored one (filling an empty one included). Only a typed name is checked.
 */
export function personNameTyped(before: string | null | undefined, next: string | null | undefined, isNew = false) {
  if (next === undefined || next === null) return false;
  return isNew || normalizePersonName(before ?? "") !== normalizePersonName(next);
}

/** The problem for a typed name with digits or symbols, or null (an empty name is reported by the field's own rule). */
export function typedNameProblem(before: string | null | undefined, next: string | null | undefined, isNew = false) {
  return personNameTyped(before, next, isNew) && personNameProblem(next) === "characters" ? PERSON_NAME_MESSAGE : null;
}
