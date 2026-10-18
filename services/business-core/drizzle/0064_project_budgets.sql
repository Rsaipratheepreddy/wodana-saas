-- Cost budgets per project package (and one for costs not in a package), in the workspace's currency,
-- set by people who manage costs. Actual costs are read from the records that caused them (stock moved
-- into or out of the project, services received, invoice price differences and charges), never typed.
CREATE TABLE project_budgets (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  package_id uuid,
  amount numeric(18, 4) NOT NULL CHECK (amount >= 0),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  note varchar(500) NOT NULL DEFAULT '',
  updated_by uuid NOT NULL REFERENCES users (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects (workspace_id, id),
  FOREIGN KEY (workspace_id, package_id) REFERENCES project_packages (workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX project_budgets_package_key ON project_budgets (workspace_id, project_id, coalesce(package_id, '00000000-0000-0000-0000-000000000000'::uuid));
--> statement-breakpoint
ALTER TABLE project_budgets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE project_budgets FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON project_budgets
  USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON project_budgets TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, 'project.over_budget', 'in_app', 'en', 1, 'approved', 'Over budget · {{title}}', '{{note}}', '["title", "clientName", "actor", "note"]'::jsonb, now()
  FROM workspaces workspace
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
