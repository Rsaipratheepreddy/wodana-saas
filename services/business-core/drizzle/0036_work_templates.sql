-- Standard work per way of delivering a package (made in the factory, bought, ready-made, subcontracted,
-- supplied by the client, site work): configuration the firm edits in Settings → Projects. Planning a
-- package from its template creates its tasks once; template_key marks where each came from.
CREATE TABLE work_templates (
  workspace_id uuid NOT NULL,
  supply varchar(12) NOT NULL CHECK (supply IN ('make', 'buy', 'ready_made', 'subcontract', 'client', 'site_work')),
  tasks jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(tasks) = 'array'),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid REFERENCES users (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, supply),
  FOREIGN KEY (workspace_id) REFERENCES workspaces (id)
);
--> statement-breakpoint
ALTER TABLE work_templates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE work_templates FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON work_templates
  USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE work_items ADD COLUMN template_key varchar(40);
--> statement-breakpoint
CREATE INDEX work_items_package_template_idx ON work_items (workspace_id, package_id) WHERE template_key IS NOT NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON work_templates TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, 'work.planned', 'in_app', 'en', 1, 'approved', '{{task}} is planned', '{{actor}} gave you {{note}} on {{title}}. {{due}}', '["title", "clientName", "actor", "task", "note", "due"]'::jsonb, now()
FROM workspaces workspace
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
