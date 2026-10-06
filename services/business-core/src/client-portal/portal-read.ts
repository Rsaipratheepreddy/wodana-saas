import { Dec } from "../catalog-core/decimal";
import { projectBalance } from "../project-core/project-milestones";
import { readProgress as readWorkProgress } from "../project-core/project-work";
import type { PoolClient } from "pg";
import { commercialRepository } from "../commercial/commercial-repository";
import type { CommercialData } from "../commercial/commercial.types";
import type { Grant, PortalContact } from "./portal-auth";
import { readDesignReview } from "./portal-design";
import { ASSUME_PRESENT, readAttachments, type FilePresence } from "./portal-files";
import { readIssues } from "./portal-issues";
import { readMessages } from "./portal-messages";
import { readMoodboard, takesIdeas } from "./portal-moodboard";
import { readDesignChoices } from "./portal-design-decisions";
import { readPayments } from "./portal-payments";
import { portalQuote } from "./portal-quote";
import { portalQuoteExtras } from "../proposals/proposal-data";
import { readClientSiteAccess } from "../site/site-access";
import { effectiveSections, readProjectAccess, type PortalSettings, type Section, type Sections } from "./portal-settings";
import { readBudget } from "./portal-budget";
import { readPortalChanges } from "./portal-changes";
import { feedCards, whatChanged } from "./portal-feed";
import { readUpdatePreference } from "./portal-updates";

type Db = Pick<PoolClient, "query">;

/**
 * The client's view of their projects, built field by field from the records staff published. Nothing is
 * spread from an internal object: every value below is named. A hidden section is never sent (null), and a
 * paused project shows only that it's paused.
 */

type CaseRow = {
  caseId: string; caseStatus: string; title: string; projectId: string | null; projectName: string | null; reference: string | null; projectStatus: string | null;
  startedAt: string | null; startDate: string | null; promiseDate: string | null; completedOn: string | null; currency: string | null;
};

const IMAGE = /^image\/(png|jpeg|webp|gif)$/;

export async function workspaceToday(db: Db, workspaceId: string) {
  return (await db.query<{ today: string }>(`SELECT (now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::date::text AS today FROM workspaces WHERE id = $1`,
    [workspaceId])).rows[0].today;
}

export async function readCase(db: Db, workspaceId: string, caseId: string): Promise<CaseRow | undefined> {
  return (await db.query<CaseRow>(
    `SELECT pre_case.id AS "caseId", pre_case.status AS "caseStatus", opportunity.title, project.id AS "projectId", project.name AS "projectName",
            project.reference, project.status AS "projectStatus", project.started_at AS "startedAt", project.start_date::text AS "startDate",
            project.promise_date::text AS "promiseDate", trim(project.currency) AS currency,
            (project.completed_at AT TIME ZONE coalesce(nullif(workspace.default_timezone, ''), 'UTC'))::date::text AS "completedOn"
       FROM pre_project_cases pre_case
       JOIN workspaces workspace ON workspace.id = pre_case.workspace_id
       JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
       LEFT JOIN delivery_projects project ON project.workspace_id = pre_case.workspace_id AND project.case_id = pre_case.id AND project.started_at IS NOT NULL
                                           AND project.status <> 'archived'
      WHERE pre_case.workspace_id = $1 AND pre_case.id = $2`, [workspaceId, caseId])).rows[0];
}

/** `files` says which stored files are really there (a photo whose file is missing is left out, never shown broken). */
export async function readView(db: Db, workspaceId: string, contact: PortalContact, settings: PortalSettings, definitions: DefinitionSource,
  files: FilePresence = ASSUME_PRESENT, visits?: Map<string, string | null>) {
  const today = await workspaceToday(db, workspaceId);
  const projects = [];
  for (const grant of contact.grants) {
    const row = await readCase(db, workspaceId, grant.caseId);
    if (!row) continue;
    projects.push(await readProject(db, workspaceId, grant, row, settings, today, definitions, files, visits ? visits.get(grant.id) ?? null : undefined));
  }
  return { contact: { name: contact.name, nameConfirmed: contact.nameConfirmed, phone: contact.phone }, today, projects };
}

async function readProject(db: Db, workspaceId: string, grant: Grant, row: CaseRow, settings: PortalSettings, today: string, definitions: DefinitionSource,
  files: FilePresence, since?: string | null) {
  const access = row.projectId ? await readProjectAccess(db, workspaceId, row.projectId) : null;
  const sections = effectiveSections(settings, access);
  const started = Boolean(row.projectId);
  const running = started && ["active", "on_hold"].includes(row.projectStatus ?? "");
  const base = {
    id: row.caseId, title: row.projectName ?? row.title, reference: row.reference, role: grant.role,
    status: (row.projectStatus ?? "planning") as "planning" | "active" | "on_hold" | "completed" | "cancelled",
    paused: Boolean(access?.paused),
  };
  if (access?.paused) return { ...base, sections, manager: null, stage: null, handoverDate: null, handedOverOn: null, warrantyUntil: null, address: null, startDate: null,
    team: [] as PortalTeamMember[], rooms: [], next: [], unread: 0, latestUpdate: null, updates: null, progress: null, moodboard: null, decisions: null, payments: null, documents: null, warranty: null,
    messages: null, design: null, choices: null, changes: null, budget: null, feed: [], digest: null };
  const commercial = await loadCommercial(db, workspaceId, row.caseId);
  const on = (section: Section) => sections[section];
  const progress = started && on("progress") ? await readProgress(db, workspaceId, row, settings, running, files, grant.id, today) : null;
  const moodboard = on("moodboard") ? await readMoodboard(db, workspaceId, grant, row.caseId, takesIdeas(row), files) : null;
  const decisions = on("decisions") ? await readDecisions(db, workspaceId, grant, row, commercial, today, definitions, files) : null;
  const payments = on("payments") ? await readPayments(db, workspaceId, row, settings, today) : null;
  const documents = on("documents") ? await readDocuments(db, workspaceId, row, commercial) : null;
  const warranty = started && on("warranty") ? await readWarranty(db, workspaceId, row, today) : null;
  const messages = on("messages") ? await readMessages(db, workspaceId, grant, row.caseId, commercial) : null;
  // The designs and their pinned comments, one conversation with the design team (part of what the client decides on).
  const design = on("decisions") ? await readDesignReview(db, workspaceId, grant, row, files) : null;
  // The concepts shown to the client to pick from, and the materials and decisions they confirm (plan §6.7a).
  const choices = on("decisions") ? await readDesignChoices(db, workspaceId, grant, row.caseId, row.caseStatus === "active", ["active", "released"].includes(row.caseStatus)) : null;
  const stage = started ? await readStage(db, workspaceId, row.projectId!, row.projectStatus!, settings) : null;
  // Change requests sent to the client or raised by them (R11), and their budget: agreed + approved changes = forecast (R1).
  const changes = on("decisions") ? await readPortalChanges(db, workspaceId, grant, row.caseId, ["active", "released"].includes(row.caseStatus)) : null;
  const budget = on("payments") && settings.invoiceAmounts ? await readBudget(db, workspaceId, row.caseId, row.currency, changes ?? []) : null;
  // The home: one feed of typed cards, and what changed since this contact last looked (AI2) — both from this projection only.
  const source = { progress, design, choices, decisions, documents, payments, messages, changes };
  // The newest word from the team: a written update or the latest day's card.
  const card = progress?.cards.find((item) => item.summary);
  const latestUpdate = [progress?.updates[0], card ? { id: card.id, at: card.sentAt, text: card.summary } : undefined]
    .filter((item): item is { id: string; at: string; text: string } => Boolean(item)).sort((a, b) => (a.at < b.at ? 1 : -1))[0] ?? null;
  const dates = started && settings.progress.dates;
  // How the client hears how the work goes (PLM-046): by call or in the portal, and how often; theirs to change while the job runs.
  const updates = on("progress") && !["completed", "cancelled"].includes(base.status) ? await readUpdatePreference(db, workspaceId, row.caseId) : null;
  return {
    ...base, sections: sections as Sections,
    manager: started ? await readManager(db, workspaceId, row.projectId!) : null,
    // The planned handover while the work is on; once it's handed over, when it was, and the warranty.
    stage, handoverDate: dates && running ? row.promiseDate : null, handedOverOn: dates && row.projectStatus === "completed" ? row.completedOn : null,
    warrantyUntil: warranty?.rooms.map((room) => room.until).sort().at(-1) ?? null,
    // The client's profile of the project: where it is, when the work started, and who they deal with.
    address: await readAddress(db, workspaceId, row), startDate: dates ? row.startDate : null,
    team: portalTeam(await readTeam(db, workspaceId, row)),
    rooms: on("progress") || on("moodboard") ? await readRooms(db, workspaceId, row.caseId) : [],
    next: nextSteps(decisions, payments, progress, choices, changes),
    unread: messages?.unread ?? 0,
    latestUpdate, updates, progress, moodboard, decisions, payments, documents, warranty, messages, design, choices, changes, budget,
    feed: feedCards(source), digest: since === undefined ? null : whatChanged(source, since),
  };
}

/** The rooms of the project, for the client to say where something is. */
async function readRooms(db: Db, workspaceId: string, caseId: string) {
  return (await db.query<{ id: string; name: string }>(
    `SELECT id, name FROM pre_project_rooms WHERE workspace_id = $1 AND case_id = $2 ORDER BY name, id`, [workspaceId, caseId])).rows;
}

export type PortalProject = Awaited<ReturnType<typeof readProject>>;

async function loadCommercial(db: Db, workspaceId: string, caseId: string): Promise<CommercialData> {
  const stored = (await commercialRepository.load(db as PoolClient, workspaceId, caseId))?.content as CommercialData | undefined;
  return { quotes: [], requests: [], payments: [], ...stored } as CommercialData;
}

const TEAM_ROLES = ["manager", "designer", "sales"] as const;
type TeamRole = (typeof TEAM_ROLES)[number];
type TeamRow = { role: TeamRole; membershipId: string; name: string; email: string | null; avatar: string | null };
export type PortalTeamMember = { roles: TeamRole[]; name: string; email: string | null; avatar: string | null };
const AVATAR = /^[a-z_]+-[fm]$/;

/**
 * The people a client deals with, in `rank` order: the project manager, the designer (the project's, else the one
 * chosen at the intro meeting) and the sales contact (the project's account manager, else the deal's owner). Each
 * role goes to its first holder; one person holding two roles is one entry. Only a name, a work email and a drawn
 * avatar leave here: no ids, no other roles, nobody else on the team.
 */
export function portalTeam(rows: TeamRow[]): PortalTeamMember[] {
  const holders = new Map<TeamRole, TeamRow>();
  for (const row of rows) if (TEAM_ROLES.includes(row.role) && !holders.has(row.role)) holders.set(row.role, row);
  const people = new Map<string, PortalTeamMember>();
  for (const role of TEAM_ROLES) {
    const row = holders.get(role);
    if (!row) continue;
    const known = people.get(row.membershipId);
    if (known) known.roles.push(role);
    else people.set(row.membershipId, { roles: [role], name: row.name, email: row.email || null, avatar: row.avatar && AVATAR.test(row.avatar) ? row.avatar : null });
  }
  return [...people.values()];
}

async function readTeam(db: Db, workspaceId: string, row: CaseRow) {
  return (await db.query<TeamRow>(
    `WITH named AS (
       SELECT assignment.membership_id, 'manager' AS role, 1 AS rank FROM project_assignments assignment
        WHERE assignment.workspace_id = $1 AND assignment.project_id = $3 AND assignment.active AND assignment.is_manager
       UNION ALL
       SELECT assignment.membership_id, 'designer', 2 FROM project_assignments assignment
        WHERE assignment.workspace_id = $1 AND assignment.project_id = $3 AND assignment.active AND 'designer' = ANY(assignment.role_keys)
       UNION ALL
       SELECT designer.membership_id, 'designer', 3 FROM pre_project_cases pre_case
         JOIN crm_opportunity_designer designer ON designer.workspace_id = pre_case.workspace_id AND designer.opportunity_id = pre_case.opportunity_id
        WHERE pre_case.workspace_id = $1 AND pre_case.id = $2
       UNION ALL
       SELECT assignment.membership_id, 'sales', 4 FROM project_assignments assignment
        WHERE assignment.workspace_id = $1 AND assignment.project_id = $3 AND assignment.active AND 'account_manager' = ANY(assignment.role_keys)
       UNION ALL
       SELECT opportunity.owner_membership_id, 'sales', 5 FROM pre_project_cases pre_case
         JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
        WHERE pre_case.workspace_id = $1 AND pre_case.id = $2 AND opportunity.owner_membership_id IS NOT NULL)
     SELECT named.role, membership.id AS "membershipId", person.display_name AS name, person.primary_email::text AS email, profile.avatar_preset AS avatar
       FROM named
       JOIN workspace_memberships membership ON membership.workspace_id = $1 AND membership.id = named.membership_id AND membership.status = 'active'
       JOIN users person ON person.id = membership.user_id AND person.status = 'active'
       LEFT JOIN workspace_member_profiles profile ON profile.workspace_id = $1 AND profile.user_id = membership.user_id
      ORDER BY named.rank`, [workspaceId, row.caseId, row.projectId])).rows;
}

/** Where the project is: its site's address, or the area the client gave when they first asked. */
async function readAddress(db: Db, workspaceId: string, row: CaseRow) {
  return (await db.query<{ address: string | null }>(
    `SELECT coalesce(
       (SELECT btrim(location.address) FROM work_locations location
         WHERE location.workspace_id = $1 AND location.kind = 'site' AND location.active AND btrim(location.address) <> '' AND (location.case_id = $2 OR location.project_id = $3)
         ORDER BY location.name, location.id LIMIT 1),
       (SELECT nullif(btrim(coalesce(nullif(enquiry.details->>'area', ''), enquiry.details->>'location', '')), '') FROM pre_project_cases pre_case
          JOIN crm_opportunities opportunity ON opportunity.workspace_id = pre_case.workspace_id AND opportunity.id = pre_case.opportunity_id
          JOIN crm_leads lead ON lead.workspace_id = opportunity.workspace_id AND lead.id = opportunity.lead_id
          JOIN crm_enquiries enquiry ON enquiry.workspace_id = lead.workspace_id AND enquiry.id = lead.enquiry_id
         WHERE pre_case.workspace_id = $1 AND pre_case.id = $2)) AS address`, [workspaceId, row.caseId, row.projectId])).rows[0]?.address ?? null;
}

/** "Your project manager": the one staff name a client sees. */
async function readManager(db: Db, workspaceId: string, projectId: string) {
  return (await db.query<{ name: string }>(
    `SELECT person.display_name AS name FROM project_assignments assignment
       JOIN workspace_memberships membership ON membership.workspace_id = assignment.workspace_id AND membership.id = assignment.membership_id AND membership.status = 'active'
       JOIN users person ON person.id = membership.user_id
      WHERE assignment.workspace_id = $1 AND assignment.project_id = $2 AND assignment.active AND assignment.is_manager LIMIT 1`, [workspaceId, projectId])).rows[0]?.name ?? null;
}

async function readStages(db: Db, workspaceId: string, projectId: string) {
  return (await db.query<{ name: string; status: string; startedOn: string | null; finishedOn: string | null }>(
    `SELECT stage.name, stage.status, (stage.started_at AT TIME ZONE workspace.default_timezone)::date::text AS "startedOn",
            (stage.completed_at AT TIME ZONE workspace.default_timezone)::date::text AS "finishedOn"
       FROM project_stages stage JOIN workspaces workspace ON workspace.id = stage.workspace_id
      WHERE stage.workspace_id = $1 AND stage.project_id = $2 AND stage.status <> 'skipped' ORDER BY stage.position`, [workspaceId, projectId])).rows;
}

async function readStage(db: Db, workspaceId: string, projectId: string, status: string, settings: PortalSettings) {
  const stages = await readStages(db, workspaceId, projectId);
  if (!stages.length) return null;
  const current = stages.findIndex((stage) => stage.status === "current");
  const index = status === "completed" ? stages.length - 1 : current >= 0 ? current : stages.filter((stage) => stage.status === "done").length;
  return { number: Math.min(index + 1, stages.length), total: stages.length, name: settings.progress.stageNames ? stages[Math.min(index, stages.length - 1)].name : null };
}

async function readProgress(db: Db, workspaceId: string, row: CaseRow, settings: PortalSettings, running: boolean, files: FilePresence, grantId: string, today: string) {
  const projectId = row.projectId!;
  const stages = (await readStages(db, workspaceId, projectId)).map((stage) => ({
    name: settings.progress.stageNames ? stage.name : null,
    state: (stage.status === "done" ? "done" : stage.status === "current" ? "current" : "upcoming") as "done" | "current" | "upcoming",
    startedOn: settings.progress.dates ? stage.startedOn : null, finishedOn: settings.progress.dates ? stage.finishedOn : null,
  }));
  const updates = settings.progress.updates ? (await db.query<{ id: string; at: string; text: string }>(
    `SELECT id, created_at AS at, note AS text FROM project_status_updates
      WHERE workspace_id = $1 AND project_id = $2 AND shared_at IS NOT NULL AND btrim(note) <> '' ORDER BY created_at DESC LIMIT 50`, [workspaceId, projectId])).rows
    .map((update) => ({ id: update.id, at: new Date(update.at).toISOString(), text: update.text })) : [];
  // Photos shared on their own from approved days before daily cards (a day that went as a card shows in its card).
  const shared = settings.progress.photos ? (await db.query<{ id: string; on: string; objectKey: string; previewKey: string | null }>(
    `SELECT photo.id, report.report_date::text AS on, photo.object_key AS "objectKey", photo.preview_key AS "previewKey" FROM site_report_photos photo
       JOIN site_reports report ON report.workspace_id = photo.workspace_id AND report.id = photo.report_id
      WHERE photo.workspace_id = $1 AND report.project_id = $2 AND report.status = 'approved' AND report.delivery <> 'sent' AND photo.shared_at IS NOT NULL AND photo.mime_type LIKE 'image/%'
      ORDER BY report.report_date DESC, photo.created_at LIMIT 240`, [workspaceId, projectId])).rows : [];
  // Only photos whose file is there: a missing file is left out (and logged), never a broken picture.
  const photos = await files.present(shared);
  const days = new Map<string, Array<{ id: string }>>();
  for (const photo of photos) days.set(photo.on, [...(days.get(photo.on) ?? []), { id: photo.id }]);
  return { stages, updates, photoDays: [...days].map(([on, list]) => ({ on, photos: list })),
    ...(await readDailyCards(db, workspaceId, projectId, grantId, settings, files)),
    percent: settings.progress.stageNames ? (await readWorkProgress(db, workspaceId, projectId)).project : null,
    issues: await readIssues(db, workspaceId, row.caseId, projectId), canReportIssue: running,
    // Deliveries to site from today on: the client confirms access for the day, or asks to move it (D-29).
    siteAccess: row.projectStatus === "active" ? await readClientSiteAccess(db, workspaceId, projectId, today) : [] };
}

type CardPhoto = { id: string; area: string | null; phase: "before" | "after" | null; pairId: string | null };
type StoredView = { date: string; summary: string; noWork?: boolean; hero: CardPhoto | null; photos: CardPhoto[]; completed: string[]; advanced: Array<{ title: string; progress: number }>;
  next: string[]; notes?: string[]; project?: { stage?: string | null; stageNumber?: number | null; stageCount?: number | null; progress?: number | null } };

/**
 * The daily cards: each day the team sent, exactly as it went (the report's frozen client view), newest first, with
 * the client's reactions; the week's roll-ups beside them. Words need Updates on, pictures need Photos on, and a
 * photo whose file isn't there is left out. Every field is named: nothing else of the report is read here.
 */
async function readDailyCards(db: Db, workspaceId: string, projectId: string, grantId: string, settings: PortalSettings, files: FilePresence) {
  if (!settings.progress.updates && !settings.progress.photos) return { cards: [], weeks: [] };
  const sent = (await db.query<{ id: string; sentAt: string; view: StoredView }>(
    `SELECT id, sent_at AS "sentAt", client_view AS view FROM site_reports WHERE workspace_id = $1 AND project_id = $2 AND delivery = 'sent' ORDER BY report_date DESC, sent_at DESC LIMIT 60`,
    [workspaceId, projectId])).rows;
  const ids = sent.map((row) => row.id);
  const reactions = (await db.query<{ reportId: string; reaction: "like" | "love"; count: number; mine: boolean }>(
    `SELECT report_id AS "reportId", reaction, count(*)::int AS count, bool_or(grant_id = $3) AS mine FROM site_report_reactions
      WHERE workspace_id = $1 AND report_id = ANY($2::uuid[]) GROUP BY report_id, reaction`, [workspaceId, ids, grantId])).rows;
  const stored = settings.progress.photos ? await files.present((await db.query<{ id: string; objectKey: string; previewKey: string | null }>(
    `SELECT id, object_key AS "objectKey", preview_key AS "previewKey" FROM site_report_photos WHERE workspace_id = $1 AND report_id = ANY($2::uuid[]) AND shared_at IS NOT NULL`,
    [workspaceId, ids])).rows) : [];
  const present = new Set(stored.map((photo) => photo.id));
  const photo = (item: CardPhoto | null) => (item && present.has(item.id) ? { id: item.id, area: item.area ?? null, phase: item.phase ?? null, pairId: item.pairId && present.has(item.pairId) ? item.pairId : null } : null);
  const cards = sent.map(({ id, sentAt, view }) => {
    const pictures = [photo(view.hero), ...(view.photos ?? []).map(photo)].filter((item): item is CardPhoto => Boolean(item));
    const count = (reaction: "like" | "love") => reactions.find((item) => item.reportId === id && item.reaction === reaction);
    return {
      id, date: view.date, sentAt: new Date(sentAt).toISOString(),
      summary: settings.progress.updates ? view.summary : "",
      noWork: Boolean(view.noWork),
      hero: pictures[0] ?? null, photos: pictures.slice(1),
      completed: settings.progress.updates ? view.completed ?? [] : [], advanced: settings.progress.updates ? view.advanced ?? [] : [],
      next: settings.progress.updates ? view.next ?? [] : [], notes: settings.progress.updates ? view.notes ?? [] : [],
      // Where the project stood that day (for the day's printout), as the project's own stage and percent are shown.
      stage: view.project?.stageNumber && view.project.stageCount
        ? { number: view.project.stageNumber, total: view.project.stageCount, name: settings.progress.stageNames ? view.project.stage ?? null : null } : null,
      percent: settings.progress.stageNames ? view.project?.progress ?? null : null,
      reactions: { like: count("like")?.count ?? 0, love: count("love")?.count ?? 0 },
      mine: { like: Boolean(count("like")?.mine), love: Boolean(count("love")?.mine) },
    };
  }).filter((card) => card.summary || card.hero);
  const weeks = settings.progress.updates ? (await db.query<{ id: string; weekEnding: string; digest: string }>(
    `SELECT id, week_ending::text AS "weekEnding", digest FROM site_report_rollups WHERE workspace_id = $1 AND project_id = $2 ORDER BY week_ending DESC LIMIT 20`,
    [workspaceId, projectId])).rows : [];
  return { cards, weeks };
}

async function readDecisions(db: Db, workspaceId: string, grant: Grant, row: CaseRow, commercial: CommercialData, today: string, definitions: DefinitionSource,
  files: FilePresence) {
  const approver = grant.role === "approver";
  const issuedQuotes = commercial.quotes.filter((quote) => quote.issuedAt);
  // The quotation number and the markup disclosure the client was sent (R3).
  const extras = await portalQuoteExtras(db, workspaceId, row.caseId, issuedQuotes);
  const quotes = issuedQuotes.map((quote) => ({ ...portalQuote(quote, grant.id, grant.role), reference: extras.get(quote.id)?.reference ?? null, disclosure: extras.get(quote.id)?.disclosure ?? null }));
  const found = (await db.query<{ id: string; title: string; type: string; number: number; status: string; dueAt: string | null; room: string | null; item: string | null;
    mimeType: string; objectKey: string; previewKey: string | null }>(
    `SELECT version.id, design.title, design.document_type AS type, version.number,
            CASE WHEN version.status = 'client_review' AND version.client_review_expires_at <= now() THEN 'expired' ELSE version.status END AS status,
            version.client_review_expires_at AS "dueAt", room.name AS room, entry.title AS item, asset.mime_type AS "mimeType",
            asset.object_key AS "objectKey", asset.preview_key AS "previewKey"
       FROM pre_project_design_versions version
       JOIN pre_project_designs design ON design.workspace_id = version.workspace_id AND design.id = version.design_id
       JOIN pre_project_brief_assets asset ON asset.workspace_id = version.workspace_id AND asset.id = version.asset_id
       LEFT JOIN pre_project_rooms room ON room.workspace_id = design.workspace_id AND room.case_id = design.case_id AND room.id = design.room_id
       LEFT JOIN pre_project_brief_entries entry ON entry.workspace_id = design.workspace_id AND entry.case_id = design.case_id AND entry.id = design.scope_entry_id
      WHERE version.workspace_id = $1 AND version.case_id = $2 AND design.archived_at IS NULL
        AND version.status IN ('client_review', 'approved', 'changes_requested', 'rejected')
        AND version.number = (SELECT max(number) FROM pre_project_design_versions latest WHERE latest.workspace_id = design.workspace_id AND latest.design_id = design.id)
      ORDER BY coalesce(room.name, ''), design.title`, [workspaceId, row.caseId])).rows;
  const designs = [];
  for (const design of found) designs.push({
    id: design.id, title: design.title, type: design.type, number: design.number, status: design.status, dueAt: design.dueAt ? new Date(design.dueAt).toISOString() : null,
    room: design.room, item: design.item, mimeType: design.mimeType,
    // A picture only when its file is there; otherwise the client opens the file.
    hasPreview: design.mimeType.startsWith("image/") && ((await files.has(design.previewKey)) || (await files.has(design.objectKey))),
    canDecide: approver && design.status === "client_review" && row.caseStatus === "active",
  });
  const requests = commercial.requests.filter((request) => request.decisionRequest).map((request) => {
    const asked = request.decisionRequest!;
    return {
      id: request.id, number: request.number, title: request.title, detail: request.detail, dueDate: request.dueDate || null, target: asked.target.label,
      choices: asked.allowedChoices.map((choice) => ({ id: choice.id, label: choice.label })),
      decision: asked.decision ? { choiceLabel: asked.decision.choiceLabel, note: asked.decision.note, decidedAt: asked.decision.decidedAt, decidedBy: asked.decision.decidedBy } : null,
      canDecide: approver && asked.clientApproverGrantId === grant.id && !asked.decision && request.status === "awaiting_decision" && !(request.dueDate && request.dueDate < today),
    };
  });
  return {
    quotes, designs, requests,
    definition: await readDefinition(db, workspaceId, grant, row, definitions),
    materials: row.projectId ? await readMaterials(db, workspaceId, row.projectId, approver, row.projectStatus!) : null,
    handovers: row.projectId ? await readHandovers(db, workspaceId, row.projectId, approver, row.projectStatus!) : [],
    drawings: row.projectId ? await readDrawings(db, workspaceId, row.projectId, approver, row.projectStatus!) : null,
  };
}

/**
 * The technical drawings sent to the client (PLM-059): the latest revision they were sent, its drawing files, and
 * their decision. Never the site check, the team's notes or the signed file the team recorded.
 */
async function readDrawings(db: Db, workspaceId: string, projectId: string, approver: boolean, projectStatus: string) {
  const revision = (await db.query<{ id: string; number: number; status: string; sentAt: string; decidedOn: string | null; decidedBy: string | null; note: string }>(
    `SELECT id, number, status, sent_at AS "sentAt", decided_on::text AS "decidedOn", decided_by_name AS "decidedBy", decision_note AS note
       FROM project_drawing_revisions WHERE workspace_id = $1 AND project_id = $2 AND sent_at IS NOT NULL ORDER BY number DESC LIMIT 1`, [workspaceId, projectId])).rows[0];
  if (!revision) return null;
  const files = (await db.query<{ id: string; name: string; mimeType: string }>(
    `SELECT id, original_name AS name, mime_type AS "mimeType" FROM project_drawing_files WHERE workspace_id = $1 AND revision_id = $2 AND kind = 'drawing'
      ORDER BY created_at, original_name, id`, [workspaceId, revision.id])).rows;
  const status = revision.status === "approved" || revision.status === "changes_requested" ? revision.status : "sent";
  return {
    id: revision.id, number: revision.number, status: status as "sent" | "approved" | "changes_requested", sentAt: new Date(revision.sentAt).toISOString(),
    decidedOn: revision.decidedOn, decidedBy: revision.decidedBy, note: status === "sent" ? "" : revision.note, files,
    canDecide: approver && revision.status === "sent" && ["active", "on_hold"].includes(projectStatus),
  };
}

/** The pre-project definition as the definition module presents it to the portal (status, current, decision). */
export type DefinitionSource = {
  portalData(client: PoolClient, workspaceId: string, caseId: string, grant: { id: string; role: string }): Promise<null | {
    id: string; number: number; snapshot: Record<string, unknown>; message: string; publishedAt: string | null; status: string;
    decision: { decision: string | null; note: string | null; decidedAt: string | null } | null; canDecide: boolean;
  }>;
};

/** The requirements the client confirms before quoting: what they asked for, never the firm's working notes. */
async function readDefinition(db: Db, workspaceId: string, grant: Grant, row: CaseRow, definitions: DefinitionSource) {
  const latest = await definitions.portalData(db as PoolClient, workspaceId, row.caseId, grant);
  if (!latest) return null;
  const definition = (latest.snapshot?.definition ?? {}) as { brief?: Record<string, unknown>; rooms?: Array<{ name?: unknown }>; items?: Array<Record<string, unknown>> };
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  const brief = definition.brief ?? {};
  return {
    id: latest.id, number: latest.number, message: latest.message ?? "", publishedAt: latest.publishedAt, status: latest.status,
    brief: { goals: text(brief.goals), propertyType: text(brief.propertyType), location: text(brief.location), area: text(brief.area), timeline: text(brief.timeline),
      preferences: text(brief.preferences), retainedItems: text(brief.retainedItems), exclusions: text(brief.exclusions), constraints: text(brief.constraints) },
    rooms: (definition.rooms ?? []).map((room) => text(room.name)).filter(Boolean),
    items: (definition.items ?? []).map((item) => ({ title: text(item.title), room: text(item.roomName) || null, quantity: typeof item.quantity === "number" ? item.quantity : null,
      unit: text(item.unit), requirement: text(item.requirement), avoid: text(item.avoid) })),
    decision: latest.decision ? { decision: latest.decision.decision, decidedAt: latest.decision.decidedAt, note: latest.decision.note ?? "" } : null,
    canDecide: latest.canDecide,
  };
}

/** The material list revision the client signs: names, finishes and quantities, never suppliers, codes or notes. */
async function readMaterials(db: Db, workspaceId: string, projectId: string, approver: boolean, projectStatus: string) {
  const revision = (await db.query<{ id: string; number: number; status: string; sentAt: string; decidedAt: string | null; decidedBy: string | null; note: string;
    snapshot: Array<{ id: string; name: string; specification: string; quantity: string | null; unit: string; boqLineIds: string[] }> }>(
    `SELECT id, number, status, sent_at AS "sentAt", decided_at AS "decidedAt", decided_by_name AS "decidedBy", decision_note AS note, snapshot
       FROM project_material_revisions WHERE workspace_id = $1 AND project_id = $2 ORDER BY number DESC LIMIT 1`, [workspaceId, projectId])).rows[0];
  if (!revision) return null;
  const areas = new Map((await db.query<{ id: string; area: string | null }>(
    `SELECT line.id, room.name AS area FROM project_boq_lines line
       JOIN delivery_projects project ON project.workspace_id = line.workspace_id AND project.id = line.project_id
       LEFT JOIN pre_project_rooms room ON room.workspace_id = line.workspace_id AND room.case_id = project.case_id AND room.id = line.area_id
      WHERE line.workspace_id = $1 AND line.project_id = $2`, [workspaceId, projectId])).rows.map((line) => [line.id, line.area]));
  const decisions = (await db.query<{ itemId: string; decision: "approved" | "rejected"; note: string }>(
    `SELECT item_id AS "itemId", decision, note FROM project_material_decisions WHERE workspace_id = $1 AND revision_id = $2`, [workspaceId, revision.id])).rows;
  return {
    id: revision.id, number: revision.number, status: revision.status as "sent" | "signed_off" | "changes_requested",
    sentAt: new Date(revision.sentAt).toISOString(), decidedAt: revision.decidedAt ? new Date(revision.decidedAt).toISOString() : null, decidedBy: revision.decidedBy,
    items: revision.snapshot.map((item) => ({
      id: item.id, name: item.name, specification: item.specification, quantity: item.quantity, unit: item.unit,
      areas: [...new Set(item.boqLineIds.map((id) => areas.get(id)).filter((area): area is string => Boolean(area)))],
      decision: decisions.find((entry) => entry.itemId === item.id)?.decision ?? null,
      note: decisions.find((entry) => entry.itemId === item.id)?.note ?? "",
    })),
    canDecide: approver && revision.status === "sent" && ["active", "on_hold"].includes(projectStatus),
  };
}

async function readHandovers(db: Db, workspaceId: string, projectId: string, approver: boolean, projectStatus: string) {
  const packs = (await db.query<{ id: string; revision: number; title: string; status: string; areas: string[] | null; issuedAt: string; decidedOn: string | null; decidedBy: string | null;
    note: string }>(
    `SELECT id, revision, title, status, ARRAY(SELECT jsonb_array_elements_text(snapshot->'areas')) AS areas, issued_at AS "issuedAt", decided_on::text AS "decidedOn",
            decided_by_name AS "decidedBy", decision_note AS note
       FROM handover_packs WHERE workspace_id = $1 AND project_id = $2 AND status <> 'draft' ORDER BY revision DESC`, [workspaceId, projectId])).rows;
  const documents = (await db.query<{ packId: string; id: string; kind: string; title: string; mimeType: string }>(
    `SELECT pack_id AS "packId", id, kind, title, mime_type AS "mimeType" FROM handover_documents WHERE workspace_id = $1 AND pack_id = ANY($2::uuid[]) ORDER BY created_at`,
    [workspaceId, packs.map((pack) => pack.id)])).rows;
  // Money still due, shown before the client accepts an issued pack (with where to pay it).
  const project = packs.some((pack) => pack.status === "issued")
    ? (await db.query<{ id: string; caseId: string; currency: string }>(`SELECT id, case_id AS "caseId", currency FROM delivery_projects WHERE workspace_id = $1 AND id = $2`, [workspaceId, projectId])).rows[0]
    : null;
  const owed = project ? await projectBalance(db, workspaceId, project) : null;
  const balance = owed && Dec.of(owed.due).cmp(0) > 0 ? { currency: owed.currency, due: owed.due } : null;
  return packs.map((pack) => ({
    id: pack.id, revision: pack.revision, title: pack.title, status: pack.status as "issued" | "accepted" | "refused", areas: pack.areas ?? [],
    balance: pack.status === "issued" ? balance : null,
    issuedAt: new Date(pack.issuedAt).toISOString(), decidedOn: pack.decidedOn, decidedBy: pack.decidedBy,
    // What the client refused it for, or what they accepted with still outstanding.
    note: pack.status === "draft" ? "" : pack.note,
    documents: documents.filter((document) => document.packId === pack.id).map((document) => ({ id: document.id, kind: document.kind, title: document.title, mimeType: document.mimeType })),
    canDecide: approver && pack.status === "issued" && ["active", "on_hold"].includes(projectStatus),
  }));
}

/**
 * Files published to the client as document cards: the signed agreement, approved designs, issued handover packs and
 * signed change requests — each with its version and date, and E5-4's "changed" marker when it replaced an earlier
 * version the client had (the old one stays in its history). Never a bare link: the web shows a preview when there is one.
 */
async function readDocuments(db: Db, workspaceId: string, row: CaseRow, commercial: CommercialData) {
  type Card = { id: string; kind: "agreement" | "design" | "handover" | "change"; title: string; group: string; date: string | null; mimeType: string; version: number; changed: boolean;
    hasPreview: boolean; at: string | null };
  const documents: Card[] = [];
  const add = (card: Omit<Card, "hasPreview">) => documents.push({ ...card, hasPreview: card.mimeType.startsWith("image/") });
  if (commercial.agreement?.status === "executed")
    for (const file of commercial.agreement.files ?? [])
      add({ id: file.id, kind: "agreement", title: file.name, group: commercial.agreement.reference, date: file.addedAt?.slice(0, 10) ?? null, mimeType: file.mimeType, version: 1, changed: false,
        at: file.addedAt ?? null });
  const designs = (await db.query<{ id: string; title: string; number: number; room: string | null; mimeType: string; date: string; at: Date }>(
    `SELECT version.id, design.title, version.number, room.name AS room, asset.mime_type AS "mimeType", version.created_at::date::text AS date, version.created_at AS at
       FROM pre_project_design_versions version
       JOIN pre_project_designs design ON design.workspace_id = version.workspace_id AND design.id = version.design_id
       JOIN pre_project_brief_assets asset ON asset.workspace_id = version.workspace_id AND asset.id = version.asset_id
       LEFT JOIN pre_project_rooms room ON room.workspace_id = design.workspace_id AND room.case_id = design.case_id AND room.id = design.room_id
      WHERE version.workspace_id = $1 AND version.case_id = $2 AND design.archived_at IS NULL AND version.status = 'approved'
        AND version.number = (SELECT max(number) FROM pre_project_design_versions approved WHERE approved.workspace_id = design.workspace_id AND approved.design_id = design.id
                               AND approved.status = 'approved')
      ORDER BY coalesce(room.name, ''), design.title`, [workspaceId, row.caseId])).rows;
  for (const design of designs)
    add({ id: design.id, kind: "design", title: design.title, group: design.room ?? "", date: design.date, mimeType: design.mimeType, version: design.number, changed: design.number > 1,
      at: new Date(design.at).toISOString() });
  if (row.projectId) {
    const handover = (await db.query<{ id: string; title: string; pack: string; revision: number; mimeType: string; date: string; at: Date }>(
      `SELECT document.id, document.title, pack.title AS pack, pack.revision, document.mime_type AS "mimeType", pack.issued_at::date::text AS date, pack.issued_at AS at
         FROM handover_documents document JOIN handover_packs pack ON pack.workspace_id = document.workspace_id AND pack.id = document.pack_id
        WHERE document.workspace_id = $1 AND pack.project_id = $2 AND pack.status <> 'draft' ORDER BY pack.revision DESC, document.created_at`,
      [workspaceId, row.projectId])).rows;
    for (const document of handover)
      add({ id: document.id, kind: "handover", title: document.title, group: document.pack, date: document.date, mimeType: document.mimeType, version: document.revision,
        changed: document.revision > 1, at: new Date(document.at).toISOString() });
  }
  // Signed change requests: the signed copy, with its certificate page.
  const signed = (await db.query<{ id: string; reference: string; title: string; date: string; number: number; at: Date }>(
    `SELECT change.id, 'CR-' || lpad(change.number::text, 3, '0') AS reference, change.title, change.decided_at::date::text AS date, document.current_version AS number,
            change.decided_at AS at
       FROM change_requests change JOIN quote_documents document ON document.workspace_id = change.workspace_id AND document.id = change.document_id
      WHERE change.workspace_id = $1 AND change.case_id = $2 AND change.status = 'approved' AND change.decision_method = 'signed_link' ORDER BY change.number`, [workspaceId, row.caseId])).rows;
  for (const change of signed)
    add({ id: change.id, kind: "change", title: `${change.reference} · ${change.title}`, group: "", date: change.date, mimeType: "application/pdf", version: change.number, changed: false,
      at: new Date(change.at).toISOString() });
  return documents;
}

/**
 * What's covered, by room (one line each: how many items, until when), and the client's claims with their photos.
 * The areas and lines are what a claim can name.
 */
async function readWarranty(db: Db, workspaceId: string, row: CaseRow, today: string) {
  const items = (await db.query<{ lineId: string; title: string; area: string | null; areaId: string | null; startsOn: string; endsOn: string; months: number }>(
    `SELECT item.boq_line_id AS "lineId", line.title, room.name AS area, room.id AS "areaId", item.starts_on::text AS "startsOn", item.ends_on::text AS "endsOn", item.months
       FROM warranty_items item
       JOIN project_boq_lines line ON line.workspace_id = item.workspace_id AND line.id = item.boq_line_id
       LEFT JOIN pre_project_rooms room ON room.workspace_id = line.workspace_id AND room.case_id = $3 AND room.id = line.area_id
      WHERE item.workspace_id = $1 AND item.project_id = $2 AND item.months > 0 ORDER BY coalesce(room.name, ''), line.position`,
    [workspaceId, row.projectId, row.caseId])).rows;
  const claims = (await db.query<{ id: string; number: number; raisedOn: string; description: string; status: string; note: string }>(
    `SELECT id, number, raised_on::text AS "raisedOn", description, status, decision_note AS note FROM warranty_claims
      WHERE workspace_id = $1 AND project_id = $2 ORDER BY number DESC`, [workspaceId, row.projectId])).rows;
  const photos = await readAttachments(db, workspaceId, row.caseId, ["warranty_claim"]);
  const live = (item: { startsOn: string; endsOn: string }) => item.startsOn <= today && today <= item.endsOn;
  const active = items.filter(live);
  const areas = new Map(active.filter((item) => item.areaId).map((item) => [item.areaId!, item.area!]));
  const rooms = new Map<string, { id: string | null; name: string | null; items: typeof items }>();
  for (const item of items) {
    const key = item.areaId ?? "";
    rooms.set(key, { id: item.areaId, name: item.area, items: [...(rooms.get(key)?.items ?? []), item] });
  }
  return {
    rooms: [...rooms.values()].map((room) => ({
      id: room.id, name: room.name, until: room.items.map((item) => item.endsOn).sort().at(-1)!, active: room.items.some(live),
      // The same work in a room is one line ("Wall painting, 2 coats" once, however many walls).
      items: [...new Map(room.items.map((item) => [item.title, item])).values()].map((item) => ({ id: item.lineId, title: item.title, until: item.endsOn, active: live(item) })),
    })),
    claims: claims.map((claim) => ({ id: claim.id, number: claim.number, raisedOn: claim.raisedOn, description: claim.description,
      status: claim.status as "open" | "covered" | "not_covered" | "chargeable",
      // Why it isn't covered (or what's charged) is written for the client; a covered claim just gets fixed.
      reason: ["not_covered", "chargeable"].includes(claim.status) ? claim.note : "", files: photos.get(`warranty_claim:${claim.id}`) ?? [] })),
    areas: [...areas].map(([id, name]) => ({ id, name })),
    lines: active.map((item) => ({ id: item.lineId, title: item.title, areaId: item.areaId })),
    canClaim: active.length > 0 && ["active", "on_hold", "completed"].includes(row.projectStatus ?? ""),
  };
}

export { portalRequest } from "./portal-messages";

type Decisions = Awaited<ReturnType<typeof readDecisions>>;
type Payments = Awaited<ReturnType<typeof readPayments>>;
type Progress = Awaited<ReturnType<typeof readProgress>>;

type Choices = Awaited<ReturnType<typeof readDesignChoices>>;
type Changes = Awaited<ReturnType<typeof readPortalChanges>>;

/**
 * "Waiting for you": every item the client must act on — decisions (quotes, designs, the requirements, concepts to
 * choose, choices to confirm or replace, material lists, handovers, changes, the team's questions), what's due to
 * pay, then deliveries to confirm site access for — each with its due date when it has one.
 */
function nextSteps(decisions: Decisions | null, payments: Payments | null, progress: Progress | null, choices: Choices | null = null, changes: Changes | null = null) {
  const steps: Array<{ kind: "quote" | "design" | "definition" | "materials" | "drawings" | "handover" | "request" | "invoice" | "site_access" | "change" | "presentation" | "choice"; id: string; title: string;
    due: string | null }> = [];
  if (decisions) {
    for (const quote of decisions.quotes.filter((item) => item.canDecide))
      steps.push({ kind: "quote", id: quote.id, title: `${quote.title} · V${quote.number}`, due: quote.validUntil });
    if (decisions.definition?.canDecide) steps.push({ kind: "definition", id: decisions.definition.id, title: `R${decisions.definition.number}`, due: null });
    for (const design of decisions.designs.filter((item) => item.canDecide)) steps.push({ kind: "design", id: design.id, title: `${design.title} · V${design.number}`, due: design.dueAt });
    if (decisions.materials?.canDecide) steps.push({ kind: "materials", id: decisions.materials.id, title: `R${decisions.materials.number}`, due: null });
    if (decisions.drawings?.canDecide) steps.push({ kind: "drawings", id: decisions.drawings.id, title: `R${decisions.drawings.number}`, due: null });
    for (const pack of decisions.handovers.filter((item) => item.canDecide)) steps.push({ kind: "handover", id: pack.id, title: `${pack.title} · R${pack.revision}`, due: null });
    for (const request of decisions.requests.filter((item) => item.canDecide)) steps.push({ kind: "request", id: request.id, title: request.title, due: request.dueDate });
  }
  for (const change of changes?.filter((item) => item.canDecide) ?? []) steps.push({ kind: "change", id: change.id, title: `${change.reference} · ${change.title}`, due: null });
  for (const presentation of choices?.presentations.filter((item) => item.canDecide) ?? []) steps.push({ kind: "presentation", id: presentation.id, title: presentation.label, due: null });
  for (const choice of choices?.choices.filter((item) => item.canDecide || item.alternatives.some((alternative) => alternative.canChoose)) ?? [])
    steps.push({ kind: "choice", id: choice.entryId, title: choice.title, due: null });
  if (payments)
    for (const milestone of payments.milestones.filter((item) => item.invoice && ["due", "overdue", "part_paid"].includes(item.status)))
      steps.push({ kind: "invoice", id: milestone.invoice!.id, title: milestone.invoice!.number, due: milestone.dueDate });
  for (const delivery of progress?.siteAccess.filter((item) => item.status === "waiting") ?? [])
    steps.push({ kind: "site_access", id: delivery.id, title: delivery.items, due: delivery.date });
  return steps;
}

export function isImage(mimeType: string) {
  return IMAGE.test(mimeType);
}
