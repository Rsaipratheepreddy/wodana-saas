/**
 * The issuing business's letterhead as documents print it (PLM-112): its legal name, licence and tax numbers,
 * registered address and contact, its logo, and a header image with footer text. Documents without one use
 * the workspace brand.
 */
export type DocumentLetterhead = {
  entityId?: string;
  legalName: string;
  taxLabel: string | null;
  /** The tax's own name in the business's country ("VAT", "GST"), from its region pack. */
  taxName?: string | null;
  taxNumber: string | null;
  licenceNumber: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  footer: string | null;
  logoUrl: string | null;
  headerUrl: string | null;
};

/** A business's letterhead, for a document printed in the workspace (a purchase order). */
export async function fetchLetterhead(workspaceId: string, entityId: string): Promise<DocumentLetterhead | null> {
  const response = await fetch(`/api/workspace/legal-entities/${entityId}/letterhead?${new URLSearchParams({ workspaceId })}`, { cache: "no-store" }).catch(() => null);
  if (!response?.ok) return null;
  const letterhead = await response.json().catch(() => null) as DocumentLetterhead | null;
  return letterhead && typeof letterhead.legalName === "string" ? letterhead : null;
}
