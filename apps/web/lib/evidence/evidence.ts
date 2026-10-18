/** What a decision's photo or PDF is for: the record it will be tied to when the decision is saved (§0.3 P0). */
export type EvidenceKind = "receipt" | "client_credit" | "proposal_withdrawal" | "design_decision" | "handover_acceptance"
  | "material_decision" | "factory_output" | "stock_correction" | "supplier_bank" | "warranty_claim";

/** A file behind a decision, as the server keeps it. */
export type EvidenceFile = { id: string; name: string; mimeType: string; hasPreview: boolean; uploadedAt: string };

/** Where one opens (the picture when it has one). */
export function evidenceUrl(workspaceId: string, fileId: string, preview = false) {
  return `/api/workspace/evidence/${fileId}?${new URLSearchParams({ workspaceId, ...(preview ? { preview: "1" } : {}) })}`;
}

/** The decision's files as the review shows them. */
export function evidenceFiles(workspaceId: string, files: EvidenceFile[] | undefined) {
  return (files ?? []).map((file) => ({ id: file.id, name: file.name, href: evidenceUrl(workspaceId, file.id), previewHref: file.hasPreview ? evidenceUrl(workspaceId, file.id, true) : null }));
}

/** Uploads one photo or PDF for a decision, before the decision is saved; the decision sends back its id. */
export async function uploadEvidence(workspaceId: string, kind: EvidenceKind, file: File): Promise<EvidenceFile> {
  const body = new FormData();
  body.set("kind", kind);
  body.set("file", file);
  const response = await fetch(`/api/workspace/evidence?${new URLSearchParams({ workspaceId })}`, { method: "POST", body, cache: "no-store" });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof data?.message === "string" ? data.message : "The file could not be uploaded.");
  return data as EvidenceFile;
}
