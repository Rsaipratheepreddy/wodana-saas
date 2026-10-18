-- Warranty and aftercare. When the client accepts a handover pack, each scope line it covers starts its
-- warranty on that day, for the months set for how its package is delivered (Settings → Projects;
-- a line's months can change later, with why). Claims are recorded as the client raises them and
-- triaged: covered (a warranty snag to fix, even after the project is complete), not covered, or
-- chargeable — each with why when it isn't simply covered.
CREATE TABLE warranty_defaults (
  workspace_id uuid NOT NULL,
  supply varchar(12) NOT NULL CHECK (supply IN ('make', 'buy', 'ready_made', 'subcontract', 'client', 'site_work')),
  months integer NOT NULL CHECK (months BETWEEN 0 AND 600),
  updated_by uuid REFERENCES users (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, supply)
);
--> statement-breakpoint
CREATE TABLE warranty_items (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  boq_line_id uuid NOT NULL,
  pack_id uuid,
  months integer NOT NULL CHECK (months BETWEEN 0 AND 600),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  note varchar(500) NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, boq_line_id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects (workspace_id, id),
  FOREIGN KEY (workspace_id, boq_line_id) REFERENCES project_boq_lines (workspace_id, id),
  FOREIGN KEY (workspace_id, pack_id) REFERENCES handover_packs (workspace_id, id),
  CHECK (ends_on >= starts_on - 1)
);
--> statement-breakpoint
CREATE TABLE warranty_claims (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  number integer NOT NULL CHECK (number > 0),
  raised_on date NOT NULL,
  raised_by_name varchar(200) NOT NULL CHECK (length(btrim(raised_by_name)) > 0),
  channel varchar(10) NOT NULL CHECK (channel IN ('phone', 'email', 'visit', 'message', 'portal')),
  description varchar(2000) NOT NULL CHECK (length(btrim(description)) > 0),
  area_id uuid,
  boq_line_id uuid,
  status varchar(12) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'covered', 'not_covered', 'chargeable')),
  decision_note varchar(1000) NOT NULL DEFAULT '',
  decided_by uuid REFERENCES users (id),
  decided_at timestamptz,
  snag_id uuid,
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, project_id, number),
  FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects (workspace_id, id),
  FOREIGN KEY (workspace_id, boq_line_id) REFERENCES project_boq_lines (workspace_id, id),
  FOREIGN KEY (workspace_id, snag_id) REFERENCES work_items (workspace_id, id),
  CHECK ((status = 'open') = (decided_at IS NULL)),
  CHECK (status IN ('open', 'covered') OR length(btrim(decision_note)) > 0),
  CHECK ((status = 'covered') = (snag_id IS NOT NULL))
);
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['warranty_defaults', 'warranty_items', 'warranty_claims'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($policy$CREATE POLICY tenant_isolation ON %I
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$, t);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON warranty_defaults, warranty_items, warranty_claims TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('warranty.claim', 'in_app', 'Warranty claim on {{title}}', '{{actor}}: {{note}}', '["title", "clientName", "actor", "note"]'),
  ('warranty.claim', 'email', 'Warranty claim on {{title}}', E'{{actor}} recorded a warranty claim for {{clientName}}:\n\n{{note}}', '["title", "clientName", "actor", "note"]'),
  ('warranty.expiring', 'in_app', 'Warranty ending soon · {{title}}', '{{note}}', '["title", "clientName", "actor", "note"]')
) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
