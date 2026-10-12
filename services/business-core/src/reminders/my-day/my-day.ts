import {
  REMINDER_KIND_INFO, REMINDER_PERMISSIONS, WAITING_REMINDER_KINDS,
  type ReminderAudience, type ReminderKind, type ReminderModule,
} from "../reminders-contract";
import { localDate, type Db, type ReminderSourceRegistry } from "../engine/engine";
import { normalizeSubject, SUBJECT_COLUMNS, type SubjectRow } from "../engine/subjects";

// Structural copies of the My day shapes in packages/contracts/src/reminders.ts (business-core does not depend on contracts).
export type MyDayScope = "me" | "team";
export type MyDayUrgency = "overdue" | "today" | "upcoming" | "waiting" | "snoozed";
export type MyDayAction = "open" | "snooze" | "complete" | "reassign";
export type MyDayItem = {
  id: string; kind: ReminderKind; module: ReminderModule; variant?: string | null; title: string; context: string; href: string; dueAt: string | null; urgency: MyDayUrgency;
  critical: boolean; audience: ReminderAudience; owner: { membershipId: string; name: string } | null;
  reminders: { sent: number; escalationLevel: number; nextAt: string | null }; snoozed: { until: string; reason: string } | null;
  actions: MyDayAction[]; completeLabel: string | null; version: number;
};
export type MyDayGroup = { jobId: string | null; jobReference: string | null; title: string; href: string | null; items: MyDayItem[] };
export type MyDayCounts = { overdue: number; today: number; upcoming: number; waiting: number; snoozed: number; total: number };
export type MyDayResponse = { generatedAt: string; scope: MyDayScope; timeZone: string; today: string; counts: MyDayCounts; groups: MyDayGroup[] };

export const MY_DAY_URGENCIES: readonly MyDayUrgency[] = ["overdue", "today", "upcoming", "waiting", "snoozed"];
const URGENCY_ORDER: Record<MyDayUrgency, number> = { overdue: 0, today: 1, waiting: 2, upcoming: 3, snoozed: 4 };
/** The most items a My day read returns (the counts cover everything). */
export const MY_DAY_MAX = 500;

export type MyDayViewer = {
  workspaceId: string;
  membershipId: string;
  userId: string;
  /** The permissions the person holds that My day asks about (reminders.team, each source's view, pool and command permissions). */
  permissions: ReadonlySet<string>;
  /** The person's zone (their own, phone, profile, then the workspace's). */
  timeZone: string;
};

export type MyDayFilter = { scope?: MyDayScope; urgency?: MyDayUrgency; module?: ReminderModule; limit?: number };

/** Every permission My day may ask a viewer about, for one query of what they hold. */
export function myDayPermissionCodes(sources: ReminderSourceRegistry): string[] {
  const codes = new Set<string>([REMINDER_PERMISSIONS.team]);
  for (const source of sources.values()) {
    codes.add(source.viewPermission);
    if (source.poolPermission) codes.add(source.poolPermission);
    if (source.complete) codes.add(source.complete.permission);
    if (source.reassign) codes.add(source.reassign.permission);
  }
  return [...codes];
}

/** Where an item stands for the person today: snoozed, waiting on them, overdue, due today, or coming (a reminder is out). Null = not shown yet. */
export function urgencyOf(subject: Pick<SubjectRow, "kind" | "status" | "snoozedUntil" | "dueAt" | "remindersSent">, now: Date, timeZone: string): MyDayUrgency | null {
  if (subject.status === "snoozed" && subject.snoozedUntil && subject.snoozedUntil.getTime() > now.getTime()) return "snoozed";
  if ((WAITING_REMINDER_KINDS as readonly string[]).includes(subject.kind)) return "waiting";
  if (!subject.dueAt) return "today";
  const due = localDate(subject.dueAt, timeZone);
  const today = localDate(now, timeZone);
  if (due < today) return "overdue";
  if (due === today) return "today";
  return subject.remindersSent > 0 ? "upcoming" : null;
}

type Row = SubjectRow & { ownerName: string | null; jobReference: string | null; jobTitle: string | null; nextAt: Date | null; snoozedBy: string | null };

/** Which subjects the viewer sees: their own (owner or copied in) and unowned ones of their pools; the team view, every kind they may view. */
function visibility(viewer: MyDayViewer, sources: ReminderSourceRegistry, scope: MyDayScope) {
  const viewable = [...sources.values()].filter((source) => viewer.permissions.has(source.viewPermission)).map((source) => source.kind);
  const pooled = [...sources.values()].filter((source) => source.poolPermission && viewer.permissions.has(source.poolPermission)).map((source) => source.kind);
  return { team: scope === "team", kinds: [...sources.keys()], viewable, pooled };
}

/** The actions the viewer may take on an item. */
export function actionsFor(subject: Pick<SubjectRow, "kind" | "ownerMembershipId" | "ccMembershipIds">, viewer: MyDayViewer, sources: ReminderSourceRegistry): { actions: MyDayAction[]; completeLabel: string | null } {
  const source = sources.get(subject.kind);
  const mine = subject.ownerMembershipId === viewer.membershipId || subject.ccMembershipIds.includes(viewer.membershipId);
  const team = viewer.permissions.has(REMINDER_PERMISSIONS.team);
  const actions: MyDayAction[] = ["open"];
  if (mine || team || !subject.ownerMembershipId) actions.push("snooze");
  if (source?.complete && viewer.permissions.has(source.complete.permission)) actions.push("complete");
  if (source?.reassign && viewer.permissions.has(source.reassign.permission) && (mine || team)) actions.push("reassign");
  return { actions, completeLabel: actions.includes("complete") ? source!.complete!.label : null };
}

/** The record's own kind where one reminder kind covers several: an approval's kind ("receipt", "site_report"), from its key. */
export function variantOf(subject: Pick<SubjectRow, "kind" | "sourceKey">): string | null {
  if (subject.kind !== "approval.waiting") return null;
  const [prefix, kind] = subject.sourceKey.split(":");
  return prefix === "approval" && kind ? kind : null;
}

/**
 * One row per record: an invoice that is overdue is chased once ("Invoice overdue"), so the client payment stage it
 * bills ("Client payment due", the same invoice) is left out of the list and its counts; its client reminders still run.
 */
export function withoutDuplicates<T extends Pick<SubjectRow, "kind" | "href">>(rows: readonly T[]): T[] {
  const overdue = new Set(rows.filter((row) => row.kind === "invoice.overdue").map((row) => row.href));
  return rows.filter((row) => row.kind !== "payment.due" || !overdue.has(row.href));
}

export function toItem(row: Row, urgency: MyDayUrgency, viewer: MyDayViewer, sources: ReminderSourceRegistry): MyDayItem {
  const { actions, completeLabel } = actionsFor(row, viewer, sources);
  return {
    id: row.id, kind: row.kind, module: REMINDER_KIND_INFO[row.kind].module, variant: variantOf(row), title: row.title, context: row.context, href: row.href,
    dueAt: row.dueAt ? row.dueAt.toISOString() : null, urgency, critical: row.critical, audience: row.audience,
    owner: row.ownerMembershipId ? { membershipId: row.ownerMembershipId, name: row.ownerName ?? "" } : null,
    reminders: { sent: row.remindersSent, escalationLevel: row.escalationLevel, nextAt: row.nextAt ? new Date(row.nextAt).toISOString() : null },
    snoozed: urgency === "snoozed" && row.snoozedUntil ? { until: row.snoozedUntil.toISOString(), reason: row.snoozeReason ?? "" } : null,
    actions, completeLabel, version: row.version,
  };
}

/** Reads subjects the viewer may see (open or snoozed), with the owner's name, the job and the next step. */
export async function readVisibleSubjects(db: Db, viewer: MyDayViewer, sources: ReminderSourceRegistry, scope: MyDayScope, extra: { ids?: string[] } = {}): Promise<Row[]> {
  const seen = visibility(viewer, sources, scope);
  return (await db.query<Row>(
    `SELECT ${SUBJECT_COLUMNS}, coalesce(nullif(btrim(owner_account.display_name), ''), owner_account.primary_email) AS "ownerName",
            job_title.reference AS "jobReference", job_title.title AS "jobTitle", next_step.at AS "nextAt"
       FROM reminder_subjects subject
       LEFT JOIN workspace_memberships owner ON owner.workspace_id = subject.workspace_id AND owner.id = subject.owner_membership_id
       LEFT JOIN users owner_account ON owner_account.id = owner.user_id
       LEFT JOIN job_identities job ON job.workspace_id = subject.workspace_id AND job.id = subject.job_id
       LEFT JOIN LATERAL (
         SELECT named.title, named.reference FROM (
           (SELECT project.name AS title, nullif(project.reference, '') AS reference, 1 AS rank FROM job_identity_links link
              JOIN delivery_projects project ON project.workspace_id = link.workspace_id AND project.id::text = link.record_id
             WHERE link.workspace_id = job.workspace_id AND link.job_id = job.id AND link.record_type = 'project' AND link.status = 'active' ORDER BY link.attached_at DESC LIMIT 1)
           UNION ALL
           (SELECT opportunity.title, nullif(opportunity.reference, ''), 2 FROM crm_opportunities opportunity WHERE job.root_type = 'opportunity' AND opportunity.workspace_id = job.workspace_id AND opportunity.id = job.root_id)
           UNION ALL
           (SELECT enquiry.title, nullif(enquiry.reference, ''), 3 FROM crm_enquiries enquiry WHERE job.root_type = 'enquiry' AND enquiry.workspace_id = job.workspace_id AND enquiry.id = job.root_id)
         ) named ORDER BY named.rank LIMIT 1
       ) job_title ON job.id IS NOT NULL
       LEFT JOIN LATERAL (SELECT min(coalesce(step.held_until, step.fire_at)) AS at FROM reminder_steps step
                           WHERE step.workspace_id = subject.workspace_id AND step.subject_id = subject.id AND step.due_revision = subject.due_revision
                             AND step.state IN ('planned', 'held')) next_step ON true
      WHERE subject.workspace_id = $1 AND subject.status IN ('open', 'snoozed') AND subject.kind = ANY($2::text[])
        AND ($6::uuid[] IS NULL OR subject.id = ANY($6::uuid[]))
        AND (CASE WHEN $3::boolean THEN subject.kind = ANY($4::text[])
                  ELSE subject.owner_membership_id = $5 OR $5 = ANY(subject.cc_membership_ids) OR (subject.owner_membership_id IS NULL AND subject.kind = ANY($7::text[])) END)
      ORDER BY subject.due_at NULLS LAST, subject.id
      LIMIT ${MY_DAY_MAX * 2}`,
    [viewer.workspaceId, seen.kinds, seen.team, seen.viewable, viewer.membershipId, extra.ids ?? null, seen.pooled])).rows
    .map((row) => ({ ...normalizeSubject(row), ownerName: row.ownerName, jobReference: row.jobReference, jobTitle: row.jobTitle, nextAt: row.nextAt, snoozedBy: null }));
}

/**
 * My day for one person (plan §6.24a): counts by urgency over everything they see, then the items (filtered by urgency
 * and module) grouped by job (enquiry → case → project as one), overdue first. The engine's subjects are the source;
 * the caller re-checks the done predicate first so nothing finished is shown.
 */
export async function readMyDay(db: Db, viewer: MyDayViewer, sources: ReminderSourceRegistry, filter: MyDayFilter, now: Date): Promise<MyDayResponse> {
  const scope = filter.scope ?? "me";
  const rows = withoutDuplicates(await readVisibleSubjects(db, viewer, sources, scope));
  const counts: MyDayCounts = { overdue: 0, today: 0, upcoming: 0, waiting: 0, snoozed: 0, total: 0 };
  const items: MyDayItem[] = [];
  const groups = new Map<string, MyDayGroup>();
  const shown: Array<{ item: MyDayItem; row: Row }> = [];
  for (const row of rows) {
    const urgency = urgencyOf(row, now, viewer.timeZone);
    if (!urgency) continue;
    counts[urgency] += 1;
    if (urgency !== "snoozed") counts.total += 1;
    if (filter.urgency ? urgency !== filter.urgency : urgency === "snoozed") continue;
    if (filter.module && REMINDER_KIND_INFO[row.kind].module !== filter.module) continue;
    shown.push({ item: toItem(row, urgency, viewer, sources), row });
  }
  shown.sort((left, right) => URGENCY_ORDER[left.item.urgency] - URGENCY_ORDER[right.item.urgency]
    || Number(right.item.critical) - Number(left.item.critical)
    || (left.item.dueAt ?? "9999").localeCompare(right.item.dueAt ?? "9999") || left.item.id.localeCompare(right.item.id));
  for (const { item, row } of shown.slice(0, Math.min(filter.limit ?? MY_DAY_MAX, MY_DAY_MAX))) {
    items.push(item);
    const key = row.jobId ?? "";
    // The job is named by its project (else its deal or enquiry) and that record's reference; the job's own J- code is internal.
    const group = groups.get(key) ?? { jobId: row.jobId, jobReference: row.jobReference, title: row.jobId ? row.jobTitle ?? row.jobReference ?? "" : "", href: row.jobId ? `/workspace/jobs/${row.jobId}` : null, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  // Jobs in the order of their most urgent item; items with no job last.
  const ordered = [...groups.values()].sort((left, right) => Number(left.jobId === null) - Number(right.jobId === null));
  return { generatedAt: now.toISOString(), scope, timeZone: viewer.timeZone, today: localDate(now, viewer.timeZone), counts, groups: ordered };
}
