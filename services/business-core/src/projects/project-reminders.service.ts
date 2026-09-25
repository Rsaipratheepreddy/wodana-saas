import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { DatabaseService } from "../database/database.service";
import { ProjectNotificationsService } from "./project-notifications";

const SERVICE_ACTOR_ID = "00000000-0000-0000-0000-000000000000";
type Tenant = Pick<PoolClient, "query">;

/**
 * Daily in-app reminders use workspace dates and a stable key per recipient/record/day.
 * Reminder tables use forced RLS, so each workspace runs in its own tenant transaction;
 * emails are queued only after that transaction commits.
 */
@Injectable()
export class ProjectRemindersService {
  private readonly logger = new Logger(ProjectRemindersService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly notifications: ProjectNotificationsService,
  ) {}

  async send(projectId?: string) {
    const workspaces = await this.db.query<{ workspace_id: string }>(
      "SELECT workspace_id FROM list_reminder_workspaces()",
    );
    const totals = { created: 0, dueReminders: 0, decisionReminders: 0, weeklySummaries: 0, failedWorkspaces: 0 };
    for (const { workspace_id: workspaceId } of workspaces.rows) {
      try {
        const run = await this.db.tenantTransaction(workspaceId, SERVICE_ACTOR_ID, async (client) => ({
          due: await this.createDueReminders(client, projectId),
          decisions: await this.createDecisionReminders(client),
          weekly: projectId ? null : await this.createWeeklyProgress(client),
        }));
        await this.queueDueEmails(run.due);
        if (run.weekly) await this.queueWeeklyEmails(run.weekly.rows, run.weekly.emailWorkspaces);
        totals.dueReminders += run.due.length;
        totals.decisionReminders += run.decisions;
        totals.weeklySummaries += run.weekly?.rows.length ?? 0;
      } catch (error) {
        totals.failedWorkspaces += 1;
        this.logger.error(`Reminder run failed for workspace ${workspaceId}: ${(error as Error).message}`);
      }
    }
    totals.created = totals.dueReminders + totals.decisionReminders + totals.weeklySummaries;
    return totals;
  }

  private async createDueReminders(client: Tenant, projectId?: string) {
    const result = await client.query<{
      workspace_id: string;
      recipient_id: string;
      subject: string;
      body: string;
      deep_link: string;
      idempotency_key: string;
    }>(
      `WITH active AS (
   SELECT e.workspace_id,e.project_id,e.content,p.name,(now() AT TIME ZONE w.default_timezone)::date::text AS today
   FROM project_execution_view e JOIN delivery_projects p ON p.id=e.project_id AND p.workspace_id=e.workspace_id JOIN workspaces w ON w.id=e.workspace_id
   WHERE e.content->>'phase' IN ('planning','active','handover','completed') AND ($1::uuid IS NULL OR e.project_id=$1)
  ), records AS (
   SELECT a.*,r AS record,r->>'end' AS due,'plan-teams' AS section FROM active a CROSS JOIN LATERAL jsonb_array_elements(coalesce(a.content->'tasks','[]')) r WHERE r->>'status' NOT IN ('completed','cancelled') AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(a.content->'tasks','[]')) child WHERE child->>'parentId'=r->>'id')
   UNION ALL SELECT a.*,r,r->>'dueDate','snagging' FROM active a CROSS JOIN LATERAL jsonb_array_elements(coalesce(a.content->'snags','[]')) r WHERE r->>'status'<>'closed'
   UNION ALL SELECT a.*,r,r->>'dueDate','documents' FROM active a CROSS JOIN LATERAL jsonb_array_elements(coalesce(a.content->'technicalQueries','[]')) r WHERE r->>'status' NOT IN ('closed','cancelled')
   UNION ALL SELECT a.*,r,r->>'dueDate','plan-teams' FROM active a CROSS JOIN LATERAL jsonb_array_elements(coalesce(a.content->'milestones','[]')) r WHERE coalesce(r->>'acceptedAt','')=''
   UNION ALL SELECT a.*,r,r->>'dueDate','production' FROM active a CROSS JOIN LATERAL jsonb_array_elements(coalesce(a.content->'dispatches','[]')) r WHERE r->>'status' IN ('ready','dispatched')
   UNION ALL SELECT a.*,r,r->>'dueDate','site-work' FROM active a CROSS JOIN LATERAL jsonb_array_elements(coalesce(a.content->'commissioning','[]')) r WHERE r->>'status' IN ('draft','submitted','returned')
   UNION ALL SELECT a.*,r,r->>'clientReviewDueDate','handover' FROM active a CROSS JOIN LATERAL jsonb_array_elements(coalesce(a.content->'handovers','[]')) r WHERE r->>'status'='ready'
   UNION ALL SELECT a.*,jsonb_build_object('id',h->>'id','title',item->>'title','ownerId',item->>'ownerId'),item->>'dueDate','handover'
     FROM active a
     CROSS JOIN LATERAL jsonb_array_elements(coalesce(a.content->'handovers','[]')) h
     CROSS JOIN LATERAL jsonb_array_elements(coalesce(h->'outstandingItems','[]')) item
    WHERE item->>'status' NOT IN ('closed','warranty')
  ), recipients AS (
   SELECT DISTINCT r.workspace_id,r.project_id,r.name,r.today,r.record->>'id' AS record_id,r.record->>'title' AS title,r.due,r.section,m.id AS member_id,m.user_id
   FROM records r JOIN project_assignments a ON a.workspace_id=r.workspace_id AND a.project_id=r.project_id AND a.active JOIN workspace_memberships m ON m.workspace_id=a.workspace_id AND m.id=a.membership_id AND m.status='active'
   WHERE r.due~'^\\d{4}-\\d{2}-\\d{2}$' AND r.due<=r.today AND (r.record->>'ownerId'=m.id::text OR r.record->>'preparedBy'=m.id::text OR coalesce(r.record->'assigneeIds','[]') ? m.id::text OR (r.section='handover' AND a.is_manager) OR EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(r.content->'followers','[]')) f WHERE f->>'recordId'=r.record->>'id' AND f->>'memberId'=m.id::text))
  ) INSERT INTO notifications(workspace_id,recipient_type,recipient_id,channel,event_type,status,subject,body,deep_link,idempotency_key,correlation_id,delivered_at)
  SELECT r.workspace_id,'user',r.user_id,'in_app','project.due','delivered',CASE WHEN r.due=r.today THEN 'Due today · ' ELSE 'Overdue · ' END||r.title,r.name||' · Planned for '||r.due,'/workspace/projects/'||r.project_id||'/'||r.section||'?record='||r.record_id,'project-due:'||r.project_id||':'||r.record_id||':'||r.today||':'||r.member_id,gen_random_uuid(),now()
  FROM recipients r WHERE coalesce((SELECT enabled FROM notification_preferences WHERE workspace_id=r.workspace_id AND recipient_type='user' AND recipient_id=r.user_id AND channel='in_app' AND event_type IN ('project.due','project.*','*') ORDER BY CASE event_type WHEN 'project.due' THEN 0 WHEN 'project.*' THEN 1 ELSE 2 END LIMIT 1),true)
  ON CONFLICT(workspace_id,idempotency_key) DO NOTHING RETURNING workspace_id,recipient_id,subject,body,deep_link,idempotency_key`,
      [projectId ?? null],
    );
    return result.rows;
  }

  private async queueDueEmails(reminders: { workspace_id: string; recipient_id: string; subject: string; body: string; deep_link: string; idempotency_key: string }[]) {
    for (const reminder of reminders) {
      const projectIdMatch = /\/workspace\/projects\/([^/]+)/.exec(reminder.deep_link);
      const dueDate = /\b\d{4}-\d{2}-\d{2}\b/.exec(reminder.body)?.[0] ?? "";
      const projectName = reminder.body.split(" · Planned for ")[0] || "Project";
      await this.notifications.queueScheduledEmail({
        workspaceId: reminder.workspace_id,
        userId: reminder.recipient_id,
        eventType: "project.due",
        projectId: projectIdMatch?.[1] ?? "",
        projectName,
        action: "scheduled reminder",
        recordId: reminder.deep_link.split("?record=")[1] ?? "",
        recordTitle: reminder.subject.replace(/^(Due today|Overdue) · /, ""),
        body: reminder.body,
        deepLink: reminder.deep_link,
        dueDate,
        idempotencyKey: `${reminder.idempotency_key}:email`,
        correlationId: randomUUID(),
      }).catch(() => undefined);
    }
  }

  private async createDecisionReminders(client: Tenant) {
    const result = await client.query(
      `WITH due AS (
        SELECT commercial.workspace_id, commercial.case_id, request,
          membership.user_id,
          (now() AT TIME ZONE workspace.default_timezone)::date::text AS today
        FROM commercial_cases commercial
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

  private async createWeeklyProgress(client: Tenant) {
    const emailPolicies = await client.query<{ workspace_id: string }>(
      `SELECT DISTINCT workspace_id FROM notification_policies
       WHERE event_type='project.weekly_progress' AND status='active' AND channels ? 'email'`,
    );
    const emailWorkspaces = new Set(emailPolicies.rows.map((row) => row.workspace_id));
    const summaries = await client.query<{
      workspace_id: string;
      project_id: string;
      recipient_id: string;
      project_name: string;
      body: string;
      deep_link: string;
      idempotency_key: string;
    }>(
      `WITH eligible AS (
        SELECT project.workspace_id,project.id AS project_id,project.name,
          execution.content,membership.user_id,
          (now() AT TIME ZONE workspace.default_timezone)::date AS today,
          to_char((now() AT TIME ZONE workspace.default_timezone)::date,'IYYY-IW') AS week_key
        FROM delivery_projects project
        JOIN project_execution_view execution
          ON execution.workspace_id=project.workspace_id AND execution.project_id=project.id
        JOIN workspaces workspace ON workspace.id=project.workspace_id
        JOIN project_assignments assignment
          ON assignment.workspace_id=project.workspace_id AND assignment.project_id=project.id AND assignment.active
        JOIN workspace_memberships membership
          ON membership.workspace_id=assignment.workspace_id AND membership.id=assignment.membership_id AND membership.status='active'
        WHERE project.status='active'
          AND EXISTS (
            SELECT 1 FROM notification_policies policy
            WHERE policy.workspace_id=project.workspace_id
              AND policy.event_type='project.weekly_progress'
              AND policy.status='active'
              AND policy.channels ? 'in_app'
              AND lower(coalesce(policy.conditions->>'weekday','friday'))=
                  lower(trim(to_char((now() AT TIME ZONE workspace.default_timezone),'Day')))
          )
      ), counts AS (
        SELECT eligible.*,
          (SELECT count(*) FROM jsonb_array_elements(coalesce(content->'tasks','[]'::jsonb)) task
            WHERE task->>'status' NOT IN ('completed','cancelled')) AS open_tasks,
          (SELECT count(*) FROM jsonb_array_elements(coalesce(content->'tasks','[]'::jsonb)) task
            WHERE task->>'status' NOT IN ('completed','cancelled')
              AND task->>'end'~'^\\d{4}-\\d{2}-\\d{2}$'
              AND (task->>'end')::date<today) AS overdue_tasks,
          (SELECT count(*) FROM jsonb_array_elements(coalesce(content->'snags','[]'::jsonb)) snag
            WHERE snag->>'status'<>'closed') AS open_snags
        FROM eligible
      )
      INSERT INTO notifications(
        workspace_id,recipient_type,recipient_id,channel,event_type,status,
        subject,body,deep_link,idempotency_key,correlation_id,delivered_at
      )
      SELECT workspace_id,'user',user_id,'in_app','project.weekly_progress','delivered',
        'Weekly progress · '||name,
        open_tasks||' open tasks · '||overdue_tasks||' overdue · '||open_snags||' open snags',
        '/workspace/projects/'||project_id||'/overview',
        'weekly-progress:'||project_id||':'||user_id||':'||week_key,
        gen_random_uuid(),now()
      FROM counts
      WHERE coalesce((
        SELECT preference.enabled FROM notification_preferences preference
        WHERE preference.workspace_id=counts.workspace_id
          AND preference.recipient_type='user'
          AND preference.recipient_id=counts.user_id
          AND preference.channel='in_app'
          AND preference.event_type IN ('project.weekly_progress','project.*','*')
        ORDER BY CASE preference.event_type
          WHEN 'project.weekly_progress' THEN 0 WHEN 'project.*' THEN 1 ELSE 2 END
        LIMIT 1
      ),true)
      ON CONFLICT(workspace_id,idempotency_key) DO NOTHING
      RETURNING workspace_id,split_part(deep_link,'/',4)::uuid AS project_id,
        recipient_id,split_part(subject,' · ',2) AS project_name,body,deep_link,idempotency_key`,
    );
    return { rows: summaries.rows, emailWorkspaces };
  }

  private async queueWeeklyEmails(
    summaries: { workspace_id: string; project_id: string; recipient_id: string; project_name: string; body: string; deep_link: string; idempotency_key: string }[],
    emailWorkspaces: Set<string>,
  ) {
    for (const summary of summaries) {
      if (!emailWorkspaces.has(summary.workspace_id)) continue;
      await this.notifications.queueScheduledEmail({
        workspaceId: summary.workspace_id,
        userId: summary.recipient_id,
        eventType: "project.weekly_progress",
        projectId: summary.project_id,
        projectName: summary.project_name,
        action: "weekly progress summary",
        recordId: summary.project_id,
        recordTitle: "Weekly progress",
        body: summary.body,
        deepLink: summary.deep_link,
        idempotencyKey: `${summary.idempotency_key}:email`,
        correlationId: randomUUID(),
      }).catch(() => undefined);
    }
  }
}
