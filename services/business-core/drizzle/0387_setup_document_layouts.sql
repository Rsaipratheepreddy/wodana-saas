-- §0.3 P3/P4: the firm edits its documents' layout in Setup (configuration, never amounts): for a tax invoice its
-- title, which blocks show and its own wording (how to pay, terms, footer). One row per document kind; version-checked.
-- Workspace-scoped, forced RLS, tenant_isolation. Idempotent; never disables RLS.
CREATE TABLE IF NOT EXISTS setup_document_layouts (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  kind varchar(30) NOT NULL CHECK (kind IN ('client_invoice')),
  layout jsonb NOT NULL CHECK (jsonb_typeof(layout) = 'object'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_by uuid REFERENCES users (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, kind)
);
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE setup_document_layouts ENABLE ROW LEVEL SECURITY;
  ALTER TABLE setup_document_layouts FORCE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'setup_document_layouts' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON setup_document_layouts
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON setup_document_layouts TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO workspace_record_classification (table_name, disposition, clear_predicate, file_columns) VALUES ('setup_document_layouts', 'keep', NULL, '{}')
ON CONFLICT (table_name) DO UPDATE SET disposition = excluded.disposition, clear_predicate = excluded.clear_predicate, file_columns = excluded.file_columns;
