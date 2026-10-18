-- Free design revisions, then a chargeable change (PLM-049/051).
--
-- design_extra_revisions links a design step's revision beyond the package's free ones to the change request drafted
-- for it in the change module (the team prices it; the client approves it). A step's revisions are counted from the
-- client's "changes requested" records, never stored here: a row is only the link, who asked and on what. One live link
-- per step and revision (asking twice drafts once); a change the client declined or the team withdrew can be replaced
-- by a fresh draft, the old link kept with replaced_at.
-- Workspace-scoped, forced RLS, tenant_isolation. Idempotent; never disables RLS.
CREATE TABLE IF NOT EXISTS design_extra_revisions (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id uuid NOT NULL,
  case_id uuid NOT NULL,
  stage varchar(40) NOT NULL CHECK (stage IN ('space_planning', 'concepts', 'material_selection', 'renders')),
  revision integer NOT NULL CHECK (revision > 0),
  included integer NOT NULL CHECK (included >= 0),
  change_request_id uuid NOT NULL,
  asked_by_user_id uuid REFERENCES users (id),
  asked_by_grant_id uuid,
  source_ref varchar(80),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  replaced_at timestamptz,
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, case_id) REFERENCES pre_project_cases (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, change_request_id) REFERENCES change_requests (workspace_id, id) ON DELETE CASCADE,
  CHECK (revision > included),
  CHECK (asked_by_user_id IS NULL OR asked_by_grant_id IS NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS design_extra_revisions_once ON design_extra_revisions (workspace_id, case_id, stage, revision) WHERE replaced_at IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS design_extra_revisions_change ON design_extra_revisions (workspace_id, change_request_id);
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE design_extra_revisions ENABLE ROW LEVEL SECURITY;
  ALTER TABLE design_extra_revisions FORCE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'design_extra_revisions' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON design_extra_revisions
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON design_extra_revisions TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO workspace_record_classification (table_name, disposition, clear_predicate, file_columns) VALUES
  ('design_extra_revisions', 'clear', NULL, '{}')
ON CONFLICT (table_name) DO UPDATE SET disposition = excluded.disposition, clear_predicate = excluded.clear_predicate, file_columns = excluded.file_columns;
