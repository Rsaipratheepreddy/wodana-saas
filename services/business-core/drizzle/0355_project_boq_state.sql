-- PLM-161 / PLM-167 / PLM-168: the project BOQ's lifecycle (draft → technical_verified → qs_approved → locked),
-- the revisions the QS approved and the history of each step.
--
-- 1. project_boq_states: one row per project (none means draft, revision 0: projects started before this release read
--    sensibly). Who verified, approved, returned and locked it, and when.
-- 2. project_boq_revisions: the snapshot taken at each QS approval (lines, quantities, rates, amounts and costs), as
--    BOQ R-n, fingerprinted. Never edited.
-- 3. project_boq_state_events: what happened to the BOQ as a whole (verified, approved, returned with the reason, locked,
--    changed by a variation), oldest first. Never edited.
-- 4. workspace_project_settings: boq_review (the lifecycle shows on the Scope tab and the QS approves the BOQ),
--    auto_start_on_payment (the project starts, with its draft BOQ, when the accepted quotation's upfront payment is
--    verified by Finance), boq_technical_role (the project role that verifies the BOQ; null: the technical designer).
-- Business records of the project: workspace-scoped, forced RLS, tenant_isolation. Idempotent; never disables RLS.
ALTER TABLE workspace_project_settings
  ADD COLUMN IF NOT EXISTS boq_review boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_start_on_payment boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS boq_technical_role varchar(64);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS project_boq_states (
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'technical_verified', 'qs_approved', 'locked')),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  verified_by uuid REFERENCES users (id),
  verified_at timestamptz,
  approved_by uuid REFERENCES users (id),
  approved_at timestamptz,
  locked_by uuid REFERENCES users (id),
  locked_at timestamptz,
  returned_by uuid REFERENCES users (id),
  returned_at timestamptz,
  return_reason varchar(500) NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects (workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS project_boq_revisions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  number integer NOT NULL CHECK (number > 0),
  label varchar(20) NOT NULL,
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  content_hash char(64) NOT NULL,
  currency char(3) NOT NULL,
  total numeric(18, 4) NOT NULL,
  cost numeric(18, 4),
  lines integer NOT NULL DEFAULT 0 CHECK (lines >= 0),
  note varchar(500) NOT NULL DEFAULT '',
  approved_by uuid NOT NULL REFERENCES users (id),
  approved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, project_id, number),
  FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects (workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS project_boq_state_events (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  kind varchar(24) NOT NULL CHECK (kind IN ('drafted', 'verified', 'qs_approved', 'returned', 'locked', 'changed')),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detail) = 'object'),
  actor_user_id uuid REFERENCES users (id),
  -- The clock time of each insert, so entries written in one transaction keep their order.
  at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects (workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS project_boq_state_events_project_idx ON project_boq_state_events (workspace_id, project_id, at);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION project_boq_history_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'The BOQ history cannot be changed.';
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'project_boq_revisions_no_update') THEN
    CREATE TRIGGER project_boq_revisions_no_update BEFORE UPDATE OR DELETE ON project_boq_revisions FOR EACH ROW EXECUTE FUNCTION project_boq_history_immutable();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'project_boq_state_events_no_update') THEN
    CREATE TRIGGER project_boq_state_events_no_update BEFORE UPDATE OR DELETE ON project_boq_state_events FOR EACH ROW EXECUTE FUNCTION project_boq_history_immutable();
  END IF;
END $$;
--> statement-breakpoint
DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['project_boq_states', 'project_boq_revisions', 'project_boq_state_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = name AND policyname = 'tenant_isolation') THEN
      EXECUTE format($policy$CREATE POLICY tenant_isolation ON %I
        USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
        WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$, name);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON project_boq_states TO wodana_app;
    GRANT SELECT, INSERT ON project_boq_revisions, project_boq_state_events TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO workspace_record_classification (table_name, disposition, clear_predicate, file_columns) VALUES
  ('project_boq_states', 'clear', NULL, '{}'),
  ('project_boq_revisions', 'clear', NULL, '{}'),
  ('project_boq_state_events', 'clear', NULL, '{}')
ON CONFLICT (table_name) DO UPDATE SET disposition = excluded.disposition,
  clear_predicate = excluded.clear_predicate, file_columns = excluded.file_columns;
