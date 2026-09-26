-- Projects core. A project starts only from an accepted quotation once the firm's start rules pass.
-- At start the accepted scope is sealed (immutable, fingerprinted), the team is named by role, and
-- the stages are copied from the chosen stage template. The old project_execution document is not
-- used by these records.

-- Start rules, project numbering and the roles a project team has (configuration).
CREATE TABLE workspace_project_settings (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  require_agreement boolean NOT NULL DEFAULT true,
  require_payment boolean NOT NULL DEFAULT true,
  require_approval boolean NOT NULL DEFAULT false,
  reference_prefix varchar(12) NOT NULL DEFAULT 'PRJ' CHECK (reference_prefix ~ '^[A-Z][A-Z0-9]{0,11}$'),
  roles jsonb NOT NULL DEFAULT '[
    {"key":"project_manager","label":"Project manager"},
    {"key":"account_manager","label":"Account manager"},
    {"key":"designer","label":"Designer"},
    {"key":"technical_designer","label":"Technical designer"},
    {"key":"quantity_surveyor","label":"Quantity surveyor"},
    {"key":"procurement","label":"Procurement"},
    {"key":"site_supervisor","label":"Site supervisor"},
    {"key":"factory_lead","label":"Factory lead"},
    {"key":"installation_lead","label":"Installation lead"}
  ]'::jsonb CHECK (jsonb_typeof(roles) = 'array'),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE project_reference_counters (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  last_value bigint NOT NULL CHECK (last_value > 0)
);
--> statement-breakpoint
-- Stage templates: the firm's project routes (design + fit-out, furniture only, …).
CREATE TABLE project_templates (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name varchar(120) NOT NULL CHECK (length(btrim(name)) > 0),
  is_default boolean NOT NULL DEFAULT false,
  status varchar(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  CHECK (status = 'active' OR NOT is_default)
);
--> statement-breakpoint
CREATE UNIQUE INDEX project_templates_one_default ON project_templates (workspace_id) WHERE is_default;
--> statement-breakpoint
CREATE UNIQUE INDEX project_templates_name_key ON project_templates (workspace_id, lower(name)) WHERE status = 'active';
--> statement-breakpoint
-- Each stage: who owns it and what must be true to finish it (configuration: [{key, kind, label?, role?}]).
CREATE TABLE project_template_stages (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  template_id uuid NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  key varchar(64) NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{0,63}$'),
  name varchar(120) NOT NULL CHECK (length(btrim(name)) > 0),
  owner_role varchar(64),
  checks jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(checks) = 'array'),
  UNIQUE (template_id, key),
  UNIQUE (template_id, position),
  FOREIGN KEY (workspace_id, template_id) REFERENCES project_templates (workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
-- The project itself keeps the existing identity table (bookings, attendance and locations point at it).
ALTER TABLE delivery_projects DROP CONSTRAINT delivery_projects_status_check;
--> statement-breakpoint
ALTER TABLE delivery_projects
  ADD COLUMN reference varchar(24),
  ADD COLUMN quote_id text,
  ADD COLUMN template_id uuid,
  ADD COLUMN template_name varchar(120),
  ADD COLUMN priority varchar(10) NOT NULL DEFAULT 'normal',
  ADD COLUMN health varchar(10) NOT NULL DEFAULT 'on_track',
  ADD COLUMN start_date date,
  ADD COLUMN promise_date date,
  ADD COLUMN currency char(3),
  ADD COLUMN started_at timestamptz,
  ADD COLUMN started_by uuid,
  ADD COLUMN hold_reason varchar(500),
  ADD COLUMN hold_review_on date,
  ADD COLUMN held_at timestamptz,
  ADD COLUMN held_by uuid,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT delivery_projects_status_check CHECK (status IN ('active', 'on_hold', 'completed', 'cancelled', 'archived')),
  ADD CONSTRAINT delivery_projects_priority_check CHECK (priority IN ('normal', 'high', 'critical')),
  ADD CONSTRAINT delivery_projects_health_check CHECK (health IN ('on_track', 'at_risk', 'off_track')),
  ADD CONSTRAINT delivery_projects_hold_check CHECK (
    (status = 'on_hold' AND hold_reason IS NOT NULL AND length(btrim(hold_reason)) > 0 AND held_at IS NOT NULL AND held_by IS NOT NULL)
    OR (status <> 'on_hold' AND hold_reason IS NULL AND held_at IS NULL AND held_by IS NULL AND hold_review_on IS NULL)),
  ADD CONSTRAINT delivery_projects_started_check CHECK ((started_at IS NULL) = (quote_id IS NULL) AND (started_at IS NULL) = (reference IS NULL)),
  ADD CONSTRAINT delivery_projects_dates_check CHECK (promise_date IS NULL OR start_date IS NULL OR promise_date >= start_date),
  ADD CONSTRAINT delivery_projects_quote_fkey FOREIGN KEY (workspace_id, case_id, quote_id) REFERENCES commercial_quotes (workspace_id, case_id, id),
  ADD CONSTRAINT delivery_projects_template_fkey FOREIGN KEY (workspace_id, template_id) REFERENCES project_templates (workspace_id, id);
--> statement-breakpoint
CREATE UNIQUE INDEX delivery_projects_reference_key ON delivery_projects (workspace_id, reference) WHERE reference IS NOT NULL;
--> statement-breakpoint
-- One team model: the existing assignments carry the roles each person holds on the project.
ALTER TABLE project_assignments ADD COLUMN role_keys varchar(64)[] NOT NULL DEFAULT '{}';
--> statement-breakpoint
-- The sealed scope: what the client accepted, frozen and fingerprinted. It never changes; a change is a variation.
CREATE TABLE project_scope_seals (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  kind varchar(10) NOT NULL DEFAULT 'baseline' CHECK (kind IN ('baseline', 'variation')),
  quote_id text NOT NULL,
  quote_number integer NOT NULL,
  revision_label varchar(20) NOT NULL,
  quote_hash varchar(128) NOT NULL,
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  content_hash char(64) NOT NULL,
  currency char(3) NOT NULL,
  total numeric(18, 4) NOT NULL,
  accepted_at timestamptz NOT NULL,
  accepted_by_name varchar(200) NOT NULL,
  acceptance_method varchar(20),
  recorded_by_name varchar(200),
  agreement_reference varchar(200),
  sealed_at timestamptz NOT NULL DEFAULT now(),
  sealed_by uuid NOT NULL,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, project_id, quote_id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects (workspace_id, id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX project_scope_seals_one_baseline ON project_scope_seals (workspace_id, project_id) WHERE kind = 'baseline';
--> statement-breakpoint
CREATE FUNCTION project_scope_seals_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'A sealed scope cannot be changed. Record a variation instead.';
END $$;
--> statement-breakpoint
CREATE TRIGGER project_scope_seals_no_update BEFORE UPDATE ON project_scope_seals
FOR EACH ROW EXECUTE FUNCTION project_scope_seals_immutable();
--> statement-breakpoint
-- The project's stages, copied from its template at start (the checks are frozen with them).
CREATE TABLE project_stages (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  key varchar(64) NOT NULL,
  name varchar(120) NOT NULL,
  owner_role varchar(64),
  checks jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(checks) = 'array'),
  status varchar(10) NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'current', 'done', 'skipped')),
  started_at timestamptz,
  completed_at timestamptz,
  completed_by uuid,
  skip_reason varchar(500),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, project_id, key),
  UNIQUE (workspace_id, project_id, position),
  FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects (workspace_id, id),
  CHECK ((status = 'skipped') = (skip_reason IS NOT NULL)),
  CHECK (status NOT IN ('done', 'skipped') OR (completed_at IS NOT NULL AND completed_by IS NOT NULL)),
  CHECK (status <> 'current' OR started_at IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX project_stages_one_current ON project_stages (workspace_id, project_id) WHERE status = 'current';
--> statement-breakpoint
-- A person confirming a check that isn't read from data (e.g. "Kickoff meeting held").
CREATE TABLE project_stage_confirmations (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  stage_id uuid NOT NULL,
  check_key varchar(64) NOT NULL,
  note varchar(1000) NOT NULL DEFAULT '',
  confirmed_by uuid NOT NULL,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, stage_id, check_key),
  FOREIGN KEY (workspace_id, stage_id) REFERENCES project_stages (workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
-- The lead's status updates: health plus one line. The latest one is the project's health.
CREATE TABLE project_status_updates (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  health varchar(10) NOT NULL CHECK (health IN ('on_track', 'at_risk', 'off_track')),
  note varchar(2000) NOT NULL DEFAULT '',
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects (workspace_id, id)
);
--> statement-breakpoint
CREATE INDEX project_status_updates_project_idx ON project_status_updates (workspace_id, project_id, created_at DESC);
--> statement-breakpoint
DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['workspace_project_settings', 'project_reference_counters', 'project_templates', 'project_template_stages',
    'project_scope_seals', 'project_stages', 'project_stage_confirmations', 'project_status_updates'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', name);
    EXECUTE format($policy$CREATE POLICY tenant_isolation ON %I
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$, name);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON workspace_project_settings, project_reference_counters, project_templates, project_template_stages,
      project_stages, project_stage_confirmations, project_status_updates TO wodana_app;
    GRANT SELECT, INSERT ON project_scope_seals TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
-- Project notifications.
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('project.started', 'in_app', 'Project started · {{title}}', '{{actor}} started {{title}} for {{clientName}}.', '["title", "clientName", "actor", "role"]'),
  ('project.started', 'email', 'You''re on the team for {{title}}', E'{{actor}} started {{title}} for {{clientName}}. You''re the {{role}}.', '["title", "clientName", "actor", "role"]'),
  ('project.team_added', 'in_app', 'You''re the {{role}} on {{title}}', '{{actor}} added you to {{title}}.', '["title", "clientName", "actor", "role"]'),
  ('project.team_added', 'email', 'You''re the {{role}} on {{title}}', E'{{actor}} added you to {{title}} for {{clientName}} as the {{role}}.', '["title", "clientName", "actor", "role"]'),
  ('project.stage_done', 'in_app', '{{title}} moved to {{stage}}', '{{actor}} finished {{previous}}.', '["title", "clientName", "actor", "stage", "previous"]'),
  ('project.on_hold', 'in_app', '{{title}} is on hold', '{{actor}}: {{note}}', '["title", "clientName", "actor", "note"]'),
  ('project.resumed', 'in_app', '{{title}} is running again', '{{actor}} resumed the project.', '["title", "clientName", "actor", "note"]'),
  ('project.off_track', 'in_app', '{{title}} is off track', '{{actor}}: {{note}}', '["title", "clientName", "actor", "note"]')
) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
