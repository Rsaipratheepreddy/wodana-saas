import type { PoolClient } from "pg";
import { recordAudit } from "../../audit/record-audit";

type Db = Pick<PoolClient, "query">;

/**
 * A deal that is Won or Lost has nothing left to follow up: its open follow-ups (tasks, calls and messages still
 * pending; booked meetings are left to their own cancellation) are cancelled with the outcome as the reason, and the
 * opportunity's history says so in one line. Idempotent: a second call finds nothing pending.
 */
export async function cancelOpenFollowUps(db: Db, input: {
  workspaceId: string; opportunityId: string; outcome: "won" | "lost"; actorUserId: string | null; source?: "user" | "internal" | "client_portal";
}) {
  const cancelled = (await db.query<{ id: string; title: string; dueAt: Date | null }>(
    `UPDATE crm_activities SET status = 'cancelled', is_next_action = false, completion_outcome = $3, version = version + 1, updated_at = now()
      WHERE workspace_id = $1 AND opportunity_id = $2 AND status = 'pending' AND type <> 'meeting'
      RETURNING id, title, due_at AS "dueAt"`,
    [input.workspaceId, input.opportunityId, input.outcome === "won" ? "Opportunity won" : "Opportunity lost"])).rows;
  if (!cancelled.length) return [];
  await recordAudit(db, {
    workspaceId: input.workspaceId, actorUserId: input.actorUserId, source: input.source ?? "user", action: "crm.opportunity.follow_ups_cancelled.v1",
    entityType: "crm_opportunity", entityId: input.opportunityId,
    after: { outcome: input.outcome, followUps: cancelled.map((row) => ({ id: row.id, title: row.title, dueAt: row.dueAt })) },
  });
  return cancelled;
}
