-- Team calendars (PLM-090, PLM-091), the recurring client update call (PLM-046) and the areas each enquiry-type
-- path uses after Won (PLM-098).
--
-- 1. workspace_design_settings.render_days / drawing_days: the days a 3D render or a set of 2D drawings needs by default
--    when a designer books it (configuration).
-- 2. design_work_bookings: render or 2D time a designer books on a case, tagged to the person who does it (the
--    Visualiser or the technical team). Its work item is a CRM task owned by that person; the overdue alert is sent once
--    per due day (overdue_notified_on). Idempotent per command_id.
-- 3. workspace_team_calendars: the Google calendar a team calendar is pushed to (configuration, optional; without it
--    everything stays in Wodana). team_calendar_pushes: which entry went to which Google event, so a moved entry updates
--    its event and a removed one cancels it.
-- 4. client_update_calls: one per case, the Account Manager's recurring client update call (weekly by default; off when
--    declined). The booked call is a CRM call activity with its appointment; the next one is booked when it is done or
--    its day passes.
-- 5. crm_flow_won_areas: per flow (enquiry type) and furniture path, the areas a job uses after Won (planning,
--    production, supply, delivery). A flow without rows uses every area, so nothing changes for existing workspaces.
-- 6. The notice templates for every workspace.
-- Workspace-scoped tables use forced RLS and a tenant_isolation policy. Nothing is backfilled. Idempotent; never
-- disables RLS.
ALTER TABLE workspace_design_settings
  ADD COLUMN IF NOT EXISTS render_days smallint NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS drawing_days smallint NOT NULL DEFAULT 3;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_design_settings_render_days_check') THEN
    ALTER TABLE workspace_design_settings ADD CONSTRAINT workspace_design_settings_render_days_check CHECK (render_days BETWEEN 1 AND 60);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_design_settings_drawing_days_check') THEN
    ALTER TABLE workspace_design_settings ADD CONSTRAINT workspace_design_settings_drawing_days_check CHECK (drawing_days BETWEEN 1 AND 60);
  END IF;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS design_work_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  case_id uuid NOT NULL,
  kind varchar(12) NOT NULL CHECK (kind IN ('render', 'drawing')),
  note varchar(500) NOT NULL DEFAULT '',
  assignee_membership_id uuid NOT NULL REFERENCES workspace_memberships (id),
  starts_on date NOT NULL,
  days smallint NOT NULL CHECK (days BETWEEN 1 AND 60),
  due_on date NOT NULL,
  status varchar(12) NOT NULL DEFAULT 'booked' CHECK (status IN ('booked', 'done', 'cancelled')),
  activity_id uuid REFERENCES crm_activities (id) ON DELETE SET NULL,
  command_id uuid NOT NULL,
  booked_by uuid NOT NULL REFERENCES users (id),
  booked_at timestamptz NOT NULL DEFAULT now(),
  done_by uuid REFERENCES users (id),
  done_at timestamptz,
  cancelled_by uuid REFERENCES users (id),
  cancelled_at timestamptz,
  -- The due day the designer and the case owner last heard it was overdue (once per due day).
  overdue_notified_on date,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, command_id),
  FOREIGN KEY (workspace_id, case_id) REFERENCES pre_project_cases (workspace_id, id) ON DELETE CASCADE,
  CHECK (due_on >= starts_on),
  CHECK ((status = 'done') = (done_at IS NOT NULL)),
  CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS design_work_bookings_range_idx ON design_work_bookings (workspace_id, starts_on, due_on) WHERE status <> 'cancelled';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS design_work_bookings_case_idx ON design_work_bookings (workspace_id, case_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS workspace_team_calendars (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  team varchar(20) NOT NULL CHECK (team IN ('design', 'logistics')),
  connection_id uuid REFERENCES integration_connections (id) ON DELETE SET NULL,
  calendar_id varchar(500),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid REFERENCES users (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, team)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS team_calendar_pushes (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  team varchar(20) NOT NULL CHECK (team IN ('design', 'logistics')),
  connection_id uuid NOT NULL,
  calendar_id varchar(500) NOT NULL,
  entry_key varchar(120) NOT NULL,
  event_id varchar(200) NOT NULL,
  etag varchar(500) NOT NULL,
  fingerprint varchar(64) NOT NULL,
  starts_on date NOT NULL,
  pushed_by uuid REFERENCES users (id),
  pushed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, team, connection_id, calendar_id, entry_key)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS client_update_calls (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  case_id uuid NOT NULL,
  frequency varchar(12) NOT NULL DEFAULT 'weekly' CHECK (frequency IN ('weekly', 'fortnightly', 'monthly', 'off')),
  owner_membership_id uuid REFERENCES workspace_memberships (id),
  started_from varchar(20) NOT NULL CHECK (started_from IN ('design_approval', 'estimate_accepted', 'manual')),
  next_activity_id uuid REFERENCES crm_activities (id) ON DELETE SET NULL,
  next_on date,
  calls_booked integer NOT NULL DEFAULT 0 CHECK (calls_booked >= 0),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, case_id),
  FOREIGN KEY (workspace_id, case_id) REFERENCES pre_project_cases (workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS crm_flow_won_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  flow_id uuid NOT NULL,
  furniture_path varchar(30) CHECK (furniture_path IS NULL OR furniture_path IN ('take_home_now', 'in_stock_delivery', 'supplier_order', 'core_collection_factory', 'bespoke')),
  areas text[] NOT NULL CHECK (areas <@ ARRAY['planning', 'production', 'supply', 'delivery']::text[]),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, flow_id) REFERENCES crm_flows (workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS crm_flow_won_areas_uidx ON crm_flow_won_areas (workspace_id, flow_id, coalesce(furniture_path, ''));
--> statement-breakpoint
DO $$
DECLARE target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['design_work_bookings', 'workspace_team_calendars', 'team_calendar_pushes', 'client_update_calls', 'crm_flow_won_areas'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', target);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = target AND policyname = 'tenant_isolation') THEN
      EXECUTE format($policy$CREATE POLICY tenant_isolation ON %I
        USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
        WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$, target);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON design_work_bookings, workspace_team_calendars, team_calendar_pushes, client_update_calls, crm_flow_won_areas TO wodana_app;
    GRANT DELETE ON team_calendar_pushes, crm_flow_won_areas TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('design.work_booked', 'in_app', '{{kind}} booked · {{clientName}}', '{{actor}} booked {{days}} from {{date}}, due {{due}}. {{note}}', '["kind","clientName","actor","date","due","days","note"]'),
  ('design.work_booked', 'email', '{{kind}} booked: {{clientName}}', E'{{actor}} booked {{kind}} for {{clientName}}: {{days}} from {{date}}, due {{due}}.\n\n{{note}}', '["kind","clientName","actor","date","due","days","note"]'),
  ('design.work_overdue', 'in_app', '{{kind}} is overdue · {{clientName}}', '{{person}} was due to finish it {{due}}.', '["kind","clientName","person","due"]'),
  ('design.work_overdue', 'email', '{{kind}} is overdue: {{clientName}}', E'{{kind}} for {{clientName}} was due {{due}} ({{person}}).\n\nOpen the design calendar to catch up or move it.', '["kind","clientName","person","due"]'),
  ('logistics.overdue', 'in_app', '{{what}} is overdue · {{project}}', 'It was due {{due}}.', '["what","project","due"]'),
  ('logistics.overdue', 'email', '{{what}} is overdue: {{project}}', E'{{what}} for {{project}} was due {{due}}.\n\nOpen the logistics calendar to catch up or move it.', '["what","project","due"]'),
  ('client_calls.booked', 'in_app', 'Client update calls · {{clientName}}', '{{frequency}}, the first on {{when}}. Change or turn them off on the case.', '["clientName","frequency","when"]'),
  ('client_calls.booked', 'email', 'Client update calls booked: {{clientName}}', E'Client update calls with {{clientName}} are booked in your calendar: {{frequency}}, the first on {{when}}.\n\nChange how often, or turn them off, on the case.', '["clientName","frequency","when"]')
) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
