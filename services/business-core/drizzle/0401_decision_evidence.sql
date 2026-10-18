-- §0.3 P0 (every verification shows its attachments): the photo or PDF behind a decision a person records for
-- someone else, where the module kept only words: a receipt the team recorded, a client credit, a client's
-- withdrawal, a client decision taken down by staff, a handover acceptance, factory output, a stock count, a
-- supplier's bank letter and a warranty claim. A file is uploaded first (unbound), then the decision binds it to
-- its record. Workspace-scoped, forced RLS, tenant_isolation. Idempotent; never disables RLS.
CREATE TABLE IF NOT EXISTS decision_evidence_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  kind varchar(40) NOT NULL CHECK (kind IN ('receipt', 'client_credit', 'proposal_withdrawal', 'design_decision', 'handover_acceptance',
    'material_decision', 'factory_output', 'stock_correction', 'supplier_bank', 'warranty_claim')),
  subject_id varchar(80),
  storage_key varchar(500) NOT NULL,
  file_name varchar(255) NOT NULL,
  mime_type varchar(100) NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size > 0),
  sha256 char(64) NOT NULL,
  has_preview boolean NOT NULL DEFAULT false,
  uploaded_by uuid NOT NULL REFERENCES users (id),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  bound_at timestamptz
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS decision_evidence_files_subject_idx ON decision_evidence_files (workspace_id, kind, subject_id);
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE decision_evidence_files ENABLE ROW LEVEL SECURITY;
  ALTER TABLE decision_evidence_files FORCE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'decision_evidence_files' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON decision_evidence_files
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON decision_evidence_files TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO workspace_record_classification (table_name, disposition, clear_predicate, file_columns) VALUES ('decision_evidence_files', 'clear', NULL, ARRAY['storage_key'])
ON CONFLICT (table_name) DO UPDATE SET disposition = excluded.disposition, clear_predicate = excluded.clear_predicate, file_columns = excluded.file_columns;
