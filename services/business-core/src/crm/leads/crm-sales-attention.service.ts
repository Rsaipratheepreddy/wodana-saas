import { Injectable } from "@nestjs/common";
import type { PoolClient } from "pg";
import { DatabaseService } from "../../database/database.service";
import { CrmEventsService } from "../shared/crm-events.service";
import { CrmSlaLifecycleService } from "./crm-sla-lifecycle.service";
import {
  formatDeadline, isWorkingDay, leadFacts, leadLink, loadSalesSettings, localDay, memberPerson, refreshUnownedEscalation,
  salesEscalationRecipients, salesSchedule, tell, workspaceClock, WORKING_LEAD_STATUSES,
} from "./sales-attention";

const SERVICE_ACTOR_ID = "00000000-0000-0000-0000-000000000000";
/** The daily Sales digest goes out from this local time on a working day. */
const DIGEST_FROM_MINUTES = 9 * 60;

/**
 * The Sales timers that are not the response SLA or the takeover: an enquiry nobody owns (S-2), a
 * client nobody confirmed (S-3), a "come back later" date that arrived (S-27) and the morning digest
 * (S-7, S-26). The worker calls this with the takeovers; each pass runs in the workspace's own
 * tenant transaction and is safe to repeat.
 */
@Injectable()
export class CrmSalesAttentionService {
  constructor(
    private readonly database: DatabaseService,
    private readonly events: CrmEventsService,
    private readonly slas: CrmSlaLifecycleService = new CrmSlaLifecycleService(),
  ) {}

  processDueAttentionInternal(workspaceId: string, limit = 100, now = new Date()) {
    return this.database.tenantTransaction(workspaceId, SERVICE_ACTOR_ID, async (client) => {
      const safeLimit = Math.min(Math.max(limit, 1), 200);
      const unowned = await this.escalateUnowned(client, workspaceId, safeLimit);
      const reviews = await this.escalateClientReviews(client, workspaceId, safeLimit);
      const woken = await this.wakePaused(client, workspaceId, safeLimit, now);
      const digest = await this.sendDigest(client, workspaceId, now);
      return { unowned, reviews, woken, digest };
    });
  }

  /** S-2: after its window without an owner, the Sales admin and the Owner are told and the response task turns urgent. */
  async escalateUnowned(client: PoolClient, workspaceId: string, limit: number) {
    const due = await client.query<{ id: string; ownerMembershipId: string | null; status: string; dueAt: Date }>(
      `SELECT id, owner_membership_id AS "ownerMembershipId", status::text AS status, escalation_due_at AS "dueAt" FROM crm_leads
        WHERE workspace_id = $1 AND escalation_due_at <= now()
        ORDER BY escalation_due_at, id FOR UPDATE SKIP LOCKED LIMIT $2`, [workspaceId, limit]);
    const escalated: string[] = [];
    if (!due.rowCount) return escalated;
    const settings = await loadSalesSettings(client, workspaceId);
    const recipients = await salesEscalationRecipients(client, workspaceId);
    for (const lead of due.rows) {
      if (lead.ownerMembershipId || !WORKING_LEAD_STATUSES.includes(lead.status)) {
        await refreshUnownedEscalation(client, workspaceId, lead.id);
        continue;
      }
      await client.query(`UPDATE crm_leads SET escalation_due_at = NULL, escalated_at = now(), priority = 'urgent' WHERE workspace_id = $1 AND id = $2`, [workspaceId, lead.id]);
      await client.query(
        `UPDATE crm_activities SET priority = 'urgent', version = version + 1, updated_at = now()
          WHERE workspace_id = $1 AND lead_id = $2 AND sla_instance_id IS NOT NULL AND status = 'pending'`, [workspaceId, lead.id]);
      const facts = await this.facts(client, workspaceId, lead.id);
      const told = await tell(client, workspaceId, recipients, {
        code: "crm.lead_unowned", channels: ["in_app", "push", "email"], deepLink: leadLink(lead.id),
        variables: { ...facts, minutes: String(settings.unownedEscalationMinutes) }, key: `crm:unowned:${lead.id}:${new Date(lead.dueAt).toISOString()}`,
      });
      await this.events.record(client, {
        workspaceId, actorUserId: null, source: "automation", action: "crm.lead.unowned_escalated.v1",
        entityType: "crm_lead", entityId: lead.id,
        after: { minutes: settings.unownedEscalationMinutes, recipients: recipients.map((person) => person.membershipId), told },
      });
      escalated.push(lead.id);
    }
    return escalated;
  }

  /** S-3: a form enquiry whose client may already exist is worked at once; if nobody confirms the client in time, the admin is told. */
  async escalateClientReviews(client: PoolClient, workspaceId: string, limit: number) {
    const due = await client.query<{ id: string; ownerMembershipId: string | null; pending: number }>(
      `SELECT lead.id, lead.owner_membership_id AS "ownerMembershipId",
              (SELECT count(*)::int FROM crm_identity_candidates candidate
                 JOIN crm_enquiries enquiry ON enquiry.workspace_id = lead.workspace_id AND enquiry.id = lead.enquiry_id
                WHERE candidate.workspace_id = lead.workspace_id AND candidate.intake_event_id = enquiry.intake_event_id
                  AND candidate.status = 'pending') AS pending
         FROM crm_leads lead
        WHERE lead.workspace_id = $1 AND lead.client_review_due_at <= now()
        ORDER BY lead.client_review_due_at, lead.id FOR UPDATE OF lead SKIP LOCKED LIMIT $2`, [workspaceId, limit]);
    const escalated: string[] = [];
    if (!due.rowCount) return escalated;
    const recipients = await salesEscalationRecipients(client, workspaceId);
    for (const lead of due.rows) {
      await client.query(`UPDATE crm_leads SET client_review_due_at = NULL WHERE workspace_id = $1 AND id = $2`, [workspaceId, lead.id]);
      if (!lead.pending) continue;
      const owner = await memberPerson(client, workspaceId, lead.ownerMembershipId);
      await tell(client, workspaceId, [...(owner ? [owner] : []), ...recipients], {
        code: "crm.client_review_waiting", channels: ["in_app"], deepLink: leadLink(lead.id),
        variables: await this.facts(client, workspaceId, lead.id), key: `crm:client-review:${lead.id}`,
      });
      await this.events.record(client, {
        workspaceId, actorUserId: null, source: "automation", action: "crm.lead.client_review_escalated.v1",
        entityType: "crm_lead", entityId: lead.id, after: { pendingCandidates: lead.pending },
      });
      escalated.push(lead.id);
    }
    return escalated;
  }

  /** S-27: a "come back later" date that has arrived puts the enquiry back to work and tells its owner. */
  async wakePaused(client: PoolClient, workspaceId: string, limit: number, now: Date) {
    const due = await client.query<{ id: string; ownerMembershipId: string | null; nextActionAt: Date; version: number }>(
      `SELECT id, owner_membership_id AS "ownerMembershipId", next_action_at AS "nextActionAt", version FROM crm_leads
        WHERE workspace_id = $1 AND status = 'paused' AND next_action_at <= now()
          AND NOT EXISTS (SELECT 1 FROM crm_opportunities opportunity WHERE opportunity.workspace_id = crm_leads.workspace_id AND opportunity.lead_id = crm_leads.id)
        ORDER BY next_action_at, id FOR UPDATE SKIP LOCKED LIMIT $2`, [workspaceId, limit]);
    const woken: string[] = [];
    if (!due.rowCount) return woken;
    const clock = await workspaceClock(client, workspaceId);
    for (const lead of due.rows) {
      const updated = await client.query(
        `UPDATE crm_leads SET status = 'attempting_contact', paused_reason = NULL, version = version + 1, updated_at = now()
          WHERE workspace_id = $1 AND id = $2 AND status = 'paused' AND version = $3`, [workspaceId, lead.id, lead.version]);
      if (!updated.rowCount) continue;
      const resumed = await this.slas.resumeFirstResponse(client, workspaceId, lead.id, null, "Come-back date arrived", now);
      if (resumed) {
        await client.query(
          `UPDATE crm_activities SET due_at = $3, version = version + 1, updated_at = now()
            WHERE workspace_id = $1 AND sla_instance_id = $2 AND status = 'pending'`, [workspaceId, resumed.id, resumed.warning_at]);
      }
      await refreshUnownedEscalation(client, workspaceId, lead.id, now);
      const owner = await memberPerson(client, workspaceId, lead.ownerMembershipId);
      if (owner) {
        await tell(client, workspaceId, [owner], {
          code: "crm.lead_woken", channels: ["in_app", "push"], deepLink: leadLink(lead.id),
          variables: { ...(await this.facts(client, workspaceId, lead.id)), deadline: formatDeadline(new Date(lead.nextActionAt), clock, now) },
          key: `crm:woken:${lead.id}:${new Date(lead.nextActionAt).toISOString()}`,
        });
      }
      await this.events.record(client, {
        workspaceId, actorUserId: null, source: "automation", action: "crm.lead.woken.v1", entityType: "crm_lead", entityId: lead.id,
        before: { status: "paused" }, after: { status: "attempting_contact", comeBackAt: lead.nextActionAt, slaResumed: Boolean(resumed) },
      });
      woken.push(lead.id);
    }
    return woken;
  }

  /**
   * S-7 / S-26: once per working day, from 09:00 workspace time, the Sales admin and the Owner get one
   * summary of overdue and unowned enquiries, and each salesperson learns how many wait for them.
   */
  async sendDigest(client: PoolClient, workspaceId: string, now: Date) {
    const clock = await workspaceClock(client, workspaceId);
    const today = localDay(now, clock.timeZone);
    if (today.minutes < DIGEST_FROM_MINUTES) return null;
    const done = await client.query(`SELECT 1 FROM crm_sales_digests WHERE workspace_id = $1 AND digest_date = $2`, [workspaceId, today.date]);
    if (done.rowCount) return null;
    const record = async (outcome: string, summary: Record<string, unknown>) => {
      const inserted = await client.query(
        `INSERT INTO crm_sales_digests (workspace_id, digest_date, outcome, summary) VALUES ($1, $2, $3, $4)
         ON CONFLICT (workspace_id, digest_date) DO NOTHING`, [workspaceId, today.date, outcome, summary]);
      return Boolean(inserted.rowCount);
    };
    if (!isWorkingDay(await salesSchedule(client, workspaceId), today.weekday, today.date)) {
      await record("not_working_day", {});
      return { date: today.date, outcome: "not_working_day" };
    }
    const counts = await client.query<{ breached: number; unowned: number; waiting: number }>(
      `SELECT count(*) FILTER (WHERE EXISTS (SELECT 1 FROM crm_sla_instances sla WHERE sla.workspace_id = lead.workspace_id
                 AND sla.lead_id = lead.id AND sla.event_type = 'first_response' AND sla.status = 'breached'))::int AS breached,
              count(*) FILTER (WHERE lead.owner_membership_id IS NULL)::int AS unowned,
              count(*) FILTER (WHERE lead.status = 'new')::int AS waiting
         FROM crm_leads lead
        WHERE lead.workspace_id = $1 AND lead.status = ANY($2::crm_lead_status[])
          AND NOT EXISTS (SELECT 1 FROM crm_opportunities opportunity WHERE opportunity.workspace_id = lead.workspace_id AND opportunity.lead_id = lead.id)`,
      [workspaceId, WORKING_LEAD_STATUSES]);
    const summary = counts.rows[0] ?? { breached: 0, unowned: 0, waiting: 0 };
    if (!summary.breached && !summary.unowned && !summary.waiting) {
      await record("nothing_due", summary);
      return { date: today.date, outcome: "nothing_due" };
    }
    if (!(await record("sent", summary))) return null;
    if (summary.breached || summary.unowned) {
      await tell(client, workspaceId, await salesEscalationRecipients(client, workspaceId), {
        code: "crm.sales_digest", channels: ["in_app", "email"], deepLink: "/workspace/crm/leads",
        variables: { breached: String(summary.breached), unowned: String(summary.unowned), waiting: String(summary.waiting) },
        key: `crm:digest:${today.date}`,
      });
    }
    // Each owner: how many of theirs still wait for a first contact, and when the first is due.
    const owners = await client.query<{ membershipId: string; count: number; firstDue: Date | null }>(
      `SELECT lead.owner_membership_id AS "membershipId", count(*)::int AS count,
              min((SELECT min(sla.due_at) FROM crm_sla_instances sla WHERE sla.workspace_id = lead.workspace_id AND sla.lead_id = lead.id
                     AND sla.event_type = 'first_response' AND sla.status IN ('active', 'warning', 'breached'))) AS "firstDue"
         FROM crm_leads lead
        WHERE lead.workspace_id = $1 AND lead.status = 'new' AND lead.owner_membership_id IS NOT NULL
        GROUP BY lead.owner_membership_id`, [workspaceId]);
    for (const owner of owners.rows) {
      const person = await memberPerson(client, workspaceId, owner.membershipId);
      if (!person) continue;
      await tell(client, workspaceId, [person], {
        code: "crm.enquiries_waiting", channels: ["in_app", "push"], deepLink: "/workspace/crm/leads",
        variables: { count: String(owner.count), deadline: owner.firstDue ? formatDeadline(new Date(owner.firstDue), clock, now) : "" },
        key: `crm:waiting:${today.date}:${owner.membershipId}`,
      });
    }
    await this.events.record(client, {
      workspaceId, actorUserId: null, source: "automation", action: "crm.sales.digest_sent.v1", entityType: "workspace", entityId: workspaceId,
      after: { date: today.date, ...summary, owners: owners.rowCount ?? 0 },
    });
    return { date: today.date, outcome: "sent", ...summary };
  }

  private facts(client: PoolClient, workspaceId: string, leadId: string) {
    return leadFacts(client, workspaceId, leadId);
  }
}
