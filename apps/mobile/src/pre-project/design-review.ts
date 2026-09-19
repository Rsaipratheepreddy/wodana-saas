import type { CaseDesign } from "../../../web/lib/pre-project/content";

export function assignedDesignReviews(items: CaseDesign[], actorId: string) {
  return items.filter((design) => {
    const latest = design.versions[0];
    return (
      !design.archivedAt &&
      latest?.status === "internal_review" &&
      latest.reviewerId === actorId
    );
  });
}
