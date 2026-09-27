-- Handover. A pack gathers what the client receives (drawings, warranties, manuals, care guides,
-- as-built photos) for the whole project or some of its areas. Issuing it freezes a revision (its
-- documents listed and fingerprinted); it can't change after. The client accepts it — possibly with minor
-- items still outstanding, which become snags — or refuses it with why, which becomes a snag and a new
-- revision to issue. No critical snag may be open at acceptance. The handover stage check reads it.
CREATE TABLE handover_packs (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  title varchar(200) NOT NULL CHECK (length(btrim(title)) > 0),
  area_ids uuid[] NOT NULL DEFAULT '{}',
  status varchar(10) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'accepted', 'refused')),
  replaces_id uuid,
  snapshot jsonb,
  content_hash char(64),
  issued_by uuid REFERENCES users (id),
  issued_at timestamptz,
  decided_on date,
  decided_by_name varchar(200),
  decision_method varchar(20) CHECK (decision_method IS NULL OR decision_method IN ('signed_document', 'in_person', 'email', 'portal')),
  decision_note varchar(1000) NOT NULL DEFAULT '',
  recorded_by uuid REFERENCES users (id),
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, project_id, revision),
  FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects (workspace_id, id),
  FOREIGN KEY (workspace_id, replaces_id) REFERENCES handover_packs (workspace_id, id),
  CHECK ((status = 'draft') = (issued_at IS NULL)),
  CHECK (status = 'draft' OR (snapshot IS NOT NULL AND content_hash IS NOT NULL AND issued_by IS NOT NULL)),
  CHECK ((status IN ('accepted', 'refused')) = (decided_on IS NOT NULL AND decided_by_name IS NOT NULL AND decision_method IS NOT NULL AND recorded_by IS NOT NULL)),
  CHECK (status <> 'refused' OR length(btrim(decision_note)) > 0)
);
--> statement-breakpoint
CREATE TABLE handover_documents (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  pack_id uuid NOT NULL,
  kind varchar(12) NOT NULL CHECK (kind IN ('drawing', 'warranty', 'manual', 'care_guide', 'photo', 'other')),
  title varchar(200) NOT NULL CHECK (length(btrim(title)) > 0),
  original_name varchar(255) NOT NULL DEFAULT '',
  mime_type varchar(100) NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size > 0),
  object_key varchar(500) NOT NULL,
  sha256 char(64) NOT NULL,
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, pack_id) REFERENCES handover_packs (workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
-- A pack's frozen revision never changes.
CREATE FUNCTION handover_pack_frozen() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'draft' AND (NEW.snapshot IS DISTINCT FROM OLD.snapshot OR NEW.content_hash IS DISTINCT FROM OLD.content_hash OR NEW.title IS DISTINCT FROM OLD.title
                               OR NEW.area_ids IS DISTINCT FROM OLD.area_ids) THEN
    RAISE EXCEPTION 'An issued handover pack cannot be changed.';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER handover_packs_frozen BEFORE UPDATE ON handover_packs FOR EACH ROW EXECUTE FUNCTION handover_pack_frozen();
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['handover_packs', 'handover_documents'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($policy$CREATE POLICY tenant_isolation ON %I
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$, t);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON handover_packs TO wodana_app;
    GRANT SELECT, INSERT, DELETE ON handover_documents TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('handover.accepted', 'in_app', '{{title}}: handover accepted', '{{note}}', '["title", "clientName", "actor", "note"]'),
  ('handover.refused', 'in_app', '{{title}}: handover refused', '{{actor}}: {{note}}', '["title", "clientName", "actor", "note"]')
) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
