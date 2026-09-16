import { randomUUID } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import type { PoolClient } from "pg";
import { DatabaseService } from "../database/database.service";
import type { HrmsContext } from "../hrms/hrms-access.service";
import { CrmNotificationsService } from "../crm/notifications/crm-notifications.service";
import type { ProjectData } from "./execution.types";

const SERVICE_ACTOR_ID = "00000000-0000-0000-0000-000000000000";
const EMAIL_TEMPLATE_CODE = "project.update";

type OptionalEmail = {
  workspaceId: string;
  userId: string;
  eventType: string;
  projectId: string;
  projectName: string;
  projectReference?: string;
  action: string;
  recordId: string;
  recordTitle: string;
  body: string;
  deepLink: string;
  idempotencyKey: string;
  correlationId: string;
  reportDate?: string;
  dueDate?: string;
  scheduleImpact?: string;
  impactReason?: string;
  recoveryPlan?: string;
};

const knownTemplateVariables = new Set([
  "projectName",
  "projectReference",
  "action",
  "recordId",
  "recordTitle",
  "message",
  "deepLink",
  "reportDate",
  "dueDate",
  "scheduleImpact",
  "impactReason",
  "recoveryPlan",
]);

/**
 * Project work stays useful without requiring a mail configuration. In-app
 * updates are immediate; email is only queued when a tenant deliberately has
 * an approved generic project template and the individual opted in.
 */
@Injectable()
export class ProjectNotificationsService {
  private readonly logger = new Logger(ProjectNotificationsService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly notifications: CrmNotificationsService,
  ) {}

  async notify(
    ctx: HrmsContext,
    projectId: string,
    projectName: string,
    d: ProjectData,
    action: string,
    recordId: string,
    retry: string,
  ) {
    if (["follow", "notification_read"].includes(action)) return;
    const people = new Set(
      (d.followers ?? [])
        .filter((f) => f.recordId === recordId)
        .map((f) => f.memberId),
    );
    const task = d.tasks.find((t) => t.id === recordId),
      report = d.reports.find((r) => r.id === recordId),
      snag = d.snags.find((s) => s.id === recordId),
      query = d.technicalQueries?.find((q) => q.id === recordId),
      handover = d.handovers.find((h) => h.id === recordId);
    if (
      task &&
      ["task", "task_status", "inspect", "booking", "cancel_booking", "reschedule"].includes(action)
    ) {
      people.add(task.ownerId);
      task.assigneeIds.forEach((id) => people.add(id));
    }
    if (report) {
      people.add(report.authorId);
      report.entries.forEach((entry) => {
        const linkedTask = d.tasks.find((candidate) => candidate.id === entry.taskId);
        if (linkedTask) {
          people.add(linkedTask.ownerId);
          (d.followers ?? [])
            .filter((f) => f.recordId === linkedTask.id)
            .forEach((f) => people.add(f.memberId));
        }
      });
      if (report.nextUpdateOwnerId) people.add(report.nextUpdateOwnerId);
    }
    if (snag) people.add(snag.ownerId);
    if (handover) {
      handover.taskIds.forEach((taskId) => {
        const linkedTask = d.tasks.find((task) => task.id === taskId);
        if (linkedTask) {
          people.add(linkedTask.ownerId);
          linkedTask.assigneeIds.forEach((id) => people.add(id));
        }
      });
      handover.outstandingItems?.forEach((item) => people.add(item.ownerId));
    }
    if (query) {
      people.add(query.ownerId);
      people.add(query.authorId);
    }
    if (action === "comment") {
      const comment = d.comments.at(-1);
      comment?.mentions?.forEach((id) => people.add(id));
      if (task) people.add(task.ownerId);
    }
    if (["report_submit", "submit_report", "commissioning_status", "order_status"].includes(action)) {
      const reviewers = await ctx.client.query<{ membership_id: string }>(
        `SELECT DISTINCT a.membership_id FROM project_assignments a JOIN member_roles mr ON mr.membership_id=a.membership_id AND mr.workspace_id=a.workspace_id JOIN role_permissions rp ON rp.role_id=mr.role_id JOIN permissions p ON p.id=rp.permission_id WHERE a.workspace_id=$1 AND a.project_id=$2 AND a.active AND p.code='projects.review'`,
        [ctx.workspaceId, projectId],
      );
      reviewers.rows.forEach((row) => people.add(row.membership_id));
    }
    const recipients = await ctx.client.query<{ id: string; user_id: string }>(
      `SELECT m.id,m.user_id FROM workspace_memberships m JOIN project_assignments a ON a.membership_id=m.id AND a.workspace_id=m.workspace_id WHERE m.workspace_id=$1 AND a.project_id=$2 AND a.active AND m.status='active' AND m.id=ANY($3::uuid[])`,
      [
        ctx.workspaceId,
        projectId,
        [...people].filter((id) => id && id !== ctx.membershipId),
      ],
    );
    const title =
      task?.title ??
      snag?.title ??
      query?.title ??
      handover?.title ??
      (report
        ? `Daily update · ${report.date}`
        : (d.orders.find((order) => order.id === recordId)?.title ?? projectName));
    const section = report
      ? "daily-progress"
      : snag
        ? "snagging"
        : query ||
            d.documents.some((file) => file.id === recordId) ||
            d.transmittals?.some((item) => item.id === recordId)
          ? "documents"
          : d.orders.some((order) => order.id === recordId) ||
              d.supplierReturns?.some((item) => item.id === recordId)
            ? "procurement"
            : d.handovers.some((handover) => handover.id === recordId)
              ? "handover"
              : d.retentions?.some((item) => item.id === recordId)
                ? "commercial"
                : d.dispatches?.some((dispatch) => dispatch.id === recordId)
                  ? "production"
                  : d.commissioning?.some((item) => item.id === recordId)
                    ? "site-work"
                    : "plan-teams";
    const event = `project.${action}`;
    const body = `${projectName} · ${action.replaceAll("_", " ")} · ${title}`;
    const deepLink = `/workspace/projects/${projectId}/${section}?record=${encodeURIComponent(recordId)}${action === "comment" ? "&tab=comments" : ""}`;
    const correlationId = randomUUID();

    for (const recipient of recipients.rows) {
      const preference = await ctx.client.query<{ enabled: boolean }>(
        `SELECT enabled FROM notification_preferences WHERE workspace_id=$1 AND recipient_type='user' AND recipient_id=$2 AND channel='in_app' AND event_type IN ($3,'project.*','*') ORDER BY CASE event_type WHEN $3 THEN 0 WHEN 'project.*' THEN 1 ELSE 2 END LIMIT 1`,
        [ctx.workspaceId, recipient.user_id, event],
      );
      if (preference.rows[0]?.enabled !== false) {
        await ctx.client.query(
          `INSERT INTO notifications(workspace_id,recipient_type,recipient_id,channel,event_type,status,subject,body,deep_link,idempotency_key,correlation_id,delivered_at) VALUES($1,'user',$2,'in_app',$3,'delivered',$4,$5,$6,$7,$8,now()) ON CONFLICT(workspace_id,idempotency_key) DO NOTHING`,
          [
            ctx.workspaceId,
            recipient.user_id,
            event,
            title,
            body,
            deepLink,
            `project:${projectId}:${retry}:in-app:${recipient.id}`,
            correlationId,
          ],
        );
      }
      await this.queueOptionalEmailWithClient(ctx.client, {
        workspaceId: ctx.workspaceId,
        userId: recipient.user_id,
        eventType: event,
        projectId,
        projectName,
        projectReference: d.controls?.reference,
        action: action.replaceAll("_", " "),
        recordId,
        recordTitle: title,
        body,
        deepLink,
        idempotencyKey: `project:${projectId}:${retry}:email:${recipient.id}`,
        correlationId,
        reportDate: report?.date,
        scheduleImpact: report?.scheduleImpact,
        impactReason: report?.impactReason,
        recoveryPlan: report?.recoveryPlan,
        dueDate: handover?.clientReviewDueDate,
      });
    }
  }

  /**
   * A client-raised warranty claim originates outside an employee session, so
   * it uses the same preference/opt-in safeguards without fabricating one.
   */
  async notifyClientWarrantyClaim(
    client: PoolClient,
    input: {
      workspaceId: string;
      projectId: string;
      projectName: string;
      projectReference?: string;
      ownerMembershipId: string;
      claimId: string;
      title: string;
      handoverTitle: string;
      dueDate: string;
      idempotencyKey: string;
    },
  ) {
    const recipient = await client.query<{ user_id: string }>(
      `SELECT user_id FROM workspace_memberships
        WHERE workspace_id=$1 AND id=$2 AND status='active'`,
      [input.workspaceId, input.ownerMembershipId],
    );
    const userId = recipient.rows[0]?.user_id;
    if (!userId) return { delivered: false, reason: "owner_not_active" };
    const eventType = "project.warranty_claimed";
    const deepLink = `/workspace/projects/${input.projectId}/handover?record=${encodeURIComponent(input.claimId)}`;
    const subject = `Warranty claim · ${input.title}`;
    const body = `${input.projectName} · client warranty claim for ${input.handoverTitle}`;
    const preference = await client.query<{ enabled: boolean }>(
      `SELECT enabled FROM notification_preferences
        WHERE workspace_id=$1 AND recipient_type='user' AND recipient_id=$2
          AND channel='in_app' AND event_type IN ($3,'project.*','*')
        ORDER BY CASE event_type WHEN $3 THEN 0 WHEN 'project.*' THEN 1 ELSE 2 END LIMIT 1`,
      [input.workspaceId, userId, eventType],
    );
    if (preference.rows[0]?.enabled !== false)
      await client.query(
        `INSERT INTO notifications(workspace_id,recipient_type,recipient_id,channel,event_type,status,subject,body,deep_link,idempotency_key,correlation_id,delivered_at)
         VALUES($1,'user',$2,'in_app',$3,'delivered',$4,$5,$6,$7,$8,now())
         ON CONFLICT(workspace_id,idempotency_key) DO NOTHING`,
        [
          input.workspaceId,
          userId,
          eventType,
          subject,
          body,
          deepLink,
          `${input.idempotencyKey}:in-app:${userId}`,
          randomUUID(),
        ],
      );
    await this.queueOptionalEmailWithClient(client, {
      workspaceId: input.workspaceId,
      userId,
      eventType,
      projectId: input.projectId,
      projectName: input.projectName,
      projectReference: input.projectReference,
      action: "client warranty claim",
      recordId: input.claimId,
      recordTitle: input.title,
      body,
      deepLink,
      dueDate: input.dueDate,
      idempotencyKey: `${input.idempotencyKey}:email:${userId}`,
      correlationId: randomUUID(),
    });
    return { delivered: preference.rows[0]?.enabled !== false };
  }

  async queueScheduledEmail(input: OptionalEmail) {
    return this.database.tenantTransaction(input.workspaceId, SERVICE_ACTOR_ID, (client) =>
      this.queueOptionalEmailWithClient(client, input),
    );
  }

  private async queueOptionalEmailWithClient(client: PoolClient, input: OptionalEmail) {
    try {
      const preference = await client.query<{ enabled: boolean }>(
        `SELECT enabled FROM notification_preferences WHERE workspace_id=$1 AND recipient_type='user' AND recipient_id=$2 AND channel='email' AND event_type IN ($3,'project.*','*') ORDER BY CASE event_type WHEN $3 THEN 0 WHEN 'project.*' THEN 1 ELSE 2 END LIMIT 1`,
        [input.workspaceId, input.userId, input.eventType],
      );
      // Email is explicit opt-in. A missing preference must never create an
      // unexpected external message just because an admin created a template.
      if (preference.rows[0]?.enabled !== true)
        return { queued: false, reason: "email_not_opted_in" };

      const template = await client.query<{ variables: unknown }>(
        `SELECT template.variables FROM notification_templates template JOIN workspaces workspace ON workspace.id=template.workspace_id WHERE template.workspace_id=$1 AND template.code=$2 AND template.channel='email' AND template.status='approved' AND template.locale::text IN ('en',workspace.default_locale::text) ORDER BY CASE WHEN template.locale::text='en' THEN 0 WHEN template.locale=workspace.default_locale THEN 1 ELSE 2 END,template.version_number DESC LIMIT 1`,
        [input.workspaceId, EMAIL_TEMPLATE_CODE],
      );
      if (!template.rowCount)
        return { queued: false, reason: "project_email_template_missing" };
      const declared = Array.isArray(template.rows[0].variables)
        ? template.rows[0].variables.map(String)
        : [];
      if (declared.some((name) => !knownTemplateVariables.has(name))) {
        this.logger.warn(`Skipped ${input.eventType} email because ${EMAIL_TEMPLATE_CODE} declares an unsupported variable.`);
        return { queued: false, reason: "project_email_template_variables_unsupported" };
      }
      // A notification configuration race (for example an admin retiring a
      // template) must not poison the surrounding project transaction.
      await client.query("SAVEPOINT project_optional_email");
      try {
        const notification = await this.notifications.enqueueWithClient(client, {
          workspaceId: input.workspaceId,
          recipientType: "user",
          recipientId: input.userId,
          channel: "email",
          templateCode: EMAIL_TEMPLATE_CODE,
          locale: "en",
          eventType: input.eventType,
          variables: {
            projectName: input.projectName,
            projectReference: input.projectReference ?? "",
            action: input.action,
            recordId: input.recordId,
            recordTitle: input.recordTitle,
            message: input.body,
            deepLink: input.deepLink,
            reportDate: input.reportDate ?? "",
            dueDate: input.dueDate ?? "",
            scheduleImpact: input.scheduleImpact ?? "none",
            impactReason: input.impactReason ?? "",
            recoveryPlan: input.recoveryPlan ?? "",
          },
          deepLink: input.deepLink,
          idempotencyKey: input.idempotencyKey,
          correlationId: input.correlationId,
        });
        await client.query("RELEASE SAVEPOINT project_optional_email");
        return { queued: true, notification };
      } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT project_optional_email").catch(() => undefined);
        await client.query("RELEASE SAVEPOINT project_optional_email").catch(() => undefined);
        throw error;
      }
    } catch (error) {
      // Notification configuration must not undo an approved site record,
      // project command or the durable in-app alert.
      this.logger.warn(`Skipped ${input.eventType} email: ${error instanceof Error ? error.message : "notification configuration error"}`);
      return { queued: false, reason: "project_email_queue_failed" };
    }
  }
}
