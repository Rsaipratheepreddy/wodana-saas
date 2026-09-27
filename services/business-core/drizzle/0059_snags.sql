-- Snags are project work (one task system) with what a snag needs: how serious it is, where it came
-- from (an inspection, a delivery, the client, a warranty claim), the area it's in, and photos before
-- and after. Whoever fixed it can't close it, and closing needs a photo after. Stage checks read them:
-- all snags closed, and no critical snag open.
ALTER TABLE work_items ADD COLUMN severity varchar(10) CHECK (severity IS NULL OR severity IN ('minor', 'major', 'critical'));
--> statement-breakpoint
ALTER TABLE work_items ADD COLUMN source varchar(12) CHECK (source IS NULL OR source IN ('internal', 'inspection', 'delivery', 'client', 'warranty'));
--> statement-breakpoint
ALTER TABLE work_items ADD COLUMN area_id uuid;
--> statement-breakpoint
ALTER TABLE work_items ADD COLUMN fixed_by uuid REFERENCES users (id);
--> statement-breakpoint
UPDATE work_items SET severity = 'minor', source = 'internal' WHERE type = 'snag';
--> statement-breakpoint
ALTER TABLE work_items ADD CONSTRAINT work_items_snag_check CHECK ((type = 'snag') = (severity IS NOT NULL AND source IS NOT NULL));
--> statement-breakpoint
CREATE TABLE work_item_photos (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  work_item_id uuid NOT NULL,
  kind varchar(10) NOT NULL CHECK (kind IN ('before', 'after')),
  original_name varchar(255) NOT NULL DEFAULT '',
  mime_type varchar(100) NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size > 0),
  object_key varchar(500) NOT NULL,
  preview_key varchar(500),
  sha256 char(64) NOT NULL,
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, work_item_id) REFERENCES work_items (workspace_id, id)
);
--> statement-breakpoint
CREATE INDEX work_item_photos_item_idx ON work_item_photos (workspace_id, work_item_id);
--> statement-breakpoint
DO $$
BEGIN
  EXECUTE 'ALTER TABLE work_item_photos ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE work_item_photos FORCE ROW LEVEL SECURITY';
  EXECUTE $policy$CREATE POLICY tenant_isolation ON work_item_photos
    USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
    WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT ON work_item_photos TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('work.snag_ready', 'in_app', '{{task}} is fixed: check it', '{{actor}} marked it ready on {{title}}.', '["title", "clientName", "actor", "task", "note"]'),
  ('work.snag_reopened', 'in_app', '{{task}} is open again', '{{actor}}: {{note}}', '["title", "clientName", "actor", "task", "note"]')
) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
