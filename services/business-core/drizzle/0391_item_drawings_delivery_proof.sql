-- Shop drawings and delivery proof per item. After the client signs the quotation each item (joinery, furniture, a
-- fit-out piece) gets its own shop drawing, checked by the lead designer and signed by the client in the portal with a
-- one-time code; signing locks the item's sizes and quantity to that drawing. Each item is then marked delivered (or
-- delivered and installed) only with a photo of it on site.
--
-- 1. project_item_drawings: one row per item (a live BOQ line) with where its shop drawing stands (waiting, with the
--    lead designer, with the client, changes asked, signed) and, once signed, the locked quantity and sizes.
-- 2. project_item_drawing_versions: each shop drawing version (the file, its number, who uploaded it, a note, the
--    quantity and sizes it shows), the lead designer's check (approved, or returned with the reason) and the client's
--    answer. A signed version never changes.
-- 3. project_item_drawing_signatures: the client's signature on a version, like every other signature: who, when, the
--    code they confirmed, the device, and the fingerprint (SHA-256) of the signed file. Only added.
-- 4. project_item_deliveries: one row per item delivered or delivered and installed, with who and when.
-- 5. project_item_delivery_photos: the photos of an item on site, each taken by a signed-in person (who and when). Only added.
-- 6. project_item_commands: each item command once (its id, the action and the hash of what was sent).
-- 7. The notice templates for every workspace.
-- Workspace-scoped, forced RLS, tenant_isolation. Nothing is backfilled. Idempotent; never disables RLS.
CREATE TABLE IF NOT EXISTS project_item_drawings (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id uuid NOT NULL,
  project_id uuid NOT NULL,
  line_id uuid NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'with_lead_designer', 'with_client', 'changes_asked', 'signed')),
  latest_number integer NOT NULL DEFAULT 0 CHECK (latest_number >= 0),
  current_version_id uuid,
  locked_version_id uuid,
  locked_at timestamptz,
  locked_quantity numeric(18, 4),
  locked_unit varchar(40),
  locked_width numeric(18, 4),
  locked_height numeric(18, 4),
  locked_depth numeric(18, 4),
  locked_dimension_unit varchar(4),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id),
  UNIQUE (workspace_id, project_id, line_id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, line_id) REFERENCES project_boq_lines (workspace_id, id),
  CHECK ((status = 'signed') = (locked_at IS NOT NULL)),
  CHECK (locked_at IS NULL OR (locked_version_id IS NOT NULL AND locked_quantity IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS project_item_drawing_versions (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id uuid NOT NULL,
  project_id uuid NOT NULL,
  line_id uuid NOT NULL,
  item_drawing_id uuid NOT NULL,
  number integer NOT NULL CHECK (number > 0),
  status varchar(20) NOT NULL DEFAULT 'with_lead_designer'
    CHECK (status IN ('with_lead_designer', 'returned', 'with_client', 'changes_asked', 'signed')),
  original_name varchar(255) NOT NULL DEFAULT '',
  mime_type varchar(100) NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size > 0),
  object_key varchar(500) NOT NULL,
  preview_key varchar(500),
  sha256 char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  note varchar(1000) NOT NULL DEFAULT '',
  quantity numeric(18, 4) NOT NULL CHECK (quantity > 0),
  unit varchar(40) NOT NULL DEFAULT '',
  width numeric(18, 4) CHECK (width IS NULL OR width > 0),
  height numeric(18, 4) CHECK (height IS NULL OR height > 0),
  depth numeric(18, 4) CHECK (depth IS NULL OR depth > 0),
  dimension_unit varchar(4) NOT NULL CHECK (dimension_unit IN ('mm', 'cm', 'm', 'in', 'ft')),
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES users (id),
  reviewed_at timestamptz,
  review_note varchar(1000) NOT NULL DEFAULT '',
  client_decided_at timestamptz,
  client_grant_id uuid,
  client_note varchar(1000) NOT NULL DEFAULT '',
  PRIMARY KEY (workspace_id, id),
  UNIQUE (workspace_id, line_id, number),
  FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, line_id) REFERENCES project_boq_lines (workspace_id, id),
  FOREIGN KEY (workspace_id, item_drawing_id) REFERENCES project_item_drawings (workspace_id, id) ON DELETE CASCADE,
  CHECK ((status = 'with_lead_designer') = (reviewed_at IS NULL)),
  CHECK (status <> 'returned' OR length(btrim(review_note)) > 0),
  CHECK ((status IN ('changes_asked', 'signed')) = (client_decided_at IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS project_item_drawing_versions_project_idx ON project_item_drawing_versions (workspace_id, project_id, line_id, number DESC);
--> statement-breakpoint
-- A signed version is the item's lock: its file, sizes, quantity and decision never change afterwards.
CREATE OR REPLACE FUNCTION project_item_drawing_versions_signed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'signed' THEN
    RAISE EXCEPTION 'A signed shop drawing cannot be changed.';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS project_item_drawing_versions_signed_lock ON project_item_drawing_versions;
--> statement-breakpoint
CREATE TRIGGER project_item_drawing_versions_signed_lock BEFORE UPDATE ON project_item_drawing_versions
FOR EACH ROW EXECUTE FUNCTION project_item_drawing_versions_signed();
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS project_item_drawing_signatures (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id uuid NOT NULL,
  project_id uuid NOT NULL,
  case_id uuid NOT NULL,
  line_id uuid NOT NULL,
  version_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  grant_id uuid NOT NULL,
  signer_name varchar(200) NOT NULL CHECK (length(btrim(signer_name)) > 0),
  signed_at timestamptz NOT NULL DEFAULT now(),
  challenge_id uuid NOT NULL,
  signer_user_agent varchar(500),
  signer_device varchar(120),
  file_sha256 char(64) NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  command_id uuid NOT NULL,
  PRIMARY KEY (workspace_id, id),
  UNIQUE (workspace_id, version_id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, version_id) REFERENCES project_item_drawing_versions (workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS project_item_drawing_signatures_case_idx ON project_item_drawing_signatures (workspace_id, case_id, signed_at DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS project_item_deliveries (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id uuid NOT NULL,
  project_id uuid NOT NULL,
  line_id uuid NOT NULL,
  status varchar(10) NOT NULL CHECK (status IN ('delivered', 'installed')),
  delivered_by uuid NOT NULL REFERENCES users (id),
  delivered_at timestamptz NOT NULL DEFAULT now(),
  installed_by uuid REFERENCES users (id),
  installed_at timestamptz,
  note varchar(1000) NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (workspace_id, id),
  UNIQUE (workspace_id, project_id, line_id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, line_id) REFERENCES project_boq_lines (workspace_id, id),
  CHECK ((status = 'installed') = (installed_at IS NOT NULL)),
  CHECK ((installed_at IS NULL) = (installed_by IS NULL))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS project_item_delivery_photos (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id uuid NOT NULL,
  project_id uuid NOT NULL,
  line_id uuid NOT NULL,
  original_name varchar(255) NOT NULL DEFAULT '',
  mime_type varchar(100) NOT NULL CHECK (mime_type LIKE 'image/%'),
  byte_size integer NOT NULL CHECK (byte_size > 0),
  object_key varchar(500) NOT NULL,
  preview_key varchar(500),
  sha256 char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  taken_by uuid NOT NULL REFERENCES users (id),
  taken_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, line_id) REFERENCES project_boq_lines (workspace_id, id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS project_item_delivery_photos_line_idx ON project_item_delivery_photos (workspace_id, project_id, line_id, taken_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS project_item_commands (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id uuid NOT NULL,
  project_id uuid NOT NULL,
  action varchar(40) NOT NULL,
  request_hash char(64) NOT NULL,
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects (workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['project_item_drawings', 'project_item_drawing_versions', 'project_item_drawing_signatures', 'project_item_deliveries',
    'project_item_delivery_photos', 'project_item_commands'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = table_name AND policyname = 'tenant_isolation') THEN
      EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
        USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
        WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$p$, table_name);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    -- Evidence, photos and the command log are only added; states and versions move forward.
    REVOKE ALL ON project_item_drawing_signatures, project_item_delivery_photos, project_item_commands FROM wodana_app;
    GRANT SELECT, INSERT ON project_item_drawing_signatures, project_item_delivery_photos, project_item_commands TO wodana_app;
    REVOKE DELETE ON project_item_drawings, project_item_drawing_versions, project_item_deliveries FROM wodana_app;
    GRANT SELECT, INSERT, UPDATE ON project_item_drawings, project_item_drawing_versions, project_item_deliveries TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO workspace_record_classification (table_name, disposition, clear_predicate, file_columns) VALUES
  ('project_item_drawings', 'clear', NULL, '{}'),
  ('project_item_drawing_versions', 'clear', NULL, ARRAY['object_key', 'preview_key']),
  ('project_item_drawing_signatures', 'clear', NULL, '{}'),
  ('project_item_deliveries', 'clear', NULL, '{}'),
  ('project_item_delivery_photos', 'clear', NULL, ARRAY['object_key', 'preview_key']),
  ('project_item_commands', 'clear', NULL, '{}')
ON CONFLICT (table_name) DO UPDATE SET disposition = excluded.disposition, clear_predicate = excluded.clear_predicate, file_columns = excluded.file_columns;
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
  FROM workspaces workspace
 CROSS JOIN (VALUES
   ('project.item_drawing_uploaded', 'in_app', 'Shop drawing to check · {{title}}', '{{actor}} uploaded the shop drawing for {{item}}. {{note}}', '["title","clientName","actor","item","note"]'),
   ('project.item_drawing_returned', 'in_app', 'Shop drawing changes · {{title}}', '{{actor}} asked for changes to {{item}}: {{note}}', '["title","clientName","actor","item","note"]'),
   ('project.item_drawings_signed', 'in_app', 'Shop drawings signed · {{title}}', '{{actor}} signed the shop drawings for {{item}}. They are locked.', '["title","clientName","actor","item","note"]'),
   ('project.item_drawings_signed', 'email', 'Shop drawings signed: {{title}}', E'{{actor}} signed the shop drawings for {{item}}.\n\nThe signed items are locked to the sizes and quantities on their drawings.', '["title","clientName","actor","item","note"]')
 ) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
