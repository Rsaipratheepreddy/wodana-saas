import { Injectable, Logger } from "@nestjs/common";
import type { PoolClient } from "pg";
import { DatabaseService } from "../database/database.service";
import { processDesignDeadlines } from "../design/design-journey.store";
import { processFactoryDeadlines } from "../factory/factory-reminders";
import { processHrmsCheckouts, processHrmsDocuments } from "../hrms/hrms-reminders";
import { processClientUpdateDrafts } from "../project-core/client-updates";
import { processMaterialsWaiting, processMilestonesDue, processStagesReady, processWeeklySummaries } from "../project-core/delivery-reminders";
import { processSiteReports, processWarrantyExpiry } from "../site/site-reminders";
import { processProjectBudgets } from "../project-core/project-money";
import { processReceivablesOverdue } from "../receivables/receivables.service";
import { processWorkDeadlines } from "../project-core/work-reminders";
import { processPayablesDue, processPurchasingDeadlines, processRetentionReleases } from "../purchasing/purchasing-reminders";
import { processSupplierDocuments } from "../purchasing/supplier-controls.service";

const SERVICE_ACTOR_ID = "00000000-0000-0000-0000-000000000000";
type Tenant = Pick<PoolClient, "query">;

/**
 * The daily run. Every rule reads its module's tables (never the retired project JSON) inside each
 * workspace's own tenant transaction — reminder tables use forced RLS — with a stable key per recipient,
 * record and day, so a rerun or a missed day never sends twice.
 */
@Injectable()
export class ProjectRemindersService {
  private readonly logger = new Logger(ProjectRemindersService.name);

  constructor(private readonly db: DatabaseService) {}

  async send() {
    const workspaces = await this.db.query<{ workspace_id: string }>(
      "SELECT workspace_id FROM list_reminder_workspaces()",
    );
    const totals = { created: 0, decisionReminders: 0, weeklySummaries: 0, stagesReady: 0, materialsWaiting: 0, milestonesDue: 0, clientUpdates: 0, designAlerts: 0,
      workReminders: 0, lateOrders: 0, supplierDocuments: 0, factoryShortages: 0, siteReports: 0, warrantyEnding: 0, payablesDue: 0, retentionReleased: 0, overBudget: 0,
      receivablesOverdue: 0, checkoutReminders: 0, documentReminders: 0, failedWorkspaces: 0 };
    for (const { workspace_id: workspaceId } of workspaces.rows) {
      try {
        const run = await this.db.tenantTransaction(workspaceId, SERVICE_ACTOR_ID, async (client) => ({
          decisions: await this.createDecisionReminders(client),
          design: await processDesignDeadlines(client, workspaceId),
          work: await processWorkDeadlines(client, workspaceId),
          stages: await processStagesReady(client, workspaceId),
          weekly: await processWeeklySummaries(client, workspaceId),
          materials: await processMaterialsWaiting(client, workspaceId),
          milestones: await processMilestonesDue(client, workspaceId),
          clientUpdates: await processClientUpdateDrafts(client, workspaceId),
          purchasing: await processPurchasingDeadlines(client, workspaceId),
          suppliers: await processSupplierDocuments(client, workspaceId),
          factory: await processFactoryDeadlines(client, workspaceId),
          site: await processSiteReports(client, workspaceId),
          warranty: await processWarrantyExpiry(client, workspaceId),
          // Retention released at handover first, so what falls due includes it.
          retention: await processRetentionReleases(client, workspaceId),
          payables: await processPayablesDue(client, workspaceId),
          budgets: await processProjectBudgets(client, workspaceId),
          receivables: await processReceivablesOverdue(client, workspaceId),
          checkouts: await processHrmsCheckouts(client, workspaceId),
          documents: await processHrmsDocuments(client, workspaceId),
        }));
        totals.decisionReminders += run.decisions;
        totals.weeklySummaries += run.weekly.sent;
        totals.stagesReady += run.stages.sent;
        totals.materialsWaiting += run.materials.sent;
        totals.milestonesDue += run.milestones.sent;
        totals.clientUpdates += run.clientUpdates.drafted;
        totals.designAlerts += (run.design?.alerted ?? 0) + (run.design?.closed ?? 0);
        totals.workReminders += run.work.sent;
        totals.lateOrders += run.purchasing.sent;
        totals.supplierDocuments += (run.suppliers?.held ?? 0) + (run.suppliers?.warned ?? 0);
        totals.factoryShortages += run.factory?.sent ?? 0;
        totals.siteReports += run.site.sent;
        totals.warrantyEnding += run.warranty.sent;
        totals.payablesDue += run.payables?.sent ?? 0;
        totals.retentionReleased += run.retention?.released ?? 0;
        totals.overBudget += run.budgets.sent;
        totals.receivablesOverdue += run.receivables?.sent ?? 0;
        totals.checkoutReminders += run.checkouts?.sent ?? 0;
        totals.documentReminders += run.documents?.sent ?? 0;
      } catch (error) {
        totals.failedWorkspaces += 1;
        this.logger.error(`Reminder run failed for workspace ${workspaceId}: ${(error as Error).message}`);
      }
    }
    totals.created = totals.decisionReminders + totals.weeklySummaries + totals.stagesReady + totals.materialsWaiting + totals.milestonesDue + totals.workReminders;
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
        '/workspace/pre-projects/'||case_id||'/commercial?request='||(request->>'id'),
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
