export type JourneyStage = "inspiration" | "site_visit" | "concepts" | "space_planning" | "material_selection" | "renders" | "approval";
export type StageStatus = "locked" | "active" | "done";
/** `design`: a design package after Won (PLM-047–053). `site_and_materials`: a furniture/joinery order's site visit and material selection (PLM-080/081). */
export type JourneyKind = "design" | "site_and_materials";

export const STAGE_LABELS: Record<JourneyStage, string> = {
  inspiration: "Inspiration", site_visit: "Site visit", concepts: "Concepts", space_planning: "Space planning",
  material_selection: "Material selection", renders: "3D renders", approval: "Design approval",
};

/** The stages a package includes, in order. Space planning and renders only when the package offers them. */
export function journeyStages(pkg: { includesSpacePlanning: boolean; includesRenders: boolean }): JourneyStage[] {
  return ["inspiration", "site_visit", "concepts", ...(pkg.includesSpacePlanning ? ["space_planning" as const] : []),
    "material_selection", ...(pkg.includesRenders ? ["renders" as const] : []), "approval"];
}

/** PLM-080/081: an order without a design package measures the site, then chooses materials (or records "Not required"). */
export const SITE_AND_MATERIALS_STAGES: JourneyStage[] = ["site_visit", "material_selection"];

export function nextStage(order: JourneyStage[], current: JourneyStage): JourneyStage | null {
  const index = order.indexOf(current);
  return index >= 0 && index < order.length - 1 ? order[index + 1] : null;
}

export const addDays = (from: Date, days: number) => new Date(from.getTime() + days * 86_400_000);
export const addHours = (from: Date, hours: number) => new Date(from.getTime() + hours * 3_600_000);

/** Stages with a design deadline: internal (the team's) and client-facing (what the client was promised) run separately (PLM-049/051). */
export const DESIGN_DEADLINE_STAGES: JourneyStage[] = ["concepts", "space_planning", "renders"];

export type StageTimings = { siteVisitHours: number; designInternalDays: number; designClientDays: number; materialSelectionDays: number };

/** The internal deadline, the client-facing one and the booking reminder a stage starts with. */
export function stageDeadlines(stage: JourneyStage, now: Date, timings: StageTimings): { dueAt: Date | null; clientDueAt: Date | null; bookingReminderAt: Date | null } {
  if (stage === "site_visit") return { dueAt: addHours(now, timings.siteVisitHours), clientDueAt: null, bookingReminderAt: null };
  if (DESIGN_DEADLINE_STAGES.includes(stage)) return { dueAt: addDays(now, timings.designInternalDays), clientDueAt: addDays(now, timings.designClientDays), bookingReminderAt: null };
  // PLM-050: a week for the showroom appointment; the reminder to book it starts straight away and repeats daily until booked.
  if (stage === "material_selection") return { dueAt: addDays(now, timings.materialSelectionDays), clientDueAt: null, bookingReminderAt: now };
  return { dueAt: null, clientDueAt: null, bookingReminderAt: null };
}

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

export type SiteQuestion = { key: string; question: string };

/** The question list a workspace starts with (the same as the settings column default); each firm edits its own. */
export const DEFAULT_SITE_VISIT_QUESTIONS: SiteQuestion[] = [
  { key: "access", question: "How do we get in: access, parking and delivery route?" },
  { key: "services", question: "Where are the electrical, water and drainage points?" },
  { key: "ceiling", question: "Ceiling heights and any beams, bulkheads or AC units?" },
  { key: "floors", question: "Floor levels, finishes and anything to protect or remove?" },
  { key: "existing", question: "What stays, what goes, and what is the client keeping?" },
  { key: "constraints", question: "Building rules, working hours and permits to respect?" },
  { key: "wishes", question: "Anything the client asked for on site that is not in the brief?" },
];

/** The workspace's question list as stored (configuration JSON): well-formed entries only, no duplicates, at most 40. */
export function normaliseSiteQuestions(value: unknown): SiteQuestion[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: SiteQuestion[] = [];
  for (const item of value) {
    const key = typeof (item as SiteQuestion)?.key === "string" ? (item as SiteQuestion).key.trim().slice(0, 60) : "";
    const question = typeof (item as SiteQuestion)?.question === "string" ? (item as SiteQuestion).question.trim().slice(0, 500) : "";
    if (!key || !question || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, question });
    if (out.length === 40) break;
  }
  return out;
}

/** PLM-128: the visit also needs every question on the list answered. */
export function siteChecklistProblem(questions: SiteQuestion[], answered: string[]) {
  const left = questions.filter((question) => !answered.includes(question.key));
  if (!left.length) return null;
  return left.length === 1 ? "Answer the last site visit question" : `Answer the ${left.length} site visit questions left`;
}

/**
 * PLM-049/051: a stage's revision counter. A round is one client presentation; the first is the design itself
 * and every later round is a revision. The package includes a number of revisions (Palm: 2); the next one is
 * chargeable and flagged to Sales before the work starts.
 */
export function stageRevisions(rounds: number, includedRevisions: number) {
  const used = Math.max(rounds - 1, 0);
  return { used, included: includedRevisions, chargeable: used > includedRevisions };
}

/** Whether presenting round `round` of a stage is a chargeable revision. */
export const roundChargeable = (round: number, includedRevisions: number) => round - 1 > includedRevisions;

/** The client's decision on a presentation, staff-recorded or from the portal, always with where it came from. */
export const DECISION_SOURCES = ["portal", "meeting", "whatsapp", "email", "phone"] as const;
export type DecisionSource = (typeof DECISION_SOURCES)[number];

/** A concept option shown as a card: an uploaded design or an https link (a Canva board), never both. */
export function optionProblem(option: { title?: string | null; designId?: string | null; linkUrl?: string | null }) {
  if (!option.title?.trim()) return "Give each option a title";
  if (Boolean(option.designId) === Boolean(option.linkUrl)) return "Attach a file or a link to each option";
  if (option.linkUrl) {
    try { if (new URL(option.linkUrl).protocol !== "https:") return "Use an https link"; } catch { return "Use an https link"; }
  }
  return null;
}

export const APPROVAL_METHODS = ["portal", "signed_document", "email", "in_person", "message"] as const;

/**
 * PLM-053: the design approval is recorded with the day the client signed (a calendar day in the firm's time
 * zone, not after today there), who signed, and the signed file.
 */
export function approvalProblem(input: { approvedOn?: string | null; assetId?: string | null; signer?: string | null }, today: string) {
  if (!input.approvedOn || !/^\d{4}-\d{2}-\d{2}$/.test(input.approvedOn) || Number.isNaN(Date.parse(input.approvedOn))) return "Enter the day the client approved the design";
  if (input.approvedOn > today) return "The approval date can't be in the future";
  if (!input.signer?.trim()) return "Say who signed the approval";
  if (!input.assetId) return "Attach the client's signed approval";
  return null;
}
