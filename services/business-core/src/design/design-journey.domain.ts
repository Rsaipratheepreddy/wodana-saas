export type JourneyStage = "inspiration" | "kickoff" | "site_visit" | "moodboards" | "concepts" | "space_planning" | "material_selection" | "renders" | "samples" | "final_render" | "approval";
export type StageStatus = "locked" | "active" | "done";
/** `design`: a design package after Won (PLM-047–053). `site_and_materials`: a furniture/joinery order's site visit and material selection (PLM-080/081). */
export type JourneyKind = "design" | "site_and_materials";

export const STAGE_LABELS: Record<JourneyStage, string> = {
  inspiration: "Inspiration", kickoff: "Kick-off meeting", site_visit: "Site visit", moodboards: "Mood boards", concepts: "Concepts", space_planning: "Space planning",
  material_selection: "Material selection", renders: "Renders", samples: "Samples", final_render: "Final render", approval: "Design approval",
};

/**
 * The order a design journey runs in. 3 (guide steps 1–11, agreed 16 Oct 2026): inspiration, the kick-off meeting
 * (the design site measure due within days of it), mood boards (two options, the client chooses), space planning (a PDF,
 * no client approval, after the site measure), the 2D concept, 3D renders when the package has them, the material
 * selection on jobs that include it, a final render only when the client asks for one, the design approval. 2 (13 Oct):
 * inspiration, kick-off, concept, renders, samples, approval. 1: the order before (site visit, concepts, space planning,
 * material selection, renders). A journey keeps the order it started in to the end.
 */
export type FlowVersion = 1 | 2 | 3;
export const CURRENT_FLOW: FlowVersion = 3;
/** Orders that count the team's days on the firm's working calendar, with the design team allocated at the start. */
export const isCurrentOrder = (flow: number | null | undefined) => Number(flow) >= 2;

/**
 * The stages a package includes, in order. Renders only when the package offers them; on the current order the material
 * selection only when the job includes it (the firm's job areas), and the final render only after renders and samples.
 */
export function journeyStages(pkg: { includesSpacePlanning: boolean; includesRenders: boolean; materialSelection?: boolean }, flow: FlowVersion = CURRENT_FLOW): JourneyStage[] {
  if (flow === 1) return ["inspiration", "site_visit", "concepts", ...(pkg.includesSpacePlanning ? ["space_planning" as const] : []),
    "material_selection", ...(pkg.includesRenders ? ["renders" as const] : []), "approval"];
  if (flow === 2) return ["inspiration", "kickoff", "concepts", ...(pkg.includesRenders ? ["renders" as const] : []), "samples", "approval"];
  const samples = pkg.materialSelection !== false;
  return ["inspiration", "kickoff", "moodboards", "space_planning", "concepts", ...(pkg.includesRenders ? ["renders" as const] : []),
    ...(samples ? ["samples" as const] : []), ...(samples && pkg.includesRenders ? ["final_render" as const] : []), "approval"];
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
export const DESIGN_DEADLINE_STAGES: JourneyStage[] = ["moodboards", "concepts", "space_planning", "renders", "final_render"];

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
  const current = isCurrentOrder(timings.flowVersion);
  const due = context.due ?? addDays;
  if (stage === "site_visit") return { dueAt: addHours(now, timings.siteVisitHours), clientDueAt: null, bookingReminderAt: null };
  // PLM-140: the kick-off is booked and held within its days of inspiration ending.
  if (stage === "kickoff") return { dueAt: due(now, timings.kickoffDays ?? 5), clientDueAt: null, bookingReminderAt: null };
  // Guide step 5: the mood boards follow the kick-off within the concept days.
  if (stage === "moodboards" && timings.flowVersion === 3) {
    const base = context.kickoffAt && context.kickoffAt.getTime() < now.getTime() ? context.kickoffAt : now;
    return { dueAt: due(base, timings.conceptDays ?? 7), clientDueAt: context.developmentDays ? addDays(base, context.developmentDays) : null, bookingReminderAt: null };
  }
  if (stage === "concepts" && current && timings.flowVersion !== 3) {
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

/**
 * A question on the site visit list; `scope` groups it (PLM-154: "Kitchen", "Bedrooms"), none for the general ones.
 * `section` heads and orders the general questions ("Project overview"); it never takes part in room matching.
 * `kind: "check"` is a checklist line answered with a status (confirmed, pending, not applicable) and a note.
 */
export type SiteQuestion = {
  key: string; question: string; scope?: string | null; section?: string | null; kind?: "answer" | "check" | null;
  /** Answering it is needed to complete the visit. Questions are optional unless the firm marks them required (§0.3 P0). */
  required?: boolean;
};

/** A checklist line's status; pending is an open item. */
export const CHECK_STATUSES = ["confirmed", "pending", "not_applicable"] as const;
export type CheckStatus = (typeof CHECK_STATUSES)[number];
export const isCheckStatus = (value: unknown): value is CheckStatus => typeof value === "string" && (CHECK_STATUSES as readonly string[]).includes(value);

/**
 * A scope's match words: the words or phrases in a room, area or quotation line name that make the scope's checklist
 * apply to a job ("Wardrobes and walk in closets": wardrobe, closet, walk-in, dressing). `everyJob` applies it to every
 * job (e.g. a release record). Without match words the scope's own name is matched.
 */
export type ChecklistScope = { scope: string; match: string[]; everyJob?: boolean };

/** How many questions a list holds (the general questions and every checklist line). */
export const MAX_SITE_QUESTIONS = 300;
export const MAX_CHECKLIST_SCOPES = 60;

const oneLine = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");

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

/**
 * The workspace's question list as stored (configuration JSON): well-formed entries only, no duplicates, at most
 * MAX_SITE_QUESTIONS. A question keeps its scope, section and kind only when it has them.
 */
export function normaliseSiteQuestions(value: unknown): SiteQuestion[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: SiteQuestion[] = [];
  for (const item of value) {
    const key = typeof (item as SiteQuestion)?.key === "string" ? (item as SiteQuestion).key.trim().slice(0, 60) : "";
    const question = typeof (item as SiteQuestion)?.question === "string" ? (item as SiteQuestion).question.trim().slice(0, 500) : "";
    if (!key || !question || seen.has(key)) continue;
    seen.add(key);
    const scope = oneLine((item as SiteQuestion)?.scope, 60);
    const section = oneLine((item as SiteQuestion)?.section, 60);
    out.push({ key, question, ...(scope ? { scope } : {}), ...(section ? { section } : {}), ...((item as SiteQuestion)?.kind === "check" ? { kind: "check" as const } : {}),
      ...((item as SiteQuestion)?.required === true ? { required: true } : {}) });
    if (out.length === MAX_SITE_QUESTIONS) break;
  }
  return out;
}

/** The scopes' match words as stored: one entry per scope (case-insensitive), each with at most 20 words or phrases. */
export function normaliseChecklistScopes(value: unknown): ChecklistScope[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: ChecklistScope[] = [];
  for (const item of value) {
    const scope = oneLine((item as ChecklistScope)?.scope, 60);
    if (!scope || seen.has(scope.toLowerCase())) continue;
    seen.add(scope.toLowerCase());
    const words = new Map<string, string>();
    for (const word of Array.isArray((item as ChecklistScope)?.match) ? (item as ChecklistScope).match : []) {
      const text = oneLine(word, 40);
      if (text && matchTokens(text).length && !words.has(text.toLowerCase())) words.set(text.toLowerCase(), text);
    }
    out.push({ scope, match: [...words.values()].slice(0, 20), ...((item as ChecklistScope)?.everyJob === true ? { everyJob: true } : {}) });
    if (out.length === MAX_CHECKLIST_SCOPES) break;
  }
  return out;
}

const singular = (word: string) => word.replace(/(ies)$/, "y").replace(/s$/, "");
const scopeWords = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((word) => word.length > 2)
  .map(singular);
/** Words of a name for the match words: accents dropped, hyphens and punctuation as spaces, two letters or more ("TV"). */
const matchTokens = (value: string) => value.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/)
  .filter((word) => word.length > 1).map(singular);

/** Whether a scope ("Kitchen", "Bedrooms") is one of the job's areas ("Main kitchen", "Bedroom 2"): a word in common, singular or plural. */
export function scopeMatches(scope: string, areas: readonly string[]) {
  const wanted = new Set(scopeWords(scope));
  return areas.some((area) => scopeWords(area).some((word) => wanted.has(word)));
}

/**
 * Whether a scope applies to the names given (the job's rooms, areas and quotation lines, or a work order): one of its
 * match words or phrases is in a name, every word of a phrase in the same name ("walk-in" in "Walk-in closet"), singular
 * or plural. Without match words the scope's own name is matched (scopeMatches).
 */
export function checklistMatches(scope: string, match: readonly string[], areas: readonly string[]) {
  if (!match.length) return scopeMatches(scope, areas);
  const phrases = match.map(matchTokens).filter((words) => words.length);
  return areas.some((area) => {
    const words = new Set(matchTokens(area));
    return phrases.some((phrase) => phrase.every((word) => words.has(word)));
  });
}

export type SiteQuestionGroup = {
  scope: string | null;
  /** The heading of a group of general questions; null for a scope's checklist and for general questions without one. */
  section: string | null;
  /** The job's names match the scope (always for general questions and for a scope that applies to every job). */
  matches: boolean;
  /** A scope for every job (e.g. the release record). */
  everyJob: boolean;
  /** The designer's choice on this job ("Applies to this job"), null while it follows the matching. */
  chosen: boolean | null;
  /** Asked on this job: the choice, else the matching. */
  applies: boolean;
  required: boolean;
  questions: SiteQuestion[];
};
export type GroupOptions = { scopes?: readonly ChecklistScope[]; chosen?: ReadonlyMap<string, boolean> };

/** A scope's key for choices and lookups: its name, case-insensitive. */
export const scopeKey = (scope: string) => scope.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * PLM-154: the list grouped for the kick-off and the site measure. The general questions (no scope) come first, by
 * section in the order the list gives them; then the checklists that apply to the job; then the rest.
 * A scope applies when the designer chose it for the job ("Applies to this job"), else when it matches the job's rooms,
 * areas and quotation lines (its match words, or its name), or is for every job. Any other checklist is off until the
 * designer switches it on, so a job with no rooms yet asks only the general questions and the every-job checklists.
 * The general questions and the checklists that apply are asked (`required` on a group means asked on this job); the rest
 * are shown, not asked. Within what is asked, only questions marked required block completing the visit.
 */
export function groupSiteQuestions(questions: SiteQuestion[], areas: readonly string[], options: GroupOptions = {}): SiteQuestionGroup[] {
  const definitions = new Map((options.scopes ?? []).map((entry) => [scopeKey(entry.scope), entry]));
  const groups = new Map<string, SiteQuestionGroup>();
  for (const question of questions) {
    const scope = question.scope?.trim() || null;
    const section = scope ? null : question.section?.trim() || null;
    const id = scope ? `scope:${scopeKey(scope)}` : `section:${section?.toLowerCase() ?? ""}`;
    let group = groups.get(id);
    if (!group) {
      const definition = scope ? definitions.get(scopeKey(scope)) : undefined;
      const everyJob = Boolean(definition?.everyJob);
      group = { scope, section, everyJob, matches: scope === null || everyJob || checklistMatches(scope, definition?.match ?? [], areas),
        chosen: scope ? options.chosen?.get(scopeKey(scope)) ?? null : null, applies: true, required: true, questions: [] };
      groups.set(id, group);
    }
    group.questions.push(question);
  }
  const list = [...groups.values()];
  for (const group of list) {
    group.applies = group.scope === null || (group.chosen ?? (group.everyJob || group.matches));
    group.required = group.applies;
  }
  const rank = (group: SiteQuestionGroup) => (group.scope === null ? 0 : group.applies ? 1 : 2);
  return list.map((group, index) => ({ group, index })).sort((a, b) => rank(a.group) - rank(b.group) || a.index - b.index).map(({ group }) => group);
}

/** The questions a visit asks: the general ones and those of the checklists that apply to the job. */
export const askedSiteQuestions = (questions: SiteQuestion[], areas: readonly string[], options: GroupOptions = {}) =>
  groupSiteQuestions(questions, areas, options).filter((group) => group.required).flatMap((group) => group.questions);

/** The asked questions a visit must answer before it completes: those the firm marked required. */
export const requiredSiteQuestions = (questions: SiteQuestion[], areas: readonly string[], options: GroupOptions = {}) =>
  askedSiteQuestions(questions, areas, options).filter((question) => question.required === true);

/**
 * PLM-128: the visit also needs every question on the list answered, and every checklist line marked. A line marked
 * pending counts: it is recorded as an open item (the answer rule never judges what an answer says either).
 */
export function siteChecklistProblem(questions: SiteQuestion[], answered: string[]) {
  const left = questions.filter((question) => !answered.includes(question.key));
  if (!left.length) return null;
  const checks = left.filter((question) => question.kind === "check").length;
  const open = left.length - checks;
  const ask = open === 1 ? "Answer the last site visit question" : `Answer the ${open} site visit questions left`;
  const mark = checks === 1 ? "mark the last check" : `mark the ${checks} checks left`;
  if (!checks) return ask;
  if (!open) return `${mark.charAt(0).toUpperCase()}${mark.slice(1)}`;
  return `${ask} and ${mark}`;
}

/** The open items of a job: the pending lines of the checklists that apply to it. */
export function pendingChecks(groups: readonly SiteQuestionGroup[], status: (key: string) => CheckStatus | null | undefined) {
  return groups.filter((group) => group.applies).flatMap((group) => group.questions).filter((question) => question.kind === "check" && status(question.key) === "pending").length;
}

/**
 * The checklists a work order is made to: the scopes that apply to the job and match the order's own names (its
 * item, package and room), plus those for every job. When none of the job's checklists matches the order, all of the
 * job's checklists are shown, so the factory never misses one.
 */
export function workOrderChecklists(groups: readonly SiteQuestionGroup[], scopes: readonly ChecklistScope[], names: readonly string[]) {
  const checklists = groups.filter((group) => group.scope !== null && group.applies);
  const definitions = new Map(scopes.map((entry) => [scopeKey(entry.scope), entry]));
  const matching = checklists.filter((group) => !group.everyJob && checklistMatches(group.scope!, definitions.get(scopeKey(group.scope!))?.match ?? [], names));
  return matching.length ? checklists.filter((group) => group.everyJob || matching.includes(group)) : checklists;
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
