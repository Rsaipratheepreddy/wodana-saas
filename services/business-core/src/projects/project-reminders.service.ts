import { Injectable, Logger } from "@nestjs/common";
import type { PoolClient } from "pg";
import { DatabaseService } from "../database/database.service";
import { processQuoteExpiry } from "../commercial/quote-expiry";
import { resolveQuietChats } from "../crm/conversations/inbox/quiet-chats";
import { escalateWaitingApprovals } from "../approvals/approval-engine";
import { processDesignDeadlines } from "../design/design-journey.store";
import { processFactoryDeadlines } from "../factory/factory-reminders";
import { processHrmsCheckouts, processHrmsDocuments } from "../hrms/hrms-reminders";
import { processClientUpdateAutoSend, processClientUpdateDrafts } from "../project-core/client-updates";
import { processMaterialsWaiting, processMilestonesDue, processStagesReady, processWeeklySummaries } from "../project-core/delivery-reminders";
import { processSiteReports, processWarrantyExpiry } from "../site/site-reminders";
import { processDailyProgressAutoSend, processWeeklyRollups } from "../site/progress-delivery";
import { processProjectBudgets } from "../project-core/project-money";
import { processPurchasingDeadlines, processRetentionReleases } from "../purchasing/purchasing-reminders";
import { processSupplierDocuments } from "../purchasing/supplier-controls.service";
import { raiseStageInvoiceRequests } from "../finance-requests/stage-invoice-requests";
import { processTeamCalendarDeadlines } from "../team-calendars/team-calendars.store";
import { processFulfilmentDeadlines } from "../fulfilment/fulfilment-reminders";
import { processClientCalls } from "../client-calls/client-calls.store";
import { processChangeDecisions } from "../change-requests/change-request-reminders";

const SERVICE_ACTOR_ID = "00000000-0000-0000-0000-000000000000";
type Tenant = Pick<PoolClient, "query">;

/**
 * The daily run of what is not a reminder engine kind. Every rule reads its module's tables (never the retired
 * project JSON) inside each workspace's own tenant transaction, with a stable key per recipient, record and day, so
 * a rerun or a missed day never sends twice.
 *
 * Moved to the reminder engine (reminders/, plan §6.24a), so they are no longer sent here: work due and late
 * (work.due), approval reminders and escalation to the owners (approval.waiting; the E3 policy's own escalation still
 * runs here), client decisions on quotes and designs (client.quote_decision, client.design_decision), the quote
 * expiry warning (quote.expiring; expiring the quote stays here), late purchase orders (purchase.order_late; blockers,
 * stock levels and "late to order" stay), overdue design stages (design.stage_due; the stage's overdue mark stays),
 * building permits (permit.expiry), supplier bills due (payables.due) and overdue client invoices (invoice.overdue).
 */
@Injectable()
export class ProjectRemindersService {
  private readonly logger = new Logger(ProjectRemindersService.name);

  constructor(private readonly db: DatabaseService) {}

  async send() {
    const workspaces = await this.db.query<{ workspace_id: string }>(
      "SELECT workspace_id FROM list_reminder_workspaces()",
    );
    const totals = { created: 0, decisionReminders: 0, quotesExpired: 0, quietChatsResolved: 0, approvalEscalations: 0, weeklySummaries: 0, stagesReady: 0, materialsWaiting: 0, milestonesDue: 0, clientUpdates: 0, clientUpdatesSent: 0, designAlerts: 0,
      lateOrders: 0, supplierDocuments: 0, factoryShortages: 0, siteReports: 0, dailyProgressSent: 0, weeklyRollups: 0, warrantyEnding: 0, retentionReleased: 0, overBudget: 0,
      stageInvoiceRequests: 0, changeDecisions: 0, checkoutReminders: 0, documentReminders: 0, teamCalendarAlerts: 0, clientCallsBooked: 0, lateDeliveries: 0, failedWorkspaces: 0 };
    for (const { workspace_id: workspaceId } of workspaces.rows) {
      try {
        const run = await this.db.tenantTransaction(workspaceId, SERVICE_ACTOR_ID, async (client) => ({
          decisions: await this.createDecisionReminders(client),
          // Quotes that ran out are Expired (Q-6); the warning before and the client's reminders are reminder engine kinds.
          quotes: await processQuoteExpiry(client, workspaceId),
          // Changes sent to the client and not decided: the client and the project manager on the firm's days (§6.20),
          // until the change-request source joins the reminder engine.
          changeDecisions: await processChangeDecisions(client, workspaceId),
          // Chats quiet since our last message resolve themselves, unless something is pending (AU-2).
          quietChats: await resolveQuietChats(client, workspaceId),
          // E3-1: a step that waited past its policy's escalation hours passes to the next approver (reminders: approval.waiting).
          approvals: await escalateWaitingApprovals(client, workspaceId),
          design: await processDesignDeadlines(client, workspaceId),
          stages: await processStagesReady(client, workspaceId),
          weekly: await processWeeklySummaries(client, workspaceId),
          materials: await processMaterialsWaiting(client, workspaceId),
          milestones: await processMilestonesDue(client, workspaceId),
          // A reached payment stage raises its invoice request for Finance, where the firm turned it on (PLM-108).
          stageInvoices: await raiseStageInvoiceRequests(client, workspaceId),
          clientUpdates: await processClientUpdateDrafts(client, workspaceId),
          // Drafts nobody sent or discarded in time go out by themselves when the firm chose so (D-40).
          clientUpdatesSent: await processClientUpdateAutoSend(client, workspaceId),
          purchasing: await processPurchasingDeadlines(client, workspaceId),
          suppliers: await processSupplierDocuments(client, workspaceId),
          factory: await processFactoryDeadlines(client, workspaceId),
          // Render and 2D time, production, deliveries and installations past their day (PLM-090/091).
          teamCalendars: await processTeamCalendarDeadlines(client, workspaceId),
          // Won orders past their expected date and not yet with the client (PLM-126).
          fulfilment: await processFulfilmentDeadlines(client, workspaceId),
          // The next client update call when the last one is done or its day passed (PLM-046).
          clientCalls: await processClientCalls(client, workspaceId),
          site: await processSiteReports(client, workspaceId),
          // Daily progress approved but not sent (or, if the firm chose, never reviewed) goes after D-40's hours; Friday's roll-up.
          dailyProgress: await processDailyProgressAutoSend(client, workspaceId),
          rollups: await processWeeklyRollups(client, workspaceId),
          warranty: await processWarrantyExpiry(client, workspaceId),
          // Retention released at handover first, so what falls due includes it.
          retention: await processRetentionReleases(client, workspaceId),
          budgets: await processProjectBudgets(client, workspaceId),
          checkouts: await processHrmsCheckouts(client, workspaceId),
          documents: await processHrmsDocuments(client, workspaceId),
        }));
        totals.decisionReminders += run.decisions;
        totals.changeDecisions += run.changeDecisions?.sent ?? 0;
        totals.quotesExpired += run.quotes?.expired ?? 0;
        totals.quietChatsResolved += run.quietChats?.resolved ?? 0;
        totals.approvalEscalations += run.approvals?.escalated ?? 0;
        totals.weeklySummaries += run.weekly.sent;
        totals.stagesReady += run.stages.sent;
        totals.materialsWaiting += run.materials.sent;
        totals.milestonesDue += run.milestones.sent;
        totals.stageInvoiceRequests += run.stageInvoices?.raised ?? 0;
        totals.clientUpdates += run.clientUpdates.drafted;
        totals.clientUpdatesSent += run.clientUpdatesSent.sent;
        totals.designAlerts += (run.design?.alerted ?? 0) + (run.design?.closed ?? 0);
        totals.lateOrders += run.purchasing.sent;
        totals.supplierDocuments += (run.suppliers?.held ?? 0) + (run.suppliers?.warned ?? 0);
        totals.factoryShortages += run.factory?.sent ?? 0;
        totals.siteReports += run.site.sent;
        totals.dailyProgressSent += run.dailyProgress.sent;
        totals.weeklyRollups += run.rollups.sent;
        totals.warrantyEnding += run.warranty.sent;
        totals.retentionReleased += run.retention?.released ?? 0;
        totals.overBudget += run.budgets.sent;
        totals.checkoutReminders += run.checkouts?.sent ?? 0;
        totals.documentReminders += run.documents?.sent ?? 0;
        totals.teamCalendarAlerts += run.teamCalendars?.sent ?? 0;
        totals.lateDeliveries += run.fulfilment?.sent ?? 0;
        totals.clientCallsBooked += run.clientCalls?.booked ?? 0;
      } catch (error) {
        totals.failedWorkspaces += 1;
        this.logger.error(`Reminder run failed for workspace ${workspaceId}: ${(error as Error).message}`);
      }
    }
    totals.created = totals.decisionReminders + totals.weeklySummaries + totals.stagesReady + totals.materialsWaiting + totals.milestonesDue;
    return totals;
  }

  private async createDecisionReminders(client: Tenant) {
    const result = await client.query(
      `WITH due AS (
        SELECT commercial.workspace_id, commercial.case_id, request,
          membership.user_id,
          (now() AT TIME ZONE workspace.default_timezone)::date::text AS today
        FROM commercial_cases_view commercial
        JOIN workspaces workspace ON workspace.id=commercial.workspace_id
        CROSS JOIN LATERAL jsonb_array_elements(coalesce(commercial.content->'requests','[]'::jsonb)) request
        JOIN workspace_memberships membership
          ON membership.workspace_id=commercial.workspace_id
         AND membership.id=(request->'decisionRequest'->>'ownerMembershipId')::uuid
         AND membership.status='active'
        WHERE request->>'status'='awaiting_decision'
          AND request->'decisionRequest' IS NOT NULL
          AND coalesce((request->'decisionRequest'->'notificationPolicy'->>'remindersEnabled')::boolean,false)
          AND request->'decisionRequest'->'decision'='null'::jsonb
          AND request->>'dueDate'~'^\\d{4}-\\d{2}-\\d{2}$'
          AND request->>'dueDate'<=(now() AT TIME ZONE workspace.default_timezone)::date::text
          AND request->'decisionRequest'->'notificationPolicy'->'channels' ? 'in_app'
          AND EXISTS (
            SELECT 1 FROM notification_policies policy
            WHERE policy.workspace_id=commercial.workspace_id
              AND policy.event_type='commercial.decision.reminder'
              AND policy.status='active'
              AND policy.channels ? 'in_app'
          )
      )
      INSERT INTO notifications(
        workspace_id,recipient_type,recipient_id,channel,event_type,status,
        subject,body,deep_link,idempotency_key,correlation_id,delivered_at
      )
      SELECT workspace_id,'user',user_id,'in_app','commercial.decision.reminder','delivered',
        'Client decision due · '||(request->>'title'),
        (request->'decisionRequest'->'target'->>'label')||' · Due '||(request->>'dueDate'),
        '/workspace/pre-projects/cases/'||case_id||'/variations?request='||(request->>'id'),
        'decision-reminder:'||case_id||':'||(request->>'id')||':'||today,
        gen_random_uuid(),now()
      FROM due
      WHERE coalesce((
        SELECT preference.enabled FROM notification_preferences preference
        WHERE preference.workspace_id=due.workspace_id
          AND preference.recipient_type='user'
          AND preference.recipient_id=due.user_id
          AND preference.channel='in_app'
          AND preference.event_type IN ('commercial.decision.reminder','commercial.*','*')
        ORDER BY CASE preference.event_type
          WHEN 'commercial.decision.reminder' THEN 0 WHEN 'commercial.*' THEN 1 ELSE 2 END
        LIMIT 1
      ),true)
      ON CONFLICT(workspace_id,idempotency_key) DO NOTHING`,
    );
    return result.rowCount ?? 0;
  }
}
