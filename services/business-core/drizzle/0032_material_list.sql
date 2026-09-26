-- The project's material list: every material and finish the client must sign off before anything is
-- ordered (marble, veneer, fabric, paint, hardware…), each tied to the BOQ lines that use it. A sent
-- revision is frozen and fingerprinted; the client's decision is recorded per material. The list is
-- signed off when the latest revision is approved in full and nothing changed since.
CREATE TABLE project_material_items (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  position integer NOT NULL DEFAULT 0,
  catalog_item_id uuid,
  name varchar(240) NOT NULL CHECK (length(btrim(name)) > 0),
  code varchar(80) NOT NULL DEFAULT '',
  specification varchar(1000) NOT NULL DEFAULT '',
  supplier varchar(200) NOT NULL DEFAULT '',
  quantity numeric(18, 4) CHECK (quantity IS NULL OR quantity > 0),
  unit varchar(40) NOT NULL DEFAULT '',
  note varchar(2000) NOT NULL DEFAULT '',
  boq_line_ids uuid[] NOT NULL DEFAULT '{}',
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects (workspace_id, id),
  FOREIGN KEY (workspace_id, catalog_item_id) REFERENCES catalog_items (workspace_id, id) ON DELETE SET NULL (catalog_item_id)
);
--> statement-breakpoint
CREATE INDEX project_material_items_project_idx ON project_material_items (workspace_id, project_id, position);
--> statement-breakpoint
CREATE TABLE project_material_revisions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  number integer NOT NULL CHECK (number > 0),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'array'),
  content_hash char(64) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'signed_off', 'changes_requested')),
  sent_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  sent_by uuid NOT NULL,
  decided_at timestamptz,
  decided_by_name varchar(200),
  decision_method varchar(20),
  recorded_by uuid,
  decision_note varchar(2000) NOT NULL DEFAULT '',
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, project_id, number),
  FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects (workspace_id, id),
  CHECK ((status = 'sent') = (decided_at IS NULL))
);
--> statement-breakpoint
-- The client's decision on each material of a sent revision. Never edited.
CREATE TABLE project_material_decisions (
  workspace_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  item_id uuid NOT NULL,
  decision varchar(10) NOT NULL CHECK (decision IN ('approved', 'rejected')),
  note varchar(1000) NOT NULL DEFAULT '',
  PRIMARY KEY (workspace_id, revision_id, item_id),
  FOREIGN KEY (workspace_id, revision_id) REFERENCES project_material_revisions (workspace_id, id)
);
--> statement-breakpoint
CREATE FUNCTION project_material_frozen() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'A sent material list and its decisions cannot be changed. Send a new revision.';
END $$;
--> statement-breakpoint
CREATE TRIGGER project_material_decisions_frozen BEFORE UPDATE OR DELETE ON project_material_decisions
FOR EACH ROW EXECUTE FUNCTION project_material_frozen();
--> statement-breakpoint
-- The snapshot and fingerprint of a sent revision never change; only its decision is recorded once.
CREATE FUNCTION project_material_revision_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.snapshot IS DISTINCT FROM OLD.snapshot OR NEW.content_hash IS DISTINCT FROM OLD.content_hash OR NEW.number IS DISTINCT FROM OLD.number
     OR (OLD.status <> 'sent') THEN
    RAISE EXCEPTION 'A sent material list and its decisions cannot be changed. Send a new revision.';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER project_material_revisions_guard BEFORE UPDATE ON project_material_revisions
FOR EACH ROW EXECUTE FUNCTION project_material_revision_guard();
--> statement-breakpoint
DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['project_material_items', 'project_material_revisions', 'project_material_decisions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', name);
    EXECUTE format($policy$CREATE POLICY tenant_isolation ON %I
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$, name);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON project_material_items TO wodana_app;
    GRANT SELECT, INSERT, UPDATE ON project_material_revisions TO wodana_app;
    GRANT SELECT, INSERT ON project_material_decisions TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, 'in_app', 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('project.materials_signed_off', '{{title}}: material list signed off', '{{clientName}} signed off {{revision}}.', '["title", "clientName", "actor", "revision"]'),
  ('project.materials_changes', '{{title}}: changes to the material list', '{{clientName}} asked for changes to {{revision}}: {{note}}', '["title", "clientName", "actor", "revision", "note"]')
) AS template (code, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
