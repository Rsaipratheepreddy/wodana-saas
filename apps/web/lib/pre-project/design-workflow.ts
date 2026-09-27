import type { CaseDesign } from "./content";
import { tKey, type MessageKey } from "@/lib/i18n/keys";

export const designTabs = [
  { id: "designs", label: tKey("Designs") },
  { id: "internal-approval", label: tKey("Internal approval") },
  { id: "client-approval", label: tKey("Client approval") },
  { id: "approved", label: tKey("Approved") },
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
export const designStateLabels: Record<string, MessageKey> = {
  draft: tKey("Draft"),
  internal_review: tKey("Needs internal review"),
  internal_approved: tKey("Ready to send to client"),
  client_review: tKey("Awaiting client"),
  approved: tKey("Approved"),
  changes_requested: tKey("Changes requested"),
  rejected: tKey("Rejected"),
  expired: tKey("Review expired"),
  superseded: tKey("Superseded"),
  no_file: tKey("File needed"),
};
export const designTabHints: Record<DesignTab, MessageKey> = {
  designs:
    tKey("All your design files, organized by room or item. Files stay here through every review."),
  "internal-approval":
    tKey("Review submitted files, then send internally approved revisions to the client."),
  "client-approval":
    tKey("Shared with the client. Their portal decision updates the file here automatically."),
  approved:
    tKey("Latest revisions approved by the client. Earlier decisions remain in each file’s history."),
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
