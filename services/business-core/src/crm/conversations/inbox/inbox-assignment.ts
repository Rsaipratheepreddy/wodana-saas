import type { PoolClient } from "pg";
import { inTurnOrder, queueAssignmentMode, takeTurn } from "../../leads/round-robin";

type Db = Pick<PoolClient, "query">;

/** Active members who can open the inbox. Owners are only ever chosen from these. */
export const INBOX_MEMBERS_SQL = `SELECT membership.id AS "membershipId", membership.user_id AS "userId",
         coalesce(nullif(btrim(account.display_name), ''), account.primary_email) AS "displayName"
    FROM workspace_memberships membership
    JOIN users account ON account.id = membership.user_id AND account.status = 'active'
   WHERE membership.workspace_id = $1 AND membership.status = 'active'
     AND EXISTS (SELECT 1 FROM effective_member_roles assigned
                   JOIN role_permissions granted ON granted.role_id = assigned.role_id
                   JOIN permissions permission ON permission.id = granted.permission_id
                  WHERE assigned.workspace_id = membership.workspace_id AND assigned.membership_id = membership.id
                    AND permission.code = 'crm.communications.view')`;

/** Away means on every queue the person belongs to they are unavailable (leave, off shift). */
const AWAY_SQL = (column: string) => `(EXISTS (SELECT 1 FROM crm_effective_queue_members queue_member
    WHERE queue_member.workspace_id = $1 AND queue_member.membership_id = ${column})
  AND NOT EXISTS (SELECT 1 FROM crm_effective_queue_members queue_member
    WHERE queue_member.workspace_id = $1 AND queue_member.membership_id = ${column} AND queue_member.is_available
      AND (queue_member.unavailable_until IS NULL OR queue_member.unavailable_until <= now())))`;

const PARTY_CASES = `SELECT pc.id FROM pre_project_cases pc JOIN crm_opportunities opportunity
  ON opportunity.workspace_id = pc.workspace_id AND opportunity.id = pc.opportunity_id
  WHERE pc.workspace_id = $1 AND opportunity.party_id = $2`;

export type InboxSelection = {
  ownerMembershipId: string | null;
  method: "relationship" | "queue" | null;
  /** Why this person (or nobody), in plain words for the thread and the audit. */
  reason: string;
  queueId: string | null;
};

/**
 * The person who already looks after this client, most specific first: the open enquiry's owner,
 * the open opportunity's owner, the active project's manager, then the client's account owner.
 * Only people who can open the inbox and are not away are chosen.
 */
export async function relationshipOwner(db: Db, workspaceId: string, partyId: string, leadId: string | null) {
  const result = await db.query<{ membershipId: string; reason: string }>(
    `SELECT candidate.membership_id AS "membershipId", candidate.reason
       FROM (
         SELECT lead.owner_membership_id AS membership_id, 'enquiry' AS reason, 1 AS rank, lead.updated_at AS at
           FROM crm_leads lead
          WHERE lead.workspace_id = $1 AND (lead.party_id = $2 OR lead.id = $3::uuid)
            AND lead.owner_membership_id IS NOT NULL
            AND lead.status IN ('new','attempting_contact','connected','nurturing','paused')
         UNION ALL
         SELECT opportunity.owner_membership_id, 'opportunity', 2, opportunity.updated_at
           FROM crm_opportunities opportunity
          WHERE opportunity.workspace_id = $1 AND opportunity.party_id = $2 AND opportunity.status = 'open'
            AND opportunity.owner_membership_id IS NOT NULL
         UNION ALL
         SELECT assignment.membership_id, 'project', 3, project.updated_at
           FROM delivery_projects project
           JOIN project_assignments assignment ON assignment.workspace_id = project.workspace_id
            AND assignment.project_id = project.id AND assignment.is_manager AND assignment.active
          WHERE project.workspace_id = $1 AND project.status = 'active' AND project.case_id IN (${PARTY_CASES})
         UNION ALL
         SELECT party.owner_membership_id, 'client', 4, party.updated_at
           FROM crm_parties party
          WHERE party.workspace_id = $1 AND party.id = $2 AND party.owner_membership_id IS NOT NULL
       ) candidate
      WHERE candidate.membership_id IN (SELECT inbox."membershipId" FROM (${INBOX_MEMBERS_SQL}) inbox)
        AND NOT ${AWAY_SQL("candidate.membership_id")}
      ORDER BY candidate.rank, candidate.at DESC
      LIMIT 1`,
    [workspaceId, partyId, leadId],
  );
  return result.rows[0] ?? null;
}

/** The queue new chats go to: the inbox setting, a routing rule for the channel, then the workspace fallback. */
export async function inboxQueue(db: Db, workspaceId: string, channel: string) {
  const result = await db.query<{ id: string; name: string }>(
    `SELECT queue.id, queue.name FROM crm_queues queue
      WHERE queue.workspace_id = $1 AND queue.status = 'active'
      ORDER BY (queue.id = (SELECT settings.queue_id FROM crm_inbox_settings settings WHERE settings.workspace_id = $1)) DESC NULLS LAST,
               EXISTS (SELECT 1 FROM crm_assignment_rules rule WHERE rule.workspace_id = $1 AND rule.queue_id = queue.id
                          AND rule.status = 'active' AND rule.conditions->>'channel' = $2) DESC,
               queue.is_fallback DESC, queue.created_at
      LIMIT 1`,
    [workspaceId, channel],
  );
  return result.rows[0] ?? null;
}

/**
 * The next person in the inbox queue, skipping people who are away or full. A balanced queue picks the lightest load
 * (open chats against capacity and weight; the cursor breaks ties); a round-robin queue takes strict turns, sharing its
 * cursor with the queue's enquiries. Serialised per workspace so two chats arriving together never pick the same slot.
 */
export async function queueMember(db: Db, workspaceId: string, queueId: string) {
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${workspaceId}:inbox-assignment`]);
  const queue = await db.query<{ cursor: number; mode: string | null }>(
    `SELECT round_robin_cursor AS cursor, assignment_mode AS mode FROM crm_queues WHERE workspace_id = $1 AND id = $2 FOR UPDATE`,
    [workspaceId, queueId],
  );
  const candidates = await db.query<{ membershipId: string; capacity: number; weight: number; load: number; free: boolean }>(
    `SELECT member.membership_id AS "membershipId", member.capacity, member.weight,
            (SELECT count(*) FROM crm_conversations chat
              WHERE chat.workspace_id = member.workspace_id AND chat.owner_membership_id = member.membership_id
                AND chat.status = 'open')::int AS load,
            (member.is_available AND (member.unavailable_until IS NULL OR member.unavailable_until <= now())
              AND member.membership_id IN (SELECT inbox."membershipId" FROM (${INBOX_MEMBERS_SQL}) inbox)) AS free
       FROM crm_effective_queue_members member
      WHERE member.workspace_id = $1 AND member.queue_id = $2
      ORDER BY member.membership_id`,
    [workspaceId, queueId],
  );
  const canTake = (candidate: { load: number; capacity: number; free: boolean }) => candidate.free && candidate.load < Math.max(1, Number(candidate.capacity));
  if (queueAssignmentMode(queue.rows[0]?.mode) === "round_robin") {
    const turn = takeTurn(inTurnOrder(candidates.rows), Number(queue.rows[0]?.cursor ?? 0), canTake);
    if (!turn) return null;
    await db.query(`UPDATE crm_queues SET round_robin_cursor = $3, version = version + 1 WHERE workspace_id = $1 AND id = $2`, [workspaceId, queueId, turn.next]);
    return turn.person.membershipId;
  }
  const open = candidates.rows.filter(canTake);
  if (!open.length) return null;
  const ratio = (candidate: { load: number; capacity: number; weight: number }) => candidate.load / Math.max(1, candidate.capacity) / Math.max(1, candidate.weight);
  const best = Math.min(...open.map(ratio));
  const tied = open.filter((candidate) => ratio(candidate) === best);
  const cursor = await db.query<{ cursor: number }>(
    `UPDATE crm_queues SET round_robin_cursor = round_robin_cursor + 1, version = version + 1
      WHERE workspace_id = $1 AND id = $2 RETURNING round_robin_cursor - 1 AS cursor`,
    [workspaceId, queueId],
  );
  return tied[Number(cursor.rows[0]?.cursor ?? 0) % tied.length].membershipId;
}

/** Relationship first, then the queue; nobody when auto-assign is off or everyone is away or full. */
export async function selectInboxOwner(db: Db, workspaceId: string, chat: { partyId: string | null; leadId: string | null; channel: string }): Promise<InboxSelection> {
  const settings = await db.query<{ autoAssign: boolean }>(`SELECT auto_assign AS "autoAssign" FROM crm_inbox_settings WHERE workspace_id = $1`, [workspaceId]);
  if (settings.rows[0]?.autoAssign === false) return { ownerMembershipId: null, method: null, reason: "Auto-assign is off", queueId: null };
  if (chat.partyId) {
    const known = await relationshipOwner(db, workspaceId, chat.partyId, chat.leadId);
    if (known) {
      const reason = { enquiry: "Owns the client's enquiry", opportunity: "Owns the client's opportunity", project: "Manages the client's project", client: "Looks after this client" }[known.reason] ?? "Looks after this client";
      return { ownerMembershipId: known.membershipId, method: "relationship", reason, queueId: null };
    }
  }
  const queue = await inboxQueue(db, workspaceId, chat.channel);
  if (!queue) return { ownerMembershipId: null, method: null, reason: "No sales queue is set up", queueId: null };
  const member = await queueMember(db, workspaceId, queue.id);
  return member
    ? { ownerMembershipId: member, method: "queue", reason: "Next in the sales queue", queueId: queue.id }
    : { ownerMembershipId: null, method: null, reason: "Everyone in the sales queue is away or full", queueId: queue.id };
}
