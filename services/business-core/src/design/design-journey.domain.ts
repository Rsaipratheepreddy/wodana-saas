export type JourneyStage = "inspiration" | "kickoff" | "site_visit" | "concepts" | "space_planning" | "material_selection" | "renders" | "samples" | "approval";
export type StageStatus = "locked" | "active" | "done";
/** `design`: a design package after Won (PLM-047–053). `site_and_materials`: a furniture/joinery order's site visit and material selection (PLM-080/081). */
export type JourneyKind = "design" | "site_and_materials";

export const STAGE_LABELS: Record<JourneyStage, string> = {
  inspiration: "Inspiration", kickoff: "Kick-off meeting", site_visit: "Site visit", concepts: "Concepts", space_planning: "Space planning",
  material_selection: "Material selection", renders: "Renders", samples: "Samples", approval: "Design approval",
};

/**
 * The order a design journey runs in. 2 (from 13 Oct 2026, PLM-140–144): inspiration, the kick-off meeting, the concept
 * (the layout to scale for every package, with the design site measure inside it), renders when the package has them,
 * samples, the design approval. 1: the order before it (site visit, concepts, space planning, material selection,
 * renders); journeys started under it keep it to the end.
 */
export type FlowVersion = 1 | 2;
export const CURRENT_FLOW: FlowVersion = 2;

/** The stages a package includes, in order. Renders only when the package offers them (and, in the old order, space planning). */
export function journeyStages(pkg: { includesSpacePlanning: boolean; includesRenders: boolean }, flow: FlowVersion = CURRENT_FLOW): JourneyStage[] {
  if (flow === 1) return ["inspiration", "site_visit", "concepts", ...(pkg.includesSpacePlanning ? ["space_planning" as const] : []),
    "material_selection", ...(pkg.includesRenders ? ["renders" as const] : []), "approval"];
  return ["inspiration", "kickoff", "concepts", ...(pkg.includesRenders ? ["renders" as const] : []), "samples", "approval"];
}

/**
 * Work inside a step with its own owner, deadline and done-check (PLM-151, PLM-141, PLM-144): the design team chosen
 * once the fee is paid (during inspiration), the design site measure (during the concept) and the sample collection
 * (the first half of samples). PLM-146: once the samples are approved, the designer marks the exact finishes on the
 * render snapshots and sends them to QS (during the design approval).
 */
export type JourneyTask = "team_allocation" | "site_measure" | "sample_collection" | "finishes_to_qs";
export const TASK_LABELS: Record<JourneyTask, string> = {
  team_allocation: "Design team", site_measure: "Design site measure", sample_collection: "Sample collection", finishes_to_qs: "Finishes to QS",
};
export const TASK_STAGE: Record<JourneyTask, JourneyStage> = { team_allocation: "inspiration", site_measure: "concepts", sample_collection: "samples", finishes_to_qs: "approval" };

/** The stage holding the materials list: samples in the current order, material selection in the old one and on a furniture/joinery order. */
export const MATERIAL_STAGES: readonly JourneyStage[] = ["material_selection", "samples"];

/**
 * PLM-142: the client-facing design development window grows with the rooms in scope, between a minimum and a maximum
 * (Palm: 2 to 8 weeks). With no rooms recorded yet it is the minimum.
 */
export function developmentWindowDays(rooms: number, window: { minDays: number; maxDays: number; daysPerRoom: number }) {
  const wanted = Math.max(rooms, 0) * window.daysPerRoom;
  return Math.min(Math.max(wanted, window.minDays), Math.max(window.maxDays, window.minDays));
}

/** A YYYY-MM-DD calendar day that exists. */
export const isCalendarDay = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);

/**
 * PLM-140: the kick-off is done once its meeting has taken place; when the package has renders, the client-facing render
 * sign-off date agreed there is recorded with it (a day after today in the firm's time zone).
 */
export function kickoffProblem(input: { scheduledAt: Date | null; now: Date; includesRenders: boolean; renderSignoffOn: string | null | undefined; today: string }) {
  if (!input.scheduledAt) return "Book the kick-off meeting first";
  if (input.scheduledAt.getTime() > input.now.getTime()) return "The kick-off meeting hasn't taken place yet";
  if (!input.includesRenders) return null;
  if (!input.renderSignoffOn) return "Enter the render sign-off date agreed with the client";
  if (!isCalendarDay(input.renderSignoffOn)) return "Enter the render sign-off date agreed with the client";
  if (input.renderSignoffOn <= input.today) return "The render sign-off date is after today";
  return null;
}

/** PLM-143: the client's render sign-off: the day they signed (not after today), who signed and the signed file. */
export function renderSignOffProblem(input: { signedOn?: string | null; assetId?: string | null; signer?: string | null }, today: string) {
  if (!isCalendarDay(input.signedOn)) return "Enter the day the client signed off the renders";
  if (input.signedOn > today) return "The sign-off date can't be in the future";
  if (!input.signer?.trim()) return "Say who signed off the renders";
  if (!input.assetId) return "Attach the client's render sign-off";
  return null;
}

/**
 * PLM-144: samples are approved once the samples are collected, the sample meeting has taken place, every material on
 * the list is confirmed by the client and no material from a local supplier is still waiting for its sign-off.
 */
export function samplesProblem(input: { collected: boolean; meetingAt: Date | null; now: Date; materials: number; waiting: string[]; outsourcedWaiting: string[] }) {
  if (!input.collected) return "Collect the samples first";
  if (!input.meetingAt) return "Book the sample meeting first";
  if (input.meetingAt.getTime() > input.now.getTime()) return "The sample meeting hasn't taken place yet";
  if (!input.materials) return "Add the materials to the list first";
  const names = (list: string[]) => `${list.slice(0, 3).join(", ")}${list.length > 3 ? ` and ${list.length - 3} more` : ""}`;
  if (input.waiting.length) return `Waiting for the client's confirmation: ${names(input.waiting)}`;
  if (input.outsourcedWaiting.length) return `Waiting for the sign-off of the outsourced ${input.outsourcedWaiting.length === 1 ? "material" : "materials"}: ${names(input.outsourcedWaiting)}`;
  return null;
}

/** PLM-080/081: an order without a design package measures the site, then chooses materials (or records "Not required"). */
export const SITE_AND_MATERIALS_STAGES: JourneyStage[] = ["site_visit", "material_selection"];

export function nextStage(order: JourneyStage[], current: JourneyStage): JourneyStage | null {
  const index = order.indexOf(current);
  return index >= 0 && index < order.length - 1 ? order[index + 1] : null;
}

export const addDays = (from: Date, days: number) => new Date(from.getTime() + days * 86_400_000);
export const addHours = (from: Date, hours: number) => new Date(from.getTime() + hours * 3_600_000);
/** How a step's deadline counts its days from a moment (calendar days, or the firm's working days). */
export type DueRule = (from: Date, days: number) => Date;

/** Stages with a design deadline: internal (the team's) and client-facing (what the client was promised) run separately (PLM-049/051). */
export const DESIGN_DEADLINE_STAGES: JourneyStage[] = ["concepts", "space_planning", "renders"];

export type StageTimings = {
  siteVisitHours: number; designInternalDays: number; designClientDays: number; materialSelectionDays: number;
  /** The renders' own deadlines (internal and client-facing); null follows the design days. */
  renderInternalDays?: number | null; renderClientDays?: number | null;
  /** The current order (PLM-140–144); absent on journeys of the old one. */
  flowVersion?: FlowVersion; kickoffDays?: number; conceptDays?: number; sampleCollectionDays?: number; sampleMeetingDays?: number;
};

/**
 * The internal deadline, the client-facing one and the booking reminder a stage starts with. `context` carries what the
 * current order counts from: the kick-off meeting (the concept), the client-facing window it set, and the render
 * sign-off day agreed with the client. `context.due` counts the team's own deadlines: the firm's working days, due at the
 * end of the working day, on journeys of the current order (the store passes it); calendar days without it. The
 * client-facing windows stay calendar days.
 */
export function stageDeadlines(stage: JourneyStage, now: Date, timings: StageTimings,
  context: { kickoffAt?: Date | null; developmentDays?: number | null; renderSignoffDueOn?: string | null; due?: DueRule } = {}):
  { dueAt: Date | null; clientDueAt: Date | null; bookingReminderAt: Date | null } {
  const current = timings.flowVersion === 2;
  const due = context.due ?? addDays;
  if (stage === "site_visit") return { dueAt: addHours(now, timings.siteVisitHours), clientDueAt: null, bookingReminderAt: null };
  // PLM-140: the kick-off is booked and held within its days of inspiration ending.
  if (stage === "kickoff") return { dueAt: due(now, timings.kickoffDays ?? 5), clientDueAt: null, bookingReminderAt: null };
  if (stage === "concepts" && current) {
    // PLM-142: the first concept 4–7 days after the kick-off (the firm's days); the client was promised the development window.
    const base = context.kickoffAt && context.kickoffAt.getTime() < now.getTime() ? context.kickoffAt : now;
    return { dueAt: due(base, timings.conceptDays ?? 7), clientDueAt: context.developmentDays ? addDays(base, context.developmentDays) : null, bookingReminderAt: null };
  }
  if (stage === "renders") {
    const agreed = current && isCalendarDay(context.renderSignoffDueOn) ? new Date(`${context.renderSignoffDueOn}T12:00:00Z`) : null;
    return { dueAt: due(now, timings.renderInternalDays ?? timings.designInternalDays), clientDueAt: agreed ?? addDays(now, timings.renderClientDays ?? timings.designClientDays),
      bookingReminderAt: null };
  }
  if (DESIGN_DEADLINE_STAGES.includes(stage)) return { dueAt: due(now, timings.designInternalDays), clientDueAt: addDays(now, timings.designClientDays), bookingReminderAt: null };
  // PLM-050: a week for the showroom appointment; the reminder to book it starts straight away and repeats daily until booked.
  if (stage === "material_selection") return { dueAt: due(now, timings.materialSelectionDays), clientDueAt: null, bookingReminderAt: now };
  // PLM-144: samples collected within their week, the sample meeting the week after; the reminder to book it starts when collection is due.
  if (stage === "samples") {
    const collection = timings.sampleCollectionDays ?? 7;
    return { dueAt: due(now, collection + (timings.sampleMeetingDays ?? 7)), clientDueAt: null, bookingReminderAt: due(now, collection) };
  }
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

/** A question on the site visit list; `scope` groups it (PLM-154: "Kitchen", "Bedrooms"), none for the general ones. */
export type SiteQuestion = { key: string; question: string; scope?: string | null };

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

/** The workspace's question list as stored (configuration JSON): well-formed entries only, no duplicates, at most 80. */
export function normaliseSiteQuestions(value: unknown): SiteQuestion[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: SiteQuestion[] = [];
  for (const item of value) {
    const key = typeof (item as SiteQuestion)?.key === "string" ? (item as SiteQuestion).key.trim().slice(0, 60) : "";
    const question = typeof (item as SiteQuestion)?.question === "string" ? (item as SiteQuestion).question.trim().slice(0, 500) : "";
    if (!key || !question || seen.has(key)) continue;
    seen.add(key);
    const scope = typeof (item as SiteQuestion)?.scope === "string" ? (item as SiteQuestion).scope!.replace(/\s+/g, " ").trim().slice(0, 60) : "";
    out.push(scope ? { key, question, scope } : { key, question });
    if (out.length === 80) break;
  }
  return out;
}

const scopeWords = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((word) => word.length > 2)
  .map((word) => word.replace(/(ies)$/, "y").replace(/s$/, ""));

/** Whether a scope ("Kitchen", "Bedrooms") is one of the job's areas ("Main kitchen", "Bedroom 2"): a word in common, singular or plural. */
export function scopeMatches(scope: string, areas: readonly string[]) {
  const wanted = new Set(scopeWords(scope));
  return areas.some((area) => scopeWords(area).some((word) => wanted.has(word)));
}

export type SiteQuestionGroup = { scope: string | null; matches: boolean; required: boolean; questions: SiteQuestion[] };

/**
 * PLM-154: the list grouped by scope for the kick-off and the site measure. The general questions (no scope) come first,
 * then the scopes the job has (its rooms and areas), then the rest. With no areas recorded, or none matching, every
 * group is asked; otherwise a scope the job doesn't have is shown but not required. A list without scopes is one group.
 */
export function groupSiteQuestions(questions: SiteQuestion[], areas: readonly string[]): SiteQuestionGroup[] {
  const groups = new Map<string, SiteQuestionGroup>();
  for (const question of questions) {
    const scope = question.scope?.trim() || null;
    const id = scope ? scope.toLowerCase() : "";
    const group = groups.get(id) ?? { scope, matches: scope === null || scopeMatches(scope, areas), required: true, questions: [] };
    group.questions.push(question);
    groups.set(id, group);
  }
  const list = [...groups.values()];
  const known = list.some((group) => group.scope !== null && group.matches);
  for (const group of list) group.required = group.scope === null || !known || group.matches;
  const rank = (group: SiteQuestionGroup) => (group.scope === null ? 0 : group.matches ? 1 : 2);
  return list.map((group, index) => ({ group, index })).sort((a, b) => rank(a.group) - rank(b.group) || a.index - b.index).map(({ group }) => group);
}

/** The questions a visit must answer: the general ones and those of the job's scopes (all of them when its scope isn't known). */
export const requiredSiteQuestions = (questions: SiteQuestion[], areas: readonly string[]) =>
  groupSiteQuestions(questions, areas).filter((group) => group.required).flatMap((group) => group.questions);

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
