import { UnprocessableEntityException } from "@nestjs/common";
import type { PoolClient } from "pg";

type Db = Pick<PoolClient, "query">;

/**
 * Who sees which chats (plan §5b, §6.5a "Inbox visibility"), enforced in every inbox query (lists, counts,
 * search, the thread and every command on it). Read from the permissions held, never from a role's name:
 *   manage  every chat and the inbox settings (crm.inbox.manage, or crm.settings.manage that managed it before)
 *   team    the unfiled intake: unassigned chats, mine and my queue mates' (the whole inbox team when I am in no
 *           queue): the Sales admin team (crm.inbox.team)
 *   own     the unfiled chats assigned to me (crm.communications.view)
 *   job     no inbox at all: only the chats filed into my jobs (a designer, a project manager)
 * Whatever the level, a chat filed into a job is seen by that job's team: the enquiry's owner, the
 * opportunity's owner and team, the project's active assignments, each only with the permission to open that
 * kind of job. Leaving the team hides the chat again (E6-4); its history keeps every message.
 */
export type InboxScope = "own" | "team" | "manage" | "job";

export const INBOX_VIEW = "crm.communications.view";
export const INBOX_TEAM = "crm.inbox.team";
/** Either code manages the inbox: the Inbox level or the CRM settings permission that managed it before. */
export const INBOX_MANAGE = ["crm.inbox.manage", "crm.settings.manage"] as const;

export const JOB_KINDS = ["enquiry", "opportunity", "project"] as const;
export type JobKind = (typeof JOB_KINDS)[number];
/** The permission that opens each kind of job; a job's chats need it too. */
export const JOB_VIEW: Record<JobKind, string> = { enquiry: "crm.leads.view", opportunity: "crm.opportunities.view", project: "projects.view" };
/** Reading chats needs the inbox, or a kind of job whose filed chats the person may see. */
export const INBOX_READ = [INBOX_VIEW, ...JOB_KINDS.map((kind) => JOB_VIEW[kind])];
/** Every code the viewer is built from, for one permission query. */
export const VIEWER_PERMISSIONS = [...INBOX_MANAGE, INBOX_TEAM, INBOX_VIEW, ...JOB_KINDS.map((kind) => JOB_VIEW[kind])];

export type InboxViewer = { scope: InboxScope; jobKinds: JobKind[] };

/** The person's level and the kinds of job they may open, from the permissions they hold. */
export function inboxViewer(held: ReadonlySet<string>): InboxViewer {
  const jobKinds = JOB_KINDS.filter((kind) => held.has(JOB_VIEW[kind]));
  const scope: InboxScope = INBOX_MANAGE.some((code) => held.has(code)) ? "manage"
    : !held.has(INBOX_VIEW) ? "job"
      : held.has(INBOX_TEAM) ? "team" : "own";
  return { scope, jobKinds };
}

/** The viewer from a permission check (`can` respects "view as" and the organization's modules). */
export async function loadInboxViewer(can: (permission: string) => Promise<boolean>): Promise<InboxViewer> {
  const held = new Set<string>();
  for (const code of VIEWER_PERMISSIONS) if (await can(code)) held.add(code);
  return inboxViewer(held);
}

/** The person's inbox level alone. */
export async function inboxScope(can: (permission: string) => Promise<boolean>): Promise<InboxScope> {
  return (await loadInboxViewer(can)).scope;
}

/**
 * "This membership is on the team of the job the chat is filed into", for the conversation `alias`; `me` is the
 * placeholder of the membership id. Only the kinds given count (the ones the person may open).
 */
export function jobTeamSql(kinds: readonly JobKind[], me: string, alias = "conversation") {
  const parts = kinds.map((kind) => {
    if (kind === "enquiry") {
      return `(${alias}.job_kind = 'enquiry' AND EXISTS (SELECT 1 FROM crm_leads job_lead
        WHERE job_lead.workspace_id = ${alias}.workspace_id AND job_lead.id = ${alias}.job_id AND job_lead.owner_membership_id = ${me}::uuid))`;
    }
    if (kind === "opportunity") {
      return `(${alias}.job_kind = 'opportunity' AND EXISTS (SELECT 1 FROM crm_opportunities job_opportunity
        WHERE job_opportunity.workspace_id = ${alias}.workspace_id AND job_opportunity.id = ${alias}.job_id
          AND (job_opportunity.owner_membership_id = ${me}::uuid OR EXISTS (SELECT 1 FROM crm_opportunity_team job_member
            WHERE job_member.workspace_id = job_opportunity.workspace_id AND job_member.opportunity_id = job_opportunity.id AND job_member.membership_id = ${me}::uuid))))`;
    }
    return `(${alias}.job_kind = 'project' AND EXISTS (SELECT 1 FROM project_assignments job_assignment
        WHERE job_assignment.workspace_id = ${alias}.workspace_id AND job_assignment.project_id = ${alias}.job_id
          AND job_assignment.membership_id = ${me}::uuid AND job_assignment.active))`;
  });
  return parts.length ? `(${alias}.job_id IS NOT NULL AND (${parts.join(" OR ")}))` : "FALSE";
}

/**
 * The SQL for "this chat is within the viewer's reach", for the conversation `alias`; `me` is the placeholder of
 * the viewer's membership id (null for someone with no membership, who then sees nothing).
 */
export function visibleSql(viewer: InboxViewer, me: string, alias = "conversation") {
  // Manage sees everything; the placeholder is still named so the driver can type it.
  if (viewer.scope === "manage") return `(${me}::uuid IS NULL OR TRUE)`;
  const filed = jobTeamSql(viewer.jobKinds, me, alias);
  if (viewer.scope === "job") return filed;
  const intake = viewer.scope === "own" ? `${alias}.owner_membership_id = ${me}::uuid`
    : `(${alias}.owner_membership_id IS NULL OR ${alias}.owner_membership_id = ${me}::uuid
    OR ${alias}.owner_membership_id IN (
      SELECT teammate.membership_id FROM crm_effective_queue_members teammate
       WHERE teammate.workspace_id = ${alias}.workspace_id AND teammate.queue_id IN (
         SELECT mine.queue_id FROM crm_effective_queue_members mine WHERE mine.workspace_id = ${alias}.workspace_id AND mine.membership_id = ${me}::uuid))
    OR NOT EXISTS (SELECT 1 FROM crm_effective_queue_members mine WHERE mine.workspace_id = ${alias}.workspace_id AND mine.membership_id = ${me}::uuid))`;
  return `((${alias}.job_id IS NULL AND ${intake}) OR ${filed})`;
}

/** The chats a list view holds, inside the reach: Mine, Unassigned, Team (everyone's assigned chats I may see) or All. */
export function viewSql(view: string | undefined, me: string, alias = "conversation") {
  if (view === "mine") return `${alias}.owner_membership_id = ${me}::uuid`;
  if (view === "unassigned") return `${alias}.owner_membership_id IS NULL`;
  if (view === "team") return `${alias}.owner_membership_id IS NOT NULL`;
  return null;
}

/** Whether one chat is within the viewer's reach. */
export async function conversationVisible(db: Db, workspaceId: string, conversationId: string, viewer: InboxViewer, membershipId: string | null) {
  if (viewer.scope === "manage") return true;
  const result = await db.query(`SELECT 1 FROM crm_conversations conversation WHERE conversation.workspace_id = $1 AND conversation.id = $2 AND ${visibleSql(viewer, "$3")}`, [workspaceId, conversationId, membershipId]);
  return Boolean(result.rowCount);
}

/** Whether a membership is on the team of a job (every kind counts): who keeps a chat filed into it. */
export async function onJobTeam(db: Db, workspaceId: string, kind: JobKind, jobId: string, membershipId: string) {
  const result = await db.query(
    `SELECT 1 FROM (SELECT $1::uuid AS workspace_id, $2::varchar AS job_kind, $3::uuid AS job_id) conversation WHERE ${jobTeamSql([kind], "$4")}`,
    [workspaceId, kind, jobId, membershipId]);
  return Boolean(result.rowCount);
}

/** The job a chat is filed into, as the lists and the thread show it. */
export const JOB_SQL = (alias = "conversation") => `CASE ${alias}.job_kind
  WHEN 'enquiry' THEN (SELECT jsonb_build_object('kind', 'enquiry', 'id', lead.id, 'reference', enquiry.reference, 'title', enquiry.title)
    FROM crm_leads lead JOIN crm_enquiries enquiry ON enquiry.workspace_id = lead.workspace_id AND enquiry.id = lead.enquiry_id
    WHERE lead.workspace_id = ${alias}.workspace_id AND lead.id = ${alias}.job_id)
  WHEN 'opportunity' THEN (SELECT jsonb_build_object('kind', 'opportunity', 'id', opportunity.id, 'reference', opportunity.reference, 'title', opportunity.title)
    FROM crm_opportunities opportunity WHERE opportunity.workspace_id = ${alias}.workspace_id AND opportunity.id = ${alias}.job_id)
  WHEN 'project' THEN (SELECT jsonb_build_object('kind', 'project', 'id', project.id, 'reference', project.reference, 'title', project.name)
    FROM delivery_projects project WHERE project.workspace_id = ${alias}.workspace_id AND project.id = ${alias}.job_id)
  END`;

export type Job = { kind: JobKind; id: string; reference: string | null; title: string; ownerMembershipId: string | null; partyId: string | null };

/** One of the contact's jobs, with its owner (the enquiry's owner, the opportunity's owner, the project's manager). */
export async function findJob(db: Db, workspaceId: string, kind: JobKind, id: string): Promise<Job | null> {
  const sql = kind === "enquiry"
    ? `SELECT lead.id, enquiry.reference, enquiry.title, lead.owner_membership_id AS "ownerMembershipId", lead.party_id AS "partyId"
         FROM crm_leads lead JOIN crm_enquiries enquiry ON enquiry.workspace_id = lead.workspace_id AND enquiry.id = lead.enquiry_id
        WHERE lead.workspace_id = $1 AND lead.id = $2`
    : kind === "opportunity"
      ? `SELECT opportunity.id, opportunity.reference, opportunity.title, opportunity.owner_membership_id AS "ownerMembershipId", opportunity.party_id AS "partyId"
           FROM crm_opportunities opportunity WHERE opportunity.workspace_id = $1 AND opportunity.id = $2`
      : `SELECT project.id, project.reference, project.name AS title,
                (SELECT assignment.membership_id FROM project_assignments assignment
                  WHERE assignment.workspace_id = project.workspace_id AND assignment.project_id = project.id AND assignment.is_manager AND assignment.active LIMIT 1) AS "ownerMembershipId",
                (SELECT opportunity.party_id FROM pre_project_cases pc JOIN crm_opportunities opportunity ON opportunity.workspace_id = pc.workspace_id AND opportunity.id = pc.opportunity_id
                  WHERE pc.workspace_id = project.workspace_id AND pc.id = project.case_id) AS "partyId"
           FROM delivery_projects project WHERE project.workspace_id = $1 AND project.id = $2`;
  const result = await db.query<Omit<Job, "kind">>(sql, [workspaceId, id]);
  const row = result.rows[0];
  return row ? { kind, ...row } : null;
}

/** The job a chat may be filed into: it must exist and belong to the chat's contact. */
export async function requireJobForChat(db: Db, workspaceId: string, chat: { party_id?: unknown }, kind: JobKind, id: string) {
  const job = await findJob(db, workspaceId, kind, id);
  if (!job) throw new UnprocessableEntityException("That job no longer exists");
  if (chat.party_id && job.partyId && job.partyId !== chat.party_id) throw new UnprocessableEntityException("This job belongs to another client");
  return job;
}

/** "E-1042 · Villa" or the title alone: how a job is named in chips and notices. */
export function jobLabel(job: { reference?: string | null; title?: string | null }) {
  return [job.reference, job.title].filter((part) => part && String(part).trim()).join(" · ") || "a job";
}

type Candidate = { kind: JobKind; id: string; status?: string | null; updatedAt?: string | Date | null };

/**
 * The job a chat most likely belongs to when it is not filed yet, so the inbox can propose it ("AI proposes,
 * people confirm"): the contact's active project, else their open opportunity, else their open enquiry; the
 * most recently touched one of its kind. Nothing when the contact has no live job.
 */
export function suggestJob(candidates: Candidate[]): Candidate | null {
  const live: Record<JobKind, (status: string | null | undefined) => boolean> = {
    project: (status) => status === "active" || status === "on_hold",
    opportunity: (status) => status === "open",
    enquiry: (status) => ["new", "attempting_contact", "connected", "nurturing", "paused", "qualified"].includes(status ?? ""),
  };
  const rank: Record<JobKind, number> = { project: 0, opportunity: 1, enquiry: 2 };
  const at = (value: Candidate["updatedAt"]) => (value ? new Date(value).getTime() : 0);
  return candidates.filter((candidate) => live[candidate.kind](candidate.status))
    .sort((left, right) => rank[left.kind] - rank[right.kind] || at(right.updatedAt) - at(left.updatedAt))[0] ?? null;
}

const WORD = /[\p{L}\p{N}]{3,}/gu;
const STOP = new Set(["the", "and", "for", "you", "your", "with", "this", "that", "are", "our", "can", "please", "hello", "thanks", "thank", "have", "will", "from", "about"]);

/**
 * Quick replies that fit the conversation, ranked without a model: words the client just used that a reply
 * answers count most, then the reply's shortcut named in the message. Ties keep the firm's order. Top three.
 */
export function rankQuickReplies<T extends { shortcut: string; body: string; status?: string }>(replies: T[], context: { lastInbound: string | null; hasEnquiry: boolean }): T[] {
  const words = new Set((context.lastInbound ?? "").toLowerCase().match(WORD)?.filter((word) => !STOP.has(word)) ?? []);
  const scored = replies.filter((reply) => reply.status !== "archived").map((reply, index) => {
    const text = `${reply.shortcut} ${reply.body}`.toLowerCase();
    const replyWords = new Set(text.match(WORD)?.filter((word) => !STOP.has(word)) ?? []);
    let score = 0;
    for (const word of words) if (replyWords.has(word)) score += 2;
    if (words.has(reply.shortcut.toLowerCase())) score += 3;
    // Without an enquiry the conversation is at the door: welcome, form and address replies come first.
    if (!context.hasEnquiry && /^(welcome|hello|hi|form|enquiry|address|hours|catalog)/.test(reply.shortcut.toLowerCase())) score += 1;
    return { reply, score, index };
  });
  return scored.filter((item) => item.score > 0 || !words.size).sort((left, right) => right.score - left.score || left.index - right.index).slice(0, 3).map((item) => item.reply);
}
