-- The site's day. A report (one per person, project and day) says who worked by trade, the weather,
-- what was installed against the scope, safety (none, an observation, an incident) and whether the plan
-- is at risk (watch, blocked) with who recovers it and by when. It needs photos or why nothing was done.
-- Someone other than its author approves it: approved installation takes the goods from the project's
-- stock at its site (so nothing is installed that didn't arrive) and never passes the scope line. A
-- correction is a later entry, never an edit. Site work has a start and a finish on the project; while
-- it's open, the daily run chases missing reports.
ALTER TABLE delivery_projects ADD COLUMN site_started_on date, ADD COLUMN site_finished_on date;
--> statement-breakpoint
ALTER TABLE delivery_projects ADD CONSTRAINT delivery_projects_site_dates_check CHECK (site_finished_on IS NULL OR (site_started_on IS NOT NULL AND site_finished_on >= site_started_on));
--> statement-breakpoint
CREATE TABLE site_reports (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  report_date date NOT NULL,
  author_id uuid NOT NULL REFERENCES users (id),
  status varchar(10) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'returned')),
  weather varchar(120) NOT NULL DEFAULT '',
  safety varchar(12) NOT NULL DEFAULT 'none' CHECK (safety IN ('none', 'observation', 'incident')),
  safety_note varchar(1000) NOT NULL DEFAULT '',
  forecast varchar(8) NOT NULL DEFAULT 'none' CHECK (forecast IN ('none', 'watch', 'blocked')),
  impact varchar(1000) NOT NULL DEFAULT '',
  recovery_owner_id uuid,
  recovery_on date,
  no_work_reason varchar(500) NOT NULL DEFAULT '',
  notes varchar(4000) NOT NULL DEFAULT '',
  submitted_at timestamptz,
  decided_by uuid REFERENCES users (id),
  decided_at timestamptz,
  decision_note varchar(500) NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, project_id, report_date, author_id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects (workspace_id, id),
  FOREIGN KEY (workspace_id, recovery_owner_id) REFERENCES workspace_memberships (workspace_id, id),
  CHECK (safety = 'none' OR length(btrim(safety_note)) > 0),
  CHECK (forecast = 'none' OR (recovery_owner_id IS NOT NULL AND recovery_on IS NOT NULL AND length(btrim(impact)) > 0)),
  CHECK (status IN ('draft') OR submitted_at IS NOT NULL),
  CHECK (status NOT IN ('approved', 'returned') OR (decided_by IS NOT NULL AND decided_by <> author_id)),
  CHECK (status <> 'returned' OR length(btrim(decision_note)) > 0)
);
--> statement-breakpoint
CREATE INDEX site_reports_project_idx ON site_reports (workspace_id, project_id, report_date DESC);
--> statement-breakpoint
CREATE TABLE site_report_workforce (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  report_id uuid NOT NULL,
  trade varchar(80) NOT NULL CHECK (length(btrim(trade)) > 0),
  people integer NOT NULL CHECK (people > 0 AND people <= 1000),
  FOREIGN KEY (workspace_id, report_id) REFERENCES site_reports (workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
-- What was installed against the scope (negative: a correction of an earlier approved report, with why).
CREATE TABLE site_report_lines (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  report_id uuid NOT NULL,
  boq_line_id uuid NOT NULL,
  installed numeric(18, 4) NOT NULL CHECK (installed <> 0),
  note varchar(500) NOT NULL DEFAULT '',
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, report_id) REFERENCES site_reports (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, boq_line_id) REFERENCES project_boq_lines (workspace_id, id),
  CHECK (installed > 0 OR length(btrim(note)) > 0)
);
--> statement-breakpoint
CREATE TABLE site_report_photos (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  report_id uuid NOT NULL,
  original_name varchar(255) NOT NULL DEFAULT '',
  mime_type varchar(100) NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size > 0),
  object_key varchar(500) NOT NULL,
  preview_key varchar(500),
  sha256 char(64) NOT NULL,
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, report_id) REFERENCES site_reports (workspace_id, id)
);
--> statement-breakpoint
ALTER TABLE stock_movements ADD COLUMN site_report_line_id uuid;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['site_reports', 'site_report_workforce', 'site_report_lines', 'site_report_photos'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($policy$CREATE POLICY tenant_isolation ON %I
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$, t);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON site_reports, site_report_workforce, site_report_lines TO wodana_app;
    GRANT SELECT, INSERT, DELETE ON site_report_photos TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('site.report_waiting', 'in_app', 'Site report to approve · {{title}}', '{{actor}} reported {{note}}.', '["title", "clientName", "actor", "note"]'),
  ('site.report_returned', 'in_app', 'Your site report came back · {{title}}', '{{actor}}: {{note}}', '["title", "clientName", "actor", "note"]'),
  ('site.incident', 'in_app', 'Incident on site · {{title}}', '{{actor}}: {{note}}', '["title", "clientName", "actor", "note"]'),
  ('site.incident', 'email', 'Incident on site · {{title}}', E'{{actor}} reported an incident on {{title}}:\n\n{{note}}', '["title", "clientName", "actor", "note"]'),
  ('site.blocked', 'in_app', 'The site is blocked · {{title}}', '{{actor}}: {{note}}', '["title", "clientName", "actor", "note"]'),
  ('site.report_missing', 'in_app', 'No site report today · {{title}}', 'Add today''s report before the end of the day.', '["title", "clientName", "actor", "note"]'),
  ('site.report_overdue', 'in_app', 'No site report yesterday · {{title}}', '{{note}}', '["title", "clientName", "actor", "note"]')
) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
