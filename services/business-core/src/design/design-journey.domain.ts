export type JourneyStage = "inspiration" | "site_visit" | "concepts" | "space_planning" | "material_selection" | "renders" | "approval";
export type StageStatus = "locked" | "active" | "done";

export const STAGE_LABELS: Record<JourneyStage, string> = {
  inspiration: "Inspiration", site_visit: "Site visit", concepts: "Concepts", space_planning: "Space planning",
  material_selection: "Material selection", renders: "3D renders", approval: "Design approval",
};

/** The stages a package includes, in order. Space planning and renders only when the package offers them. */
export function journeyStages(pkg: { includesSpacePlanning: boolean; includesRenders: boolean }): JourneyStage[] {
  return ["inspiration", "site_visit", "concepts", ...(pkg.includesSpacePlanning ? ["space_planning" as const] : []),
    "material_selection", ...(pkg.includesRenders ? ["renders" as const] : []), "approval"];
}

export function nextStage(order: JourneyStage[], current: JourneyStage): JourneyStage | null {
  const index = order.indexOf(current);
  return index >= 0 && index < order.length - 1 ? order[index + 1] : null;
}

export const addDays = (from: Date, days: number) => new Date(from.getTime() + days * 86_400_000);
export const addHours = (from: Date, hours: number) => new Date(from.getTime() + hours * 3_600_000);

/**
 * PLM-048: the site visit can be completed only when every measurement set is measured and each has
 * at least one photo or drawing, and there is at least one.
 */
export function siteEvidenceProblem(measurements: Array<{ title: string; status: string; files: number }>) {
  if (!measurements.length) return "Record the measurements and photos from the visit first";
  const unmeasured = measurements.filter((item) => !["measured", "verified"].includes(item.status));
  if (unmeasured.length) return `Finish the measurements for ${unmeasured.map((item) => item.title).join(", ")}`;
  const bare = measurements.filter((item) => item.files < 1);
  if (bare.length) return `Add a photo for ${bare.map((item) => item.title).join(", ")}`;
  return null;
}
