import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { recordAudit } from "../audit/record-audit";
import { notifyUserInApp } from "../notifications/default-templates";

type Db = Pick<PoolClient, "query">;

/**
 * Everything a person leaving the firm still holds, by module (SP-4). Each area is an UPDATE that hands the open
 * items to the successor and a COUNT that previews it with the same WHERE; nothing done or closed moves.
 */
export const OFFBOARDING_AREAS = [
  { key: "enquiries", label: "Enquiries", table: "crm_leads", column: "owner_membership_id",
    open: `status NOT IN ('qualified', 'disqualified', 'duplicate')` },
  { key: "opportunities", label: "Opportunities", table: "crm_opportunities", column: "owner_membership_id", open: `status = 'open'` },
  { key: "followUps", label: "Follow-ups", table: "crm_activities", column: "owner_membership_id", open: `status = 'pending'` },
  { key: "chats", label: "Chats", table: "crm_conversations", column: "owner_membership_id", open: `status IN ('open', 'unresolved', 'snoozed')` },
  { key: "clients", label: "Clients", table: "crm_parties", column: "owner_membership_id", open: `true` },
  { key: "planning", label: "Planning cases", table: "pre_project_cases", column: "owner_membership_id", open: `status IN ('draft', 'active', 'on_hold')` },
  { key: "tasks", label: "Project tasks", table: "work_items", column: "assignee_membership_id", open: `status NOT IN ('done', 'cancelled')` },
] as const;

export type OffboardingCounts = Record<(typeof OFFBOARDING_AREAS)[number]["key"] | "projects", number>;

type Member = { id: string; userId: string; name: string; status: string; version: number; owner: boolean };

async function member(db: Db, workspaceId: string, membershipId: string, lock = false): Promise<Member | null> {
  return (await db.query<Member>(
    `SELECT membership.id, membership.user_id AS "userId", coalesce(nullif(btrim(account.display_name), ''), account.primary_email) AS name,
            membership.status::text AS status, membership.version,
            EXISTS (SELECT 1 FROM effective_member_roles effective JOIN roles role ON role.id = effective.role_id
                     WHERE effective.membership_id = membership.id AND role.code = 'owner' AND role.is_system) AS owner
       FROM workspace_memberships membership JOIN users account ON account.id = membership.user_id
      WHERE membership.workspace_id = $1 AND membership.id = $2 ${lock ? "FOR UPDATE OF membership" : ""}`, [workspaceId, membershipId])).rows[0] ?? null;
}

/** What the person holds today, per area, and the projects they manage. */
export async function offboardingCounts(db: Db, workspaceId: string, membershipId: string): Promise<OffboardingCounts> {
  const counts = {} as OffboardingCounts;
  for (const area of OFFBOARDING_AREAS) {
    counts[area.key] = Number((await db.query<{ n: string }>(
      `SELECT count(*) AS n FROM ${area.table} WHERE workspace_id = $1 AND ${area.column} = $2 AND ${area.open}`, [workspaceId, membershipId])).rows[0]?.n ?? 0);
  }
  counts.projects = Number((await db.query<{ n: string }>(
    `SELECT count(*) AS n FROM project_assignments WHERE workspace_id = $1 AND membership_id = $2 AND active`, [workspaceId, membershipId])).rows[0]?.n ?? 0);
  return counts;
}

export async function offboardingPreview(db: Db, workspaceId: string, membershipId: string) {
  const person = await member(db, workspaceId, membershipId);
  if (!person) throw new NotFoundException("Member not found");
  const successors = (await db.query<{ id: string; name: string }>(
    `SELECT membership.id, coalesce(nullif(btrim(account.display_name), ''), account.primary_email) AS name
       FROM workspace_memberships membership JOIN users account ON account.id = membership.user_id
      WHERE membership.workspace_id = $1 AND membership.status = 'active' AND membership.id <> $2 ORDER BY 2`, [workspaceId, membershipId])).rows;
  return { member: { id: person.id, name: person.name, status: person.status, version: person.version }, counts: await offboardingCounts(db, workspaceId, membershipId), successors };
}

/**
 * Offboards a person in one audited command: every open item goes to the successor (enquiries, opportunities,
 * follow-ups, chats, the clients they own, planning cases, project tasks, the projects they're on, the Sales
 * admin role), they leave the assignment queues, their phones stop receiving notices, and their membership is
 * suspended, which releases the seat. The successor hears what they took over. Refused for the last owner, for
 * yourself, and when the member changed since the preview (version).
 */
export async function offboardMember(db: Db, input: { workspaceId: string; membershipId: string; successorMembershipId: string; version: number; actorUserId: string }) {
  const { workspaceId, membershipId, successorMembershipId } = input;
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`workspace-members:${workspaceId}`]);
  const person = await member(db, workspaceId, membershipId, true);
  if (!person) throw new NotFoundException("Member not found");
  if (person.userId === input.actorUserId) throw new BadRequestException("You can't offboard yourself. Ask another administrator.");
  if (person.version !== input.version) throw new ConflictException("This person changed. Reload and try again.");
  if (successorMembershipId === membershipId) throw new BadRequestException("Choose someone else to take over.");
  const successor = await member(db, workspaceId, successorMembershipId);
  if (!successor || successor.status !== "active") throw new BadRequestException("Choose an active member to take over.");
  if (person.owner) {
    const others = await db.query(
      `SELECT 1 FROM workspace_memberships membership JOIN effective_member_roles effective ON effective.membership_id = membership.id
         JOIN roles role ON role.id = effective.role_id AND role.code = 'owner' AND role.is_system
        WHERE membership.workspace_id = $1 AND membership.status = 'active' AND membership.id <> $2 LIMIT 1`, [workspaceId, membershipId]);
    if (!others.rowCount) throw new ConflictException("The workspace needs another active owner first.");
  }

  const moved = {} as OffboardingCounts;
  for (const area of OFFBOARDING_AREAS) {
    const rows = (await db.query<{ id: string }>(
      `UPDATE ${area.table} SET ${area.column} = $3, version = version + 1
        WHERE workspace_id = $1 AND ${area.column} = $2 AND ${area.open} RETURNING id`, [workspaceId, membershipId, successorMembershipId])).rows;
    moved[area.key] = rows.length;
    // An enquiry's owner history says who took it over, and why.
    if (area.key === "enquiries") for (const lead of rows) await db.query(
      `INSERT INTO crm_assignment_history (workspace_id, lead_id, previous_owner_membership_id, owner_membership_id, assignment_method, reason, assigned_by)
       VALUES ($1, $2, $3, $4, 'manual', 'Offboarding', $5)`, [workspaceId, lead.id, membershipId, successorMembershipId, input.actorUserId]);
  }
  // Projects: the successor joins each project the person was on, in the same role; the person leaves it.
  const assignments = (await db.query<{ projectId: string | null; caseId: string | null; isManager: boolean; roleKeys: string[] }>(
    `SELECT project_id AS "projectId", case_id AS "caseId", is_manager AS "isManager", role_keys AS "roleKeys"
       FROM project_assignments WHERE workspace_id = $1 AND membership_id = $2 AND active`, [workspaceId, membershipId])).rows;
  for (const assignment of assignments) {
    const target = assignment.projectId ? "project_id" : "case_id";
    const targetId = assignment.projectId ?? assignment.caseId;
    const existing = await db.query(
      `UPDATE project_assignments SET active = true, is_manager = is_manager OR $4, role_keys = ARRAY(SELECT DISTINCT unnest(role_keys || $5::text[]))
        WHERE workspace_id = $1 AND ${target} = $2 AND membership_id = $3 RETURNING id`,
      [workspaceId, targetId, successorMembershipId, assignment.isManager, assignment.roleKeys ?? []]);
    if (!existing.rowCount) await db.query(
      `INSERT INTO project_assignments (id, workspace_id, ${target}, membership_id, is_manager, active, role_keys) VALUES (gen_random_uuid(), $1, $2, $3, $4, true, $5::text[])`,
      [workspaceId, targetId, successorMembershipId, assignment.isManager, assignment.roleKeys ?? []]);
  }
  moved.projects = assignments.length;
  await db.query(`UPDATE project_assignments SET active = false WHERE workspace_id = $1 AND membership_id = $2 AND active`, [workspaceId, membershipId]);
  await db.query(`UPDATE workspace_sales_settings SET sales_admin_membership_id = $3 WHERE workspace_id = $1 AND sales_admin_membership_id = $2`, [workspaceId, membershipId, successorMembershipId]);
  const queues = (await db.query(`DELETE FROM crm_queue_members WHERE workspace_id = $1 AND membership_id = $2`, [workspaceId, membershipId])).rowCount ?? 0;
  const devices = (await db.query(
    `UPDATE device_endpoints SET status = 'revoked', updated_at = now(), version = version + 1 WHERE workspace_id = $1 AND user_id = $2 AND status = 'active'`,
    [workspaceId, person.userId])).rowCount ?? 0;
  await db.query(`UPDATE workspace_memberships SET status = 'suspended', version = version + 1 WHERE workspace_id = $1 AND id = $2`, [workspaceId, membershipId]);

  const after = { successorMembershipId, moved, queues, devices, status: "suspended" };
  await recordAudit(db, { workspaceId, actorUserId: input.actorUserId, action: "workspace.member_offboarded", entityType: "workspace_membership", entityId: membershipId,
    before: { status: person.status }, after });
  const summary = [...OFFBOARDING_AREAS.map((area) => [area.label, moved[area.key]] as const), ["Projects", moved.projects] as const]
    .filter(([, count]) => count > 0).map(([label, count]) => `${count} ${label.toLowerCase()}`).join(", ");
  await notifyUserInApp(db, { workspaceId, recipientUserId: successor.userId, code: "workspace.work_handed_over", eventType: "workspace.work_handed_over",
    variables: { memberName: person.name, note: summary || "Nothing was open." }, deepLink: "/workspace",
    idempotencyKey: `workspace.work_handed_over:${membershipId}:${person.version}:${successor.userId}` });
  return { ...after, userId: person.userId, name: person.name };
}
