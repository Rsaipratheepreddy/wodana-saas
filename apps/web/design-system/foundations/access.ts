/**
 * True when a request failed because the person's role can't use it (HTTP 403 or a
 * "Permissions required" reply). Show `NoAccessState`/`NoAccessNotice` for these, never
 * `ErrorState`: retrying can't fix missing access, and permission codes mean nothing to people.
 */
export function isNoAccessError(error: unknown): boolean {
  if (!error) return false;
  const status = typeof error === "object" && error !== null && "status" in error ? Number((error as { status: unknown }).status) : undefined;
  if (status === 403) return true;
  const message = typeof error === "string" ? error : error instanceof Error ? error.message : typeof error === "object" && error !== null && "message" in error ? String((error as { message: unknown }).message) : "";
  return /\bpermissions? required\b|\bdo(?:es)? not have (?:access|permission)\b|\bdon't have (?:access|permission)\b|\bnot allowed to\b|\bmodule is not included\b/i.test(message);
}
