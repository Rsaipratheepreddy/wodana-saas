-- PLM-148, PLM-156: the client's signed samples and data sheets, the sample log shared with the factory, and the
-- procurement gate's cleared mark.
--
-- 1. finish_client_signatures: the client signed the physical sample or the data sheet of a finish (in the categories
--    the firm marks, e.g. sanitary ware and whitegoods), recorded by the designer: the finish version signed, the day,
--    who signed and a photo of the signed sample or sheet. Only added: a newer one for the same finish replaces it in
--    the reading; a finish changed since needs signing again.
-- 2. finish_factory_shares: the lead designer shared the sample log and photos with the factory (who, when, a note).
--    While a share exists the factory reads the case's schedule from the Factory, and the factory lead was told.
-- 3. project_procurement_gates: when a project's procurement gate last cleared (client payment, material list and
--    signed samples all in) and procurement was told. Set by the worker's pass, cleared when the gate closes again.
-- Workspace-scoped, forced RLS, tenant_isolation. Idempotent; never disables RLS.
CREATE TABLE IF NOT EXISTS finish_client_signatures (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  case_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  version_id uuid NOT NULL,
  signed_on date NOT NULL,
  signer varchar(200) NOT NULL CHECK (length(btrim(signer)) > 0),
  asset_id uuid NOT NULL REFERENCES pre_project_brief_assets (id),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
  recorded_by uuid NOT NULL REFERENCES users (id),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, entry_id) REFERENCES design_ledger_entries (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, version_id) REFERENCES design_ledger_versions (workspace_id, id),
  FOREIGN KEY (workspace_id, case_id) REFERENCES pre_project_cases (workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS finish_client_signatures_entry_idx ON finish_client_signatures (workspace_id, entry_id, recorded_at DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS finish_factory_shares (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  case_id uuid NOT NULL,
  number integer NOT NULL CHECK (number > 0),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
  shared_by uuid NOT NULL REFERENCES users (id),
  shared_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, case_id, number),
  FOREIGN KEY (workspace_id, case_id) REFERENCES pre_project_cases (workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS project_procurement_gates (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id uuid NOT NULL,
  cleared_at timestamptz,
  notified_at timestamptz,
  checked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects (workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['finish_client_signatures', 'finish_factory_shares', 'project_procurement_gates'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = name AND policyname = 'tenant_isolation') THEN
      EXECUTE format($policy$CREATE POLICY tenant_isolation ON %I
        USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
        WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$, name);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT ON finish_client_signatures, finish_factory_shares TO wodana_app;
    GRANT SELECT, INSERT, UPDATE ON project_procurement_gates TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO workspace_record_classification (table_name, disposition, clear_predicate, file_columns) VALUES
  ('finish_client_signatures', 'clear', NULL, '{}'),
  ('finish_factory_shares', 'clear', NULL, '{}'),
  ('project_procurement_gates', 'clear', NULL, '{}')
ON CONFLICT (table_name) DO UPDATE SET disposition = excluded.disposition,
  clear_predicate = excluded.clear_predicate, file_columns = excluded.file_columns;
