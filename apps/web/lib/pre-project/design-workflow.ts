import type { CaseDesign } from "./content";

export const designTabs = [
  { id: "designs", label: "Designs" },
  { id: "internal-approval", label: "Internal approval" },
  { id: "client-approval", label: "Client approval" },
  { id: "approved", label: "Approved" },
] as const;
export type DesignTab = (typeof designTabs)[number]["id"];
export function designStage(status?: string): DesignTab {
  if (status === "approved") return "approved";
  if (status === "client_review") return "client-approval";
  if (status === "internal_review" || status === "internal_approved")
    return "internal-approval";
  return "designs";
}
/** The library always contains every file. Approval tabs are views, not folders. */
export function inDesignTab(design: CaseDesign, tab: DesignTab) {
  return tab === "designs" || designStage(design.versions[0]?.status) === tab;
}
export const designStateLabels: Record<string, string> = {
  draft: "Draft",
  internal_review: "Needs internal review",
  internal_approved: "Ready to send to client",
  client_review: "Awaiting client",
  approved: "Approved",
  changes_requested: "Changes requested",
  rejected: "Rejected",
  expired: "Review expired",
  superseded: "Superseded",
  no_file: "File needed",
};
export const designTabHints: Record<DesignTab, string> = {
  designs:
    "All your design files, organized by room or item. Files stay here through every review.",
  "internal-approval":
    "Review submitted files, then send internally approved revisions to the client.",
  "client-approval":
    "Shared with the client. Their portal decision updates the file here automatically.",
  approved:
    "Latest revisions approved by the client. Earlier decisions remain in each file’s history.",
};
/** A background read started before a save must never roll that save back. */
export function mergeDesigns(current: CaseDesign[], incoming: CaseDesign[]) {
  const merged = new Map(current.map((d) => [d.id, d]));
  for (const design of incoming)
    if (
      !merged.has(design.id) ||
      merged.get(design.id)!.version <= design.version
    )
      merged.set(design.id, design);
  return [...merged.values()].sort(
    (a, b) =>
      b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
  );
}
