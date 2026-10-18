/**
 * The record a signing code is bound to when the client signs several items' shop drawings at once: the case and
 * exactly the versions chosen, as a UUID-shaped SHA-256 (the business core reads the same from the versions it signs).
 */
export async function signingBatchId(caseId: string, versionIds: string[]) {
  const text = `${caseId.toLowerCase()}:${versionIds.map((id) => id.toLowerCase()).sort().join(",")}`;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** The purpose of the code that signs these versions. */
export async function signingPurpose(caseId: string, versionIds: string[]) {
  return `item_drawings:${caseId}:${await signingBatchId(caseId, versionIds)}:sign`;
}
