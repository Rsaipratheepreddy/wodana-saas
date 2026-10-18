/**
 * The one rule for a person's name that staff type (a customer, a client, a contact). Letters of any script (Latin
 * with accents, Arabic, Devanagari…) and spaces, with the punctuation real names need: a hyphen or an apostrophe
 * between letters (Al-Suwaidi, D'Souza) and a full stop after a letter (Jr., A. K. Sharma). Digits and other
 * symbols are refused. Names that arrive from a channel (WhatsApp, a public form, an email) are never checked.
 *
 * business-core keeps a structural copy (services/business-core/src/common/person-name.ts) with a parity spec.
 */

// A word: a letter, then letters or marks (vowel signs and diacritics are marks).
const WORD = String.raw`\p{L}[\p{L}\p{M}]*`;
// Between words: spaces, a hyphen or apostrophe (no spaces around it), or a full stop with optional spaces.
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
