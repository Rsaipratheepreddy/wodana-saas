-- Project team from the enquiry to Won / Completed, and installation sign-off with money owed.
--
-- 1. PLM-100 / PLM-089: a role on a Planning case or a project can be "not applicable" (the enquiry's choice
--    carries through with its people). People keep living in project_assignments.role_keys; this table holds
--    only the roles marked not applicable, one row per role. Workspace-scoped, forced RLS, tenant_isolation.
-- 2. PLM-089: the project team keeps a short note on people outside Wodana who do the work (installers,
--    subcontractors).
-- 3. PLM-065: Finance and the account manager hear when installation is signed off while the balance due
--    before installation is still owed (someone who manages projects, with why).
-- Nothing is backfilled: existing cases and projects keep their teams. Idempotent; never disables RLS.
CREATE TABLE IF NOT EXISTS project_team_not_applicable (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id uuid,
  case_id uuid,
  role_key varchar(64) NOT NULL CHECK (role_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  set_by uuid REFERENCES users (id),
  set_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_team_not_applicable_scope_check CHECK (num_nonnulls(project_id, case_id) = 1),
  FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, case_id) REFERENCES pre_project_cases (workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS project_team_not_applicable_project_idx ON project_team_not_applicable (workspace_id, project_id, role_key) WHERE project_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS project_team_not_applicable_case_idx ON project_team_not_applicable (workspace_id, case_id, role_key) WHERE case_id IS NOT NULL;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE project_team_not_applicable ENABLE ROW LEVEL SECURITY;
  ALTER TABLE project_team_not_applicable FORCE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'project_team_not_applicable' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON project_team_not_applicable
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, DELETE ON project_team_not_applicable TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE delivery_projects ADD COLUMN IF NOT EXISTS team_note varchar(1000) NOT NULL DEFAULT '';
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('site.installation_owed', 'in_app', 'Installation signed off with money owed · {{title}}', '{{actor}}: {{note}}', '["title","clientName","actor","note"]'),
  ('site.installation_owed', 'email', 'Installation signed off with money owed · {{title}}', E'{{actor}} signed off the installation on {{title}} before it was paid.\n\n{{note}}', '["title","clientName","actor","note"]')
) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
