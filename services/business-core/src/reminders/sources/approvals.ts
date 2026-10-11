import { waitingFor, type ApprovalContext, type ApprovalRow } from "../../approvals/approval-sources";
import type { Db, DueItem, ReminderSource } from "../engine/engine";
import { UUID } from "./support";

type Person = { membershipId: string; userId: string; name: string; permissions: string[] };

async function readPeople(db: Db, workspaceId: string, membershipIds?: readonly string[]): Promise<Person[]> {
  return (await db.query<Person>(
    `SELECT membership.id AS "membershipId", membership.user_id AS "userId", coalesce(nullif(btrim(account.display_name), ''), account.primary_email) AS name,
            coalesce(array_agg(DISTINCT permission.code) FILTER (WHERE permission.code IS NOT NULL), '{}') AS permissions
       FROM workspace_memberships membership
       JOIN users account ON account.id = membership.user_id
       LEFT JOIN effective_member_roles assigned ON assigned.membership_id = membership.id
       LEFT JOIN role_permissions granted ON granted.role_id = assigned.role_id
       LEFT JOIN permissions permission ON permission.id = granted.permission_id
      WHERE membership.workspace_id = $1 AND membership.status = 'active' AND ($2::uuid[] IS NULL OR membership.id = ANY($2::uuid[]))
      GROUP BY membership.id, membership.user_id, account.display_name, account.primary_email
      ORDER BY membership.id`, [workspaceId, membershipIds ?? null])).rows;
}

/** What waits for one person to decide: the central approvals feed ("Waiting for you"), the rows they may decide. */
async function decidable(db: Db, workspaceId: string, person: Person, currency: string): Promise<ApprovalRow[]> {
  const granted = new Set(person.permissions);
  const managed = (await db.query<{ projectId: string }>(
    `SELECT DISTINCT project_id AS "projectId" FROM project_assignments WHERE workspace_id = $1 AND membership_id = $2 AND active AND is_manager AND project_id IS NOT NULL`,
    [workspaceId, person.membershipId])).rows.map((row) => row.projectId);
  const context: ApprovalContext = { workspaceId, userId: person.userId, displayName: person.name, membershipId: person.membershipId,
    can: async (permission) => granted.has(permission), managedProjects: new Set(managed), currency };
  return (await waitingFor(db, context)).rows.filter((row) => row.canDecide);
}

const keyOf = (row: Pick<ApprovalRow, "kind" | "id">, membershipId: string) => `approval:${row.kind}:${row.id}:${membershipId}`;

/** E3 requests whose policy escalates by itself (the engine then only reminds). */
async function selfEscalating(db: Db, workspaceId: string, rows: readonly ApprovalRow[]): Promise<Set<string>> {
  const ids = rows.filter((row) => row.kind === "approval" && UUID.test(row.id)).map((row) => row.id);
  if (!ids.length) return new Set();
  return new Set((await db.query<{ id: string }>(
    `SELECT request.id FROM approval_requests request JOIN approval_policy_versions version_row ON version_row.workspace_id = request.workspace_id AND version_row.id = request.policy_version_id
      WHERE request.workspace_id = $1 AND request.id = ANY($2::uuid[]) AND version_row.escalate_after_hours IS NOT NULL`, [workspaceId, ids])).rows.map((row) => row.id));
}

/**
 * approval.waiting (critical; replaces the sends of chaseApprovals): one subject per approval and per person who may
 * decide it, from the central approvals feed. Reminded after 24 and 48 hours (the firm's approval reminder hours,
 * copied into its rule), then the owners hear it, unless the E3 policy escalates by itself (its escalation still runs
 * in the daily run). Done when the feed no longer lists it for that person.
 */
export const approvalWaitingSource: ReminderSource = {
  kind: "approval.waiting", module: "approvals", audience: "staff", critical: true, notify: "engine",
  viewPermission: "reminders.team", template: { code: "reminders.approval.waiting" },
  async open(db, workspaceId, { limit }) {
    const currency = (await db.query<{ currency: string }>(`SELECT default_currency AS currency FROM workspaces WHERE id = $1`, [workspaceId])).rows[0]?.currency ?? "";
    const items: DueItem[] = [];
    for (const person of await readPeople(db, workspaceId)) {
      if (items.length >= limit) break;
      const rows = await decidable(db, workspaceId, person, currency);
      const own = await selfEscalating(db, workspaceId, rows);
      for (const row of rows) {
        items.push({
          key: keyOf(row, person.membershipId), sourceType: "approval", sourceId: row.id,
          jobSource: row.project ? { type: "project", id: row.project.id } : null, projectId: row.project?.id ?? null, caseId: null, partyId: null,
          ownerMembershipId: person.membershipId, ccMembershipIds: [], dueAt: new Date(row.since), title: row.title,
          context: row.subject ?? (row.project ? [row.project.reference, row.project.name].filter(Boolean).join(" · ") : ""),
          href: row.href?.startsWith("/workspace") ? row.href : "/workspace/approvals",
          variables: own.has(row.id) ? { noEscalation: "true" } : {},
        });
      }
    }
    return items.slice(0, limit);
  },
  async stillOpen(db, workspaceId, keys) {
    const wanted = new Map<string, Set<string>>();
    for (const key of keys) {
      const parts = key.split(":");
      if (parts[0] !== "approval" || parts.length !== 4 || !UUID.test(parts[3])) continue;
      wanted.set(parts[3], (wanted.get(parts[3]) ?? new Set()).add(key));
    }
    if (!wanted.size) return new Set();
    const currency = (await db.query<{ currency: string }>(`SELECT default_currency AS currency FROM workspaces WHERE id = $1`, [workspaceId])).rows[0]?.currency ?? "";
    const open = new Set<string>();
    for (const person of await readPeople(db, workspaceId, [...wanted.keys()])) {
      const listed = new Set((await decidable(db, workspaceId, person, currency)).map((row) => keyOf(row, person.membershipId)));
      for (const key of wanted.get(person.membershipId) ?? []) if (listed.has(key)) open.add(key);
    }
    return open;
  },
};
