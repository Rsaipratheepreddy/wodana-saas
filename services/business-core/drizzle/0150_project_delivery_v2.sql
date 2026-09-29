-- Projects v2: a project manager sees their own project's money (not margin); a handover accepted with money
-- still due keeps the balance and why on the pack; the weekly client update is drafted from approved site
-- reports for the project manager to approve; and the notices the delivery reminders send.
INSERT INTO permissions (code, description) VALUES
  ('projects.costs.view', 'See the money of the projects you run: received, spent, committed, budgets and cash in hand (not margin)')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
-- Whoever runs projects sees their money: every role that already manages projects.
INSERT INTO role_permissions (workspace_id, role_id, permission_id)
SELECT DISTINCT role.workspace_id, role.id, costs.id
  FROM roles role
  JOIN role_permissions held ON held.role_id = role.id
  JOIN permissions manage ON manage.id = held.permission_id AND manage.code = 'projects.manage'
  CROSS JOIN permissions costs
 WHERE costs.code = 'projects.costs.view'
ON CONFLICT (role_id, permission_id) DO NOTHING;
--> statement-breakpoint
ALTER TABLE handover_packs
  ADD COLUMN balance_due numeric(20, 4),
  ADD COLUMN balance_currency varchar(3),
  ADD COLUMN balance_reason varchar(500),
  ADD COLUMN balance_accepted_by uuid REFERENCES users (id),
  ADD CONSTRAINT handover_packs_balance_check CHECK ((balance_due IS NULL) = (balance_currency IS NULL) AND (balance_due IS NULL OR balance_due > 0));
--> statement-breakpoint
-- A client update is drafted each week from approved reports; the project manager approves it (then it's shared).
ALTER TABLE project_status_updates
  ADD COLUMN kind varchar(16) NOT NULL DEFAULT 'status',
  ADD COLUMN draft_week date,
  ADD COLUMN approved_by uuid REFERENCES users (id),
  ADD COLUMN approved_at timestamptz,
  ADD CONSTRAINT project_status_updates_kind_check CHECK (kind IN ('status', 'client_update')),
  ADD CONSTRAINT project_status_updates_draft_check CHECK (kind = 'client_update' OR draft_week IS NULL),
  ADD CONSTRAINT project_status_updates_approved_check CHECK ((approved_by IS NULL) = (approved_at IS NULL));
--> statement-breakpoint
CREATE UNIQUE INDEX project_status_updates_week_uidx ON project_status_updates (workspace_id, project_id, draft_week) WHERE draft_week IS NOT NULL;
--> statement-breakpoint
ALTER TABLE project_status_updates ADD CONSTRAINT project_status_updates_workspace_id_id_key UNIQUE (workspace_id, id);
--> statement-breakpoint
CREATE TABLE project_update_photos (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  update_id uuid NOT NULL,
  photo_id uuid NOT NULL,
  position integer NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, update_id, photo_id),
  FOREIGN KEY (workspace_id, update_id) REFERENCES project_status_updates (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, photo_id) REFERENCES site_report_photos (workspace_id, id)
);
--> statement-breakpoint
ALTER TABLE project_update_photos ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE project_update_photos FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON project_update_photos
  USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON project_update_photos TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('project.weekly_summary', 'in_app', 'This week on {{title}}', '{{note}}', '["title", "clientName", "actor", "note"]'),
  ('project.weekly_summary', 'email', 'This week on {{title}}', '{{note}}' || chr(10) || chr(10) || 'Open the project to see what needs you.', '["title", "clientName", "actor", "note"]'),
  ('project.stage_ready', 'in_app', '{{stage}} can be finished · {{title}}', 'Everything it needs is done.', '["title", "clientName", "actor", "stage", "note"]'),
  ('project.materials_waiting', 'in_app', 'Material list waiting on the client · {{title}}', '{{note}}', '["title", "clientName", "actor", "note"]'),
  ('project.milestone_due', 'in_app', 'To invoice · {{title}}', '{{note}}', '["title", "clientName", "actor", "note"]'),
  ('project.client_update_ready', 'in_app', 'Client update to approve · {{title}}', '{{note}}', '["title", "clientName", "actor", "note"]')
) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
