-- Production status and schedule, delivery and installation, the designer kept informed, and sample requests
-- (PLM-055, PLM-061, PLM-063, PLM-069).
--
-- 1. workspace_factory_settings.production_steps: the steps a project's production status reads as (configuration).
--    Each step is a fixed kind read from the work orders (scheduled, in_production, quality_check, ready) with the
--    firm's own word for it; production_weeks: the firm's internal target for a project's production, in weeks.
-- 2. workspace_project_settings.keep_informed: the project roles told at key moments (technical drawings started,
--    production started, installation scheduled), by role key (configuration).
-- 3. delivery_projects.delivery_on / installation_on: the booked delivery day and the scheduled installation day,
--    with a note, who set them and when. Delivery and installation status are read from the records.
-- 4. project_material_items.team_note: product details for the technical team. Internal: it isn't part of what the
--    client signs, so adding it never undoes a sign-off.
-- 5. sample_requests: a sample the design team asks the factory for (a veneer control sample), with the day it is
--    needed (before the material selection appointment when one is booked); the factory marks it ready.
--    Workspace-scoped, forced RLS, tenant_isolation.
-- 6. The notice templates for every workspace.
-- Nothing is backfilled. Idempotent; never disables RLS.
ALTER TABLE workspace_factory_settings
  ADD COLUMN IF NOT EXISTS production_steps jsonb NOT NULL
    DEFAULT '[{"kind": "scheduled", "label": ""}, {"kind": "in_production", "label": ""}, {"kind": "quality_check", "label": ""}, {"kind": "ready", "label": ""}]'::jsonb,
  ADD COLUMN IF NOT EXISTS production_weeks smallint;
--> statement-breakpoint
ALTER TABLE workspace_project_settings ADD COLUMN IF NOT EXISTS keep_informed jsonb NOT NULL
  DEFAULT '{"drawings_started": ["designer"], "production_started": ["designer"], "installation_scheduled": ["designer"]}'::jsonb;
--> statement-breakpoint
ALTER TABLE delivery_projects
  ADD COLUMN IF NOT EXISTS delivery_on date,
  ADD COLUMN IF NOT EXISTS installation_on date,
  ADD COLUMN IF NOT EXISTS installation_note varchar(500) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS installation_set_by uuid REFERENCES users (id),
  ADD COLUMN IF NOT EXISTS installation_set_at timestamptz;
--> statement-breakpoint
ALTER TABLE project_material_items
  ADD COLUMN IF NOT EXISTS team_note varchar(2000) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS team_note_by uuid REFERENCES users (id),
  ADD COLUMN IF NOT EXISTS team_note_at timestamptz;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_factory_settings_production_steps_check') THEN
    ALTER TABLE workspace_factory_settings ADD CONSTRAINT workspace_factory_settings_production_steps_check CHECK (jsonb_typeof(production_steps) = 'array');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_factory_settings_production_weeks_check') THEN
    ALTER TABLE workspace_factory_settings ADD CONSTRAINT workspace_factory_settings_production_weeks_check CHECK (production_weeks IS NULL OR production_weeks BETWEEN 1 AND 52);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_project_settings_keep_informed_check') THEN
    ALTER TABLE workspace_project_settings ADD CONSTRAINT workspace_project_settings_keep_informed_check CHECK (jsonb_typeof(keep_informed) = 'object');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'delivery_projects_installation_dates_check') THEN
    ALTER TABLE delivery_projects ADD CONSTRAINT delivery_projects_installation_dates_check CHECK (delivery_on IS NULL OR installation_on IS NULL OR delivery_on <= installation_on);
  END IF;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS sample_requests (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  case_id uuid NOT NULL,
  number integer NOT NULL CHECK (number > 0),
  title varchar(200) NOT NULL CHECK (length(btrim(title)) > 0),
  note varchar(1000) NOT NULL DEFAULT '',
  due_on date NOT NULL,
  status varchar(12) NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'ready', 'cancelled')),
  requested_by uuid NOT NULL REFERENCES users (id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  ready_note varchar(500) NOT NULL DEFAULT '',
  ready_by uuid REFERENCES users (id),
  ready_at timestamptz,
  cancel_reason varchar(500) NOT NULL DEFAULT '',
  cancelled_by uuid REFERENCES users (id),
  cancelled_at timestamptz,
  -- The day the factory last heard it is due and not ready (once a day at most).
  due_notified_on date,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, number),
  FOREIGN KEY (workspace_id, case_id) REFERENCES pre_project_cases (workspace_id, id) ON DELETE CASCADE,
  CHECK ((status = 'ready') = (ready_at IS NOT NULL)),
  CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sample_requests_case_idx ON sample_requests (workspace_id, case_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sample_requests_open_idx ON sample_requests (workspace_id, due_on) WHERE status = 'requested';
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE sample_requests ENABLE ROW LEVEL SECURITY;
  ALTER TABLE sample_requests FORCE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sample_requests' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON sample_requests
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON sample_requests TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('project.drawings_started', 'in_app', 'Technical drawings started · {{title}}', 'The technical team started the drawings. Add any product details they need to the material list.', '["title","clientName","actor","date","note"]'),
  ('project.drawings_started', 'email', 'Technical drawings started: {{title}}', E'The technical team started the drawings for {{clientName}}.\n\nAdd any product details they need to the material list.', '["title","clientName","actor","date","note"]'),
  ('project.production_started', 'in_app', 'Production started · {{title}}', '{{actor}} started production on {{date}}.', '["title","clientName","actor","date","note"]'),
  ('project.production_started', 'email', 'Production started: {{title}}', E'{{actor}} started production for {{clientName}} on {{date}}.', '["title","clientName","actor","date","note"]'),
  ('project.installation_scheduled', 'in_app', 'Installation on {{date}} · {{title}}', '{{actor}} scheduled the installation for {{date}}. {{note}}', '["title","clientName","actor","date","note"]'),
  ('project.installation_scheduled', 'email', 'Installation on {{date}}: {{title}}', E'{{actor}} scheduled the installation for {{clientName}} on {{date}}.\n\n{{note}}', '["title","clientName","actor","date","note"]'),
  ('project.material_details', 'in_app', 'Product details for {{item}} · {{title}}', '{{actor}}: {{note}}', '["title","clientName","actor","item","note"]'),
  ('factory.sample_requested', 'in_app', 'Sample requested · {{sample}}', '{{actor}} needs it by {{date}} for {{project}}. {{note}}', '["sample","project","date","actor","note"]'),
  ('factory.sample_requested', 'email', 'Sample requested: {{sample}}', E'{{actor}} asked the factory for {{sample}} for {{project}}, needed by {{date}}.\n\n{{note}}', '["sample","project","date","actor","note"]'),
  ('factory.sample_ready', 'in_app', '{{sample}} is ready', '{{actor}} marked it ready for {{project}}. {{note}}', '["sample","project","date","actor","note"]'),
  ('factory.sample_ready', 'email', '{{sample}} is ready', E'{{actor}} marked {{sample}} for {{project}} ready.\n\n{{note}}', '["sample","project","date","actor","note"]'),
  ('factory.sample_due', 'in_app', '{{sample}} is due {{date}}', '{{project}}: it isn''t ready yet.', '["sample","project","date","actor","note"]')
) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
