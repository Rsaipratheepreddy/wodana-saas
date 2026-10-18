-- The operator CLI's sandboxes (src/ops/ops-sandbox.ts, `sandbox --email-pattern`): the address scheme a sandbox's test
-- members sign in with, so every run finds the same people whatever their addresses are now.
--   * operator_sandbox_settings: one row per sandbox, on its first organization (whose test members they are; an
--     organization added with --organization-of uses its sandbox's row). email_pattern makes each member's address from
--     their role key, e.g. 'wodanatechnology+{role}@gmail.com'; no row means <role>@<slug>.test. Only the sandbox
--     command writes it, in the same transaction that moves the members to the pattern's addresses, so a row also marks
--     the organization as a sandbox. Configuration only: nothing secret.
-- Forced RLS with tenant_isolation; never disables RLS. Idempotent.
CREATE TABLE IF NOT EXISTS operator_sandbox_settings (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  email_pattern varchar(254) NOT NULL CHECK (email_pattern = lower(email_pattern)
    AND email_pattern ~ '^[^@[:space:]{}]*[{]role[}][^@[:space:]{}]*@[^@[:space:]{}]+[.][^@[:space:]{}]+$'),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE operator_sandbox_settings ENABLE ROW LEVEL SECURITY;
  ALTER TABLE operator_sandbox_settings FORCE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'operator_sandbox_settings' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON operator_sandbox_settings
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    -- Changed, never deleted (the row goes with its organization).
    GRANT SELECT, INSERT, UPDATE ON operator_sandbox_settings TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
-- Configuration: a go-live reset keeps it.
INSERT INTO workspace_record_classification (table_name, disposition, clear_predicate, file_columns) VALUES
  ('operator_sandbox_settings', 'keep', NULL, '{}')
ON CONFLICT (table_name) DO UPDATE SET disposition = excluded.disposition,
  clear_predicate = excluded.clear_predicate, file_columns = excluded.file_columns;
