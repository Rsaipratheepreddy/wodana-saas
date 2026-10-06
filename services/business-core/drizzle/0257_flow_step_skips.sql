-- P3 steps (plan §5a, §6.9a, §7a E2-5; PLM-081). A tenant table with forced RLS and tenant_isolation.
--   * crm_opportunity_step_skips — a job marks a step as not needed, with a reason, who and when: a step its
--     enquiry type marks "used if needed" (E2-5), and material selection as "Not required for this order" (PLM-081),
--     which is otherwise never left blank. One live skip per job and step; undoing a skip keeps the row (revoked_at,
--     revoked_by, revoke_reason) so the history stays. The step key and the flow version the job ran are kept.
-- Runs as the migration owner, so forced RLS is never disabled. Idempotent.
CREATE TABLE IF NOT EXISTS crm_opportunity_step_skips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL REFERENCES crm_opportunities (id) ON DELETE CASCADE,
  step_key varchar(40) NOT NULL CHECK (step_key ~ '^[a-z][a-z0-9_]{0,39}$'),
  flow_version_id uuid,
  reason varchar(1000) NOT NULL CHECK (length(btrim(reason)) >= 3),
  command_id uuid,
  skipped_by uuid NOT NULL REFERENCES users (id),
  skipped_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES users (id),
  revoke_reason varchar(1000),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, flow_version_id) REFERENCES crm_flow_versions (workspace_id, id),
  CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS crm_opportunity_step_skips_live_uidx ON crm_opportunity_step_skips (workspace_id, opportunity_id, step_key) WHERE revoked_at IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS crm_opportunity_step_skips_command_uidx ON crm_opportunity_step_skips (workspace_id, command_id) WHERE command_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS crm_opportunity_step_skips_opportunity_idx ON crm_opportunity_step_skips (workspace_id, opportunity_id, skipped_at);
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE crm_opportunity_step_skips ENABLE ROW LEVEL SECURITY;
  ALTER TABLE crm_opportunity_step_skips FORCE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'crm_opportunity_step_skips' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON crm_opportunity_step_skips
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    -- A skip is never edited or deleted; only its undo is written.
    GRANT SELECT, INSERT ON crm_opportunity_step_skips TO wodana_app;
    GRANT UPDATE (revoked_at, revoked_by, revoke_reason) ON crm_opportunity_step_skips TO wodana_app;
  END IF;
END $$;
