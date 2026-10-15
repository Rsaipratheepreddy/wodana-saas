-- PLM-180: an enquiry nobody picks up goes back to Unassigned after a working day, and the Owners are told.
-- 1. workspace_sales_settings.unassign_after_working_day (default false, so every firm keeps today's rule: at most
--    takeover_cap hand-offs, then a manager is told). When true, hand-offs keep rotating without a cap; a full working
--    day (on the handoff's working hours) after the enquiry was given out, with no call, note or verified response from
--    its owner, it loses its owner and the workspace's Owners get crm.lead_unassigned in the app and by email.
-- 2. The crm.lead_unassigned notice templates for every workspace (new workspaces get them from the default templates).
-- workspace_sales_settings and notification_templates keep their forced RLS, tenant_isolation policies and grants.
-- Idempotent.
ALTER TABLE workspace_sales_settings ADD COLUMN IF NOT EXISTS unassign_after_working_day boolean NOT NULL DEFAULT false;
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('crm.lead_unassigned', 'in_app', '{{reference}} is unassigned', 'Nobody picked up {{clientName}} within a working day. Reassign it or move it to Lost.', '["reference","clientName","ownerName"]'),
  ('crm.lead_unassigned', 'email', '{{reference}} is unassigned', E'Nobody picked up {{clientName}} within a working day of it being assigned, so it has no owner now.\n\nLast with: {{ownerName}}\n\nOpen the enquiry to reassign it or move it to Lost.', '["reference","clientName","ownerName"]')
) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
