import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
/** Daily in-app reminders use workspace dates and a stable key per recipient/record/day. */
@Injectable()
export class ProjectRemindersService {
  constructor(private readonly db: DatabaseService) {}
  async send(projectId?: string) {
    const result = await this.db.query(
      `WITH active AS (
   SELECT e.workspace_id,e.project_id,e.content,p.name,(now() AT TIME ZONE w.default_timezone)::date::text AS today
   FROM project_execution e JOIN delivery_projects p ON p.id=e.project_id AND p.workspace_id=e.workspace_id JOIN workspaces w ON w.id=e.workspace_id
   WHERE e.content->>'phase' IN ('planning','active') AND ($1::uuid IS NULL OR e.project_id=$1)
  ), records AS (
   SELECT a.*,r AS record,r->>'end' AS due,'plan-teams' AS section FROM active a CROSS JOIN LATERAL jsonb_array_elements(coalesce(a.content->'tasks','[]')) r WHERE r->>'status' NOT IN ('completed','cancelled') AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(a.content->'tasks','[]')) child WHERE child->>'parentId'=r->>'id')
   UNION ALL SELECT a.*,r,r->>'dueDate','snagging' FROM active a CROSS JOIN LATERAL jsonb_array_elements(coalesce(a.content->'snags','[]')) r WHERE r->>'status'<>'closed'
   UNION ALL SELECT a.*,r,r->>'dueDate','documents' FROM active a CROSS JOIN LATERAL jsonb_array_elements(coalesce(a.content->'technicalQueries','[]')) r WHERE r->>'status' NOT IN ('closed','cancelled')
   UNION ALL SELECT a.*,r,r->>'dueDate','plan-teams' FROM active a CROSS JOIN LATERAL jsonb_array_elements(coalesce(a.content->'milestones','[]')) r WHERE coalesce(r->>'acceptedAt','')=''
  ), recipients AS (
   SELECT DISTINCT r.workspace_id,r.project_id,r.name,r.today,r.record->>'id' AS record_id,r.record->>'title' AS title,r.due,r.section,m.id AS member_id,m.user_id
   FROM records r JOIN project_assignments a ON a.workspace_id=r.workspace_id AND a.project_id=r.project_id AND a.active JOIN workspace_memberships m ON m.workspace_id=a.workspace_id AND m.id=a.membership_id AND m.status='active'
   WHERE r.due~'^\\d{4}-\\d{2}-\\d{2}$' AND r.due<=r.today AND (r.record->>'ownerId'=m.id::text OR coalesce(r.record->'assigneeIds','[]') ? m.id::text OR EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(r.content->'followers','[]')) f WHERE f->>'recordId'=r.record->>'id' AND f->>'memberId'=m.id::text))
  ) INSERT INTO notifications(workspace_id,recipient_type,recipient_id,channel,event_type,status,subject,body,deep_link,idempotency_key,correlation_id,delivered_at)
  SELECT r.workspace_id,'user',r.user_id,'in_app','project.due','delivered',CASE WHEN r.due=r.today THEN 'Due today · ' ELSE 'Overdue · ' END||r.title,r.name||' · Planned for '||r.due,'/workspace/projects/'||r.project_id||'/'||r.section||'?record='||r.record_id,'project-due:'||r.project_id||':'||r.record_id||':'||r.today||':'||r.member_id,gen_random_uuid(),now()
  FROM recipients r WHERE coalesce((SELECT enabled FROM notification_preferences WHERE workspace_id=r.workspace_id AND recipient_type='user' AND recipient_id=r.user_id AND channel='in_app' AND event_type IN ('project.due','project.*','*') ORDER BY CASE event_type WHEN 'project.due' THEN 0 WHEN 'project.*' THEN 1 ELSE 2 END LIMIT 1),true)
  ON CONFLICT(workspace_id,idempotency_key) DO NOTHING RETURNING id`,
      [projectId ?? null],
    );
    return { created: result.rowCount ?? 0 };
  }
}
