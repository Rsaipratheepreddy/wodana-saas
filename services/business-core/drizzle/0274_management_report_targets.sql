-- Management dashboards (PLM-134, PLM-104/105/129/130): the KPI targets the System Owner enters in Settings, and who
-- may open the dashboards. The KPIs themselves are computed from the business tables when read; nothing is copied.
--   * management_report_targets: one target per KPI per month, for the whole workspace (membership_id NULL) or one
--     Account Manager. Money and counts are what the month should add up to; a %, hours or days is the level to reach.
--     Numeric, never float; above zero; version-checked; a cleared target is deleted (audited).
--   * management_report_target_commands: one row per save command, so a repeated save changes nothing.
--   * Permissions: reports.management.view (open the dashboards) and reports.management.targets (enter targets),
--     both held by owners and administrators only, until managers are given dashboards per team.
-- Forced RLS with tenant_isolation; never disables RLS. Idempotent.
CREATE TABLE IF NOT EXISTS management_report_targets (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  kpi_code varchar(40) NOT NULL CHECK (kpi_code ~ '^[a-z][a-z0-9_]{1,39}$'),
  month date NOT NULL CHECK (month = date_trunc('month', month)::date),
  membership_id uuid,
  target numeric(20, 4) NOT NULL CHECK (target > 0),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES users (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, membership_id) REFERENCES workspace_memberships (workspace_id, id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS management_report_targets_key
  ON management_report_targets (workspace_id, kpi_code, month, coalesce(membership_id, '00000000-0000-0000-0000-000000000000'::uuid));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS management_report_target_commands (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id uuid NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id)
);
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['management_report_targets', 'management_report_target_commands'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = 'tenant_isolation') THEN
      EXECUTE format($policy$CREATE POLICY tenant_isolation ON %I
        USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
        WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$, t);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON management_report_targets TO wodana_app;
    GRANT SELECT, INSERT ON management_report_target_commands TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO permissions (code, description) VALUES
  ('reports.management.view', 'Open the management dashboards'),
  ('reports.management.targets', 'Enter the management dashboard targets')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
-- Owners and administrators hold both, like every permission; no other role gets them yet.
INSERT INTO role_permissions (workspace_id, role_id, permission_id)
SELECT role.workspace_id, role.id, permission.id
  FROM roles role CROSS JOIN permissions permission
 WHERE role.is_system AND role.code IN ('owner', 'administrator') AND permission.code IN ('reports.management.view', 'reports.management.targets')
ON CONFLICT (role_id, permission_id) DO NOTHING;
