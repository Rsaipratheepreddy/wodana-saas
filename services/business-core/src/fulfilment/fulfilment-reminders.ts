import type { PoolClient } from "pg";
import { notifyUserInApp, queueUserEmail } from "../notifications/default-templates";
import { readCalendar } from "../project-core/work-calendar";
import { fulfilmentPlan } from "./deal-fulfilment";
import { dealRule } from "./fulfilment-rules";
import { readFacts } from "./fulfilment.service";

type Db = Pick<PoolClient, "query">;

/**
 * PLM-126: a won order past its expected date and not yet with the client tells its owner and whoever booked its
 * delivery, once per expected date (a changed lead time or a later anchor makes a new date). Runs in the daily
 * reminders run, inside the workspace's tenant transaction.
 */
export async function processFulfilmentDeadlines(db: Db, workspaceId: string) {
  const deals = (await db.query<{ id: string; title: string; ownerId: string | null; bookedBy: string | null }>(
    `SELECT opportunity.id, concat_ws(' · ', opportunity.reference, coalesce(party.display_name, opportunity.title)) AS title, owner.user_id AS "ownerId",
            deal.delivery_booked_by AS "bookedBy"
       FROM crm_opportunities opportunity
       LEFT JOIN crm_parties party ON party.workspace_id = opportunity.workspace_id AND party.id = opportunity.party_id
       LEFT JOIN workspace_memberships owner ON owner.workspace_id = opportunity.workspace_id AND owner.id = opportunity.owner_membership_id AND owner.status = 'active'
       LEFT JOIN crm_deal_fulfilment deal ON deal.workspace_id = opportunity.workspace_id AND deal.opportunity_id = opportunity.id
      WHERE opportunity.workspace_id = $1 AND opportunity.status = 'won' AND opportunity.furniture_path IS NOT NULL AND deal.cancelled_at IS NULL
        AND opportunity.closed_at > now() - interval '1 year'
        AND NOT EXISTS (SELECT 1 FROM crm_deal_fulfilment_events event WHERE event.workspace_id = opportunity.workspace_id AND event.opportunity_id = opportunity.id
                         AND event.event IN ('collected', 'delivered'))
      ORDER BY opportunity.closed_at LIMIT 500`, [workspaceId])).rows;
  if (!deals.length) return { sent: 0 };
  const calendar = await readCalendar(db, workspaceId);
  const today = (await db.query<{ today: string }>(`SELECT (now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::date::text AS today FROM workspaces WHERE id = $1`,
    [workspaceId])).rows[0].today;
  let sent = 0;
  for (const deal of deals) {
    const rule = await dealRule(db, workspaceId, deal.id);
    if (!rule) continue;
    const plan = fulfilmentPlan(rule.furniturePath, rule, await readFacts(db, workspaceId, rule), calendar, today);
    if (!plan.late || !plan.expected) continue;
    for (const userId of new Set([deal.ownerId, deal.bookedBy].filter((id): id is string => Boolean(id)))) {
      const message = { workspaceId, recipientUserId: userId, code: "fulfilment.late", eventType: "fulfilment.late", variables: { deal: deal.title, date: plan.expected.by },
        deepLink: `/workspace/crm/opportunities?record=${deal.id}` };
      const key = `fulfilment.late:${deal.id}:${plan.expected.by}:${userId}`;
      const result = await notifyUserInApp(db, { ...message, idempotencyKey: key });
      await queueUserEmail(db, { ...message, idempotencyKey: `${key}:email` });
      if (result.queued) sent += 1;
    }
  }
  return { sent };
}
