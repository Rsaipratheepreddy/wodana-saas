-- Guide step 21 (16 Oct 2026), release per item: procurement orders the item's materials or checks factory stock, then
-- signs off its supplies; the project manager and the factory lead hear that production is about to start. Where the firm
-- asks (workspace_factory_settings.require_supplies_signoff), a work order for the item is released only after it.
-- One sign-off per item; workspace-scoped, forced RLS, tenant_isolation. Configuration is off by default.
CREATE TABLE IF NOT EXISTS project_item_supplies (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id uuid NOT NULL,
  line_id uuid NOT NULL,
  method varchar(12) NOT NULL CHECK (method IN ('ordered', 'from_stock')),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 1000),
  signed_by uuid NOT NULL REFERENCES users (id),
  signed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id, line_id)
);
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE project_item_supplies ENABLE ROW LEVEL SECURITY;
  ALTER TABLE project_item_supplies FORCE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'project_item_supplies' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON project_item_supplies
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON project_item_supplies TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO workspace_record_classification (table_name, disposition, clear_predicate, file_columns) VALUES ('project_item_supplies', 'clear', NULL, '{}')
ON CONFLICT (table_name) DO UPDATE SET disposition = excluded.disposition, clear_predicate = excluded.clear_predicate, file_columns = excluded.file_columns;
--> statement-breakpoint
ALTER TABLE workspace_factory_settings ADD COLUMN IF NOT EXISTS require_supplies_signoff boolean NOT NULL DEFAULT false;
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('project.item_supplies_signed', 'in_app', 'Supplies signed off · {{title}}', '{{actor}} signed off the supplies for {{item}}. Production is about to start. {{note}}', '["title", "clientName", "actor", "item", "note"]'),
  ('project.item_supplies_signed', 'email', 'Supplies signed off: {{title}}', E'{{actor}} signed off the supplies for {{item}}. Production is about to start.\n\n{{note}}', '["title", "clientName", "actor", "item", "note"]')
) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
