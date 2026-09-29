import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import { tellClients } from "../client-portal/portal-notices";
import { Dec } from "../catalog-core/decimal";
import { notifyUserInApp } from "../notifications/default-templates";
import { weekEnd } from "./delivery-reminders";
import { readCalendar } from "./work-calendar";

type Db = Pick<PoolClient, "query">;
const PHOTOS = 6;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** A quantity without trailing zeros: "3", "2.5". */
const plain = (value: string) => Dec.of(value).toString();

/**
 * The weekly client update, drafted on the last working day of the week for each running project that had
 * approved site reports that week: what was installed, the stage it's in, what's next, and up to six photos
 * from those reports. The project manager is told, reads it, edits the words if needed and approves it in one
 * tap — only then does the client see it (in the portal, and by WhatsApp or email). One draft per project and week.
 */
export async function processClientUpdateDrafts(db: Db, workspaceId: string) {
  const today = (await db.query<{ today: string }>(
    `SELECT (now() AT TIME ZONE coalesce(nullif(default_timezone, ''), 'UTC'))::date::text AS today FROM workspaces WHERE id = $1`, [workspaceId])).rows[0]?.today;
  if (!today || new Date(`${today}T00:00:00Z`).getUTCDay() !== weekEnd(await readCalendar(db, workspaceId))) return { drafted: 0 };
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - 6 * 86_400_000).toISOString().slice(0, 10);
  const projects = (await db.query<{ id: string; title: string; health: string; lead: string | null }>(
    `SELECT project.id, project.reference || ' · ' || project.name AS title, project.health,
            (SELECT membership.user_id FROM project_assignments assignment JOIN workspace_memberships membership
                ON membership.workspace_id = assignment.workspace_id AND membership.id = assignment.membership_id AND membership.status = 'active'
              WHERE assignment.workspace_id = project.workspace_id AND assignment.project_id = project.id AND assignment.active AND assignment.is_manager LIMIT 1) AS lead
       FROM delivery_projects project
      WHERE project.workspace_id = $1 AND project.status = 'active'
        AND EXISTS (SELECT 1 FROM site_reports report WHERE report.workspace_id = project.workspace_id AND report.project_id = project.id AND report.status = 'approved'
                     AND report.report_date BETWEEN $2::date AND $3::date)
        AND NOT EXISTS (SELECT 1 FROM project_status_updates draft WHERE draft.workspace_id = project.workspace_id AND draft.project_id = project.id AND draft.draft_week = $3::date)`,
    [workspaceId, from, today])).rows;
  let drafted = 0;
  for (const project of projects) {
    if (!project.lead) continue;
    const note = await draftNote(db, workspaceId, project.id, from, today);
    const id = randomUUID();
    await db.query(
      `INSERT INTO project_status_updates (id, workspace_id, project_id, health, note, created_by, kind, draft_week) VALUES ($1, $2, $3, $4, $5, $6, 'client_update', $7)
       ON CONFLICT (workspace_id, project_id, draft_week) WHERE draft_week IS NOT NULL DO NOTHING`, [id, workspaceId, project.id, project.health, note, project.lead, today]);
    const photos = (await db.query<{ id: string }>(
      `SELECT photo.id FROM site_report_photos photo JOIN site_reports report ON report.workspace_id = photo.workspace_id AND report.id = photo.report_id
        WHERE photo.workspace_id = $1 AND report.project_id = $2 AND report.status = 'approved' AND report.report_date BETWEEN $3::date AND $4::date
        ORDER BY report.report_date DESC, photo.created_at LIMIT ${PHOTOS}`, [workspaceId, project.id, from, today])).rows;
    for (const [position, photo] of photos.entries())
      await db.query(`INSERT INTO project_update_photos (workspace_id, update_id, photo_id, position) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`, [workspaceId, id, photo.id, position]);
    await notifyUserInApp(db, { workspaceId, recipientUserId: project.lead, code: "project.client_update_ready", eventType: "project.client_update_ready",
      variables: { title: project.title, clientName: "", actor: "", note: `${photos.length} photo${photos.length === 1 ? "" : "s"}. Read it and approve it to send.` },
      deepLink: `/workspace/projects/${project.id}/updates`, idempotencyKey: `project.client_update_ready:${project.id}:${today}` });
    drafted += 1;
  }
  return { drafted };
}

/** The words of a week's update: what was installed (approved), the stage, and the work due next week. */
async function draftNote(db: Db, workspaceId: string, projectId: string, from: string, to: string) {
  const installed = (await db.query<{ title: string; unit: string; quantity: string }>(
    `SELECT line.title, line.unit, sum(entry.installed)::text AS quantity FROM site_report_lines entry
       JOIN site_reports report ON report.workspace_id = entry.workspace_id AND report.id = entry.report_id
       JOIN project_boq_lines line ON line.workspace_id = entry.workspace_id AND line.id = entry.boq_line_id
      WHERE entry.workspace_id = $1 AND report.project_id = $2 AND report.status = 'approved' AND report.report_date BETWEEN $3::date AND $4::date
      GROUP BY line.id, line.title, line.unit, line.position HAVING sum(entry.installed) > 0 ORDER BY line.position LIMIT 8`, [workspaceId, projectId, from, to])).rows;
  const stage = (await db.query<{ name: string }>(`SELECT name FROM project_stages WHERE workspace_id = $1 AND project_id = $2 AND status = 'current'`, [workspaceId, projectId])).rows[0]?.name;
  const next = (await db.query<{ title: string }>(
    `SELECT title FROM work_items WHERE workspace_id = $1 AND project_id = $2 AND type = 'task' AND parent_id IS NULL AND status NOT IN ('done', 'cancelled')
        AND coalesce(start_date, due_date) BETWEEN $3::date + 1 AND $3::date + 7 ORDER BY coalesce(start_date, due_date), number LIMIT 3`, [workspaceId, projectId, to])).rows;
  return [
    installed.length ? `This week: ${installed.map((row) => `${row.title} (${plain(row.quantity)}${row.unit ? ` ${row.unit}` : ""})`).join(", ")}.` : "This week the team worked on site.",
    stage ? `Stage: ${stage}.` : "",
    next.length ? `Next week: ${next.map((row) => row.title).join(", ")}.` : "",
  ].filter(Boolean).join("\n");
}

/**
 * The project manager's decision on a drafted client update: approve (optionally with edited words) shares it and
 * its photos with the client and tells them once; discard removes the draft (it has no history yet).
 */
export async function decideClientUpdate(db: Db, input: { workspaceId: string; projectId: string; caseId: string; title: string; updateId: unknown; note: unknown; approve: boolean; userId: string }) {
  if (typeof input.updateId !== "string" || !UUID.test(input.updateId)) throw new BadRequestException("Update not found.");
  const update = (await db.query<{ id: string; note: string; approvedAt: string | null }>(
    `SELECT id, note, approved_at AS "approvedAt" FROM project_status_updates WHERE workspace_id = $1 AND project_id = $2 AND id = $3 AND kind = 'client_update' FOR UPDATE`,
    [input.workspaceId, input.projectId, input.updateId])).rows[0];
  if (!update) throw new NotFoundException("Update not found.");
  if (update.approvedAt) throw new ConflictException("This update was already sent to the client.");
  if (!input.approve) {
    await db.query(`DELETE FROM project_status_updates WHERE workspace_id = $1 AND id = $2`, [input.workspaceId, update.id]);
    return { updateId: update.id, discarded: true };
  }
  const note = typeof input.note === "string" && input.note.trim() ? input.note.trim().slice(0, 2000) : update.note;
  await db.query(`UPDATE project_status_updates SET note = $3, approved_by = $4, approved_at = now(), shared_by = $4, shared_at = now() WHERE workspace_id = $1 AND id = $2`,
    [input.workspaceId, update.id, note, input.userId]);
  const photos = (await db.query(
    `UPDATE site_report_photos photo SET shared_at = coalesce(photo.shared_at, now()), shared_by = coalesce(photo.shared_by, $3::uuid)
       FROM project_update_photos chosen WHERE chosen.workspace_id = $1 AND chosen.update_id = $2 AND photo.workspace_id = chosen.workspace_id AND photo.id = chosen.photo_id`,
    [input.workspaceId, update.id, input.userId])).rowCount ?? 0;
  await tellClients(db, { workspaceId: input.workspaceId, caseId: input.caseId, event: "update_published", recordId: update.id, title: input.title, note });
  return { updateId: update.id, photos };
}
