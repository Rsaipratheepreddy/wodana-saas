import { randomUUID } from "node:crypto";
import type { HrmsContext } from "../hrms/hrms-access.service";
import type { ProjectData } from "./execution.types";
export async function notifyProject(
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
    query = d.technicalQueries?.find((q) => q.id === recordId);
  if (
    task &&
    ["task", "task_status", "inspect", "booking", "cancel_booking", "reschedule"].includes(action)
  ) {
    people.add(task.ownerId);
    task.assigneeIds.forEach((id) => people.add(id));
  }
  if (report) {
    people.add(report.authorId);
    report.entries.forEach((e) => {
      const t = d.tasks.find((t) => t.id === e.taskId);
      if (t) {
        people.add(t.ownerId);
        (d.followers ?? [])
          .filter((f) => f.recordId === t.id)
          .forEach((f) => people.add(f.memberId));
      }
    });
  }
  if (snag) people.add(snag.ownerId);
  if (query) {
    people.add(query.ownerId);
    people.add(query.authorId);
  }
  if (action === "comment") {
    const comment = d.comments.at(-1);
    comment?.mentions?.forEach((id) => people.add(id));
    if (task) people.add(task.ownerId);
  }
  if (
    ["report_submit", "commissioning_status", "order_status"].includes(action)
  ) {
    const reviewers = await ctx.client.query(
      `SELECT DISTINCT a.membership_id FROM project_assignments a JOIN member_roles mr ON mr.membership_id=a.membership_id AND mr.workspace_id=a.workspace_id JOIN role_permissions rp ON rp.role_id=mr.role_id JOIN permissions p ON p.id=rp.permission_id WHERE a.workspace_id=$1 AND a.project_id=$2 AND a.active AND p.code='projects.review'`,
      [ctx.workspaceId, projectId],
    );
    reviewers.rows.forEach((r) => people.add(r.membership_id));
  }
  const recipients = await ctx.client.query(
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
    (report
      ? `Daily update · ${report.date}`
      : (d.orders.find((o) => o.id === recordId)?.title ?? projectName));
  const section = report
    ? "daily-progress"
    : snag
      ? "snagging"
      : query ||
          d.documents.some((x) => x.id === recordId) ||
          d.transmittals?.some((x) => x.id === recordId)
        ? "documents"
        : d.orders.some((x) => x.id === recordId) ||
            d.supplierReturns?.some((x) => x.id === recordId)
          ? "procurement"
          : d.handovers.some((x) => x.id === recordId)
            ? "handover"
            : d.retentions?.some((x) => x.id === recordId)
              ? "commercial"
              : d.dispatches?.some((x) => x.id === recordId)
                ? "production"
                : d.commissioning?.some((x) => x.id === recordId)
                  ? "site-work"
                  : "plan-teams";
  const event = `project.${action}`,
    body = `${projectName} · ${action.replaceAll("_", " ")} · ${title}`;
  for (const recipient of recipients.rows) {
    const pref = await ctx.client.query(
      `SELECT enabled FROM notification_preferences WHERE workspace_id=$1 AND recipient_type='user' AND recipient_id=$2 AND channel='in_app' AND event_type IN ($3,'project.*','*') ORDER BY CASE event_type WHEN $3 THEN 0 WHEN 'project.*' THEN 1 ELSE 2 END LIMIT 1`,
      [ctx.workspaceId, recipient.user_id, event],
    );
    if (pref.rows[0]?.enabled === false) continue;
    await ctx.client.query(
      `INSERT INTO notifications(workspace_id,recipient_type,recipient_id,channel,event_type,status,subject,body,deep_link,idempotency_key,correlation_id,delivered_at) VALUES($1,'user',$2,'in_app',$3,'delivered',$4,$5,$6,$7,$8,now()) ON CONFLICT(workspace_id,idempotency_key) DO NOTHING`,
      [
        ctx.workspaceId,
        recipient.user_id,
        event,
        title,
        body,
        `/workspace/projects/${projectId}/${section}?record=${encodeURIComponent(recordId)}${action === "comment" ? "&tab=comments" : ""}`,
        `project:${projectId}:${retry}:${recipient.id}`,
        randomUUID(),
      ],
    );
  }
}
