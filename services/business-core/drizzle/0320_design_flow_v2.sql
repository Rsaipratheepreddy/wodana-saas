-- The design journey after the design fee is paid, in the order of 13 Oct 2026 (PLM-140 to PLM-144, PLM-151, PLM-152).
--   * Two new steps: the kick-off meeting with the client (after inspiration) and samples (after the renders, or after
--     the concept when the package has no renders). Space planning folds into the concept for new journeys.
--   * design_journeys.flow_version: 2 for journeys started from now on; every journey that already exists stays 1 and
--     keeps its old order (nothing is migrated or moved).
--   * Timings (workspace configuration, frozen on each journey when it starts): the kick-off after inspiration, the
--     concept after the kick-off, the design site measure after the kick-off, the client-facing design development
--     window (a minimum, a maximum and the days per room between them), sample collection and the sample meeting,
--     and the design team allocation after the fee is paid.
--   * The render sign-off: the date agreed with the client at the kick-off, and the client's sign-off (date, signer,
--     file) that samples wait for.
--   * design_journey_tasks: work inside a step with its own owner, deadline and done-check (the design team allocation,
--     the design site measure inside the concept, the sample collection inside samples). The reminder engine and the
--     design calendar read them.
--   * Which team roles the design flow uses (project role keys, configuration with sensible defaults) and who tags the
--     Draftsman (a workspace role or team code).
-- Idempotent; never disables RLS.
ALTER TABLE design_journey_stages DROP CONSTRAINT IF EXISTS design_journey_stages_stage_check;
--> statement-breakpoint
ALTER TABLE design_journey_stages ADD CONSTRAINT design_journey_stages_stage_check
  CHECK (stage IN ('inspiration', 'kickoff', 'site_visit', 'concepts', 'space_planning', 'material_selection', 'renders', 'samples', 'approval'));
--> statement-breakpoint
ALTER TABLE workspace_design_settings
  ADD COLUMN IF NOT EXISTS allocation_days integer NOT NULL DEFAULT 1 CHECK (allocation_days BETWEEN 1 AND 30),
  ADD COLUMN IF NOT EXISTS kickoff_days integer NOT NULL DEFAULT 5 CHECK (kickoff_days BETWEEN 1 AND 60),
  ADD COLUMN IF NOT EXISTS concept_days integer NOT NULL DEFAULT 7 CHECK (concept_days BETWEEN 1 AND 90),
  ADD COLUMN IF NOT EXISTS site_measure_days integer NOT NULL DEFAULT 3 CHECK (site_measure_days BETWEEN 1 AND 30),
  ADD COLUMN IF NOT EXISTS development_min_days integer NOT NULL DEFAULT 14 CHECK (development_min_days BETWEEN 1 AND 365),
  ADD COLUMN IF NOT EXISTS development_max_days integer NOT NULL DEFAULT 56 CHECK (development_max_days BETWEEN 1 AND 365),
  ADD COLUMN IF NOT EXISTS development_days_per_room integer NOT NULL DEFAULT 7 CHECK (development_days_per_room BETWEEN 0 AND 90),
  ADD COLUMN IF NOT EXISTS sample_collection_days integer NOT NULL DEFAULT 7 CHECK (sample_collection_days BETWEEN 1 AND 60),
  ADD COLUMN IF NOT EXISTS sample_meeting_days integer NOT NULL DEFAULT 7 CHECK (sample_meeting_days BETWEEN 1 AND 60),
  ADD COLUMN IF NOT EXISTS concept_options_max integer CHECK (concept_options_max IS NULL OR concept_options_max BETWEEN 1 AND 12),
  ADD COLUMN IF NOT EXISTS lead_designer_role_key varchar(64) NOT NULL DEFAULT 'designer' CHECK (lead_designer_role_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  ADD COLUMN IF NOT EXISTS junior_designer_role_key varchar(64) DEFAULT 'junior_designer' CHECK (junior_designer_role_key IS NULL OR junior_designer_role_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  ADD COLUMN IF NOT EXISTS sales_admin_role_key varchar(64) DEFAULT 'sales_admin' CHECK (sales_admin_role_key IS NULL OR sales_admin_role_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  ADD COLUMN IF NOT EXISTS visualiser_role_key varchar(64) DEFAULT 'visualiser' CHECK (visualiser_role_key IS NULL OR visualiser_role_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  ADD COLUMN IF NOT EXISTS draftsman_role_key varchar(64) DEFAULT 'draftsman' CHECK (draftsman_role_key IS NULL OR draftsman_role_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  ADD COLUMN IF NOT EXISTS material_coordinator_role_key varchar(64) DEFAULT 'material_coordinator' CHECK (material_coordinator_role_key IS NULL OR material_coordinator_role_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  ADD COLUMN IF NOT EXISTS technical_lead_role_code varchar(64) DEFAULT 'technical_lead' CHECK (technical_lead_role_code IS NULL OR technical_lead_role_code ~ '^[a-z][a-z0-9_]{0,63}$');
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE workspace_design_settings ADD CONSTRAINT workspace_design_settings_development_check CHECK (development_max_days >= development_min_days);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
ALTER TABLE design_journeys
  ADD COLUMN IF NOT EXISTS flow_version smallint NOT NULL DEFAULT 1 CHECK (flow_version IN (1, 2)),
  ADD COLUMN IF NOT EXISTS kickoff_days integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS concept_days integer NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS site_measure_days integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS development_min_days integer NOT NULL DEFAULT 14,
  ADD COLUMN IF NOT EXISTS development_max_days integer NOT NULL DEFAULT 56,
  ADD COLUMN IF NOT EXISTS development_days_per_room integer NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS sample_collection_days integer NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS sample_meeting_days integer NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS concept_options_max integer CHECK (concept_options_max IS NULL OR concept_options_max BETWEEN 1 AND 12),
  ADD COLUMN IF NOT EXISTS render_signoff_due_on date,
  ADD COLUMN IF NOT EXISTS render_signed_on date,
  ADD COLUMN IF NOT EXISTS render_signoff_asset_id uuid REFERENCES pre_project_brief_assets (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS render_signoff_signer varchar(200),
  ADD COLUMN IF NOT EXISTS render_signoff_recorded_by uuid,
  ADD COLUMN IF NOT EXISTS render_signoff_recorded_at timestamptz;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE design_journeys ADD CONSTRAINT design_journeys_render_signoff_check
    CHECK (render_signed_on IS NULL OR (render_signoff_signer IS NOT NULL AND render_signoff_recorded_at IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS design_journey_tasks (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  case_id uuid NOT NULL,
  task varchar(30) NOT NULL CHECK (task IN ('team_allocation', 'site_measure', 'sample_collection')),
  stage varchar(30) NOT NULL,
  status varchar(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  owner_membership_id uuid REFERENCES workspace_memberships (id),
  activity_id uuid REFERENCES crm_activities (id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  due_at timestamptz,
  completed_at timestamptz,
  completed_by uuid,
  note text CHECK (note IS NULL OR length(note) <= 5000),
  overdue_notified_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (workspace_id, case_id, task),
  FOREIGN KEY (workspace_id, case_id) REFERENCES design_journeys (workspace_id, case_id) ON DELETE CASCADE,
  CHECK (status <> 'done' OR completed_at IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS design_journey_tasks_due_idx ON design_journey_tasks (workspace_id, due_at) WHERE status = 'open';
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE design_journey_tasks ENABLE ROW LEVEL SECURITY;
  ALTER TABLE design_journey_tasks FORCE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'design_journey_tasks' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON design_journey_tasks
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON design_journey_tasks TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO workspace_record_classification (table_name, disposition, clear_predicate, file_columns) VALUES
  ('design_journey_tasks', 'clear', NULL, '{}')
ON CONFLICT (table_name) DO UPDATE SET disposition = excluded.disposition,
  clear_predicate = excluded.clear_predicate, file_columns = excluded.file_columns;
--> statement-breakpoint
-- The notices of the new steps (notifications/default-templates.ts; new workspaces get them when created).
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('design.team_to_allocate', 'in_app', 'Allocate the design team · {{clientName}}', 'The design fee is paid. Choose the {{roles}} by {{due}}.', '["clientName","roles","due"]'),
  ('design.team_to_allocate', 'email', 'Allocate the design team: {{clientName}}', E'The design fee for {{clientName}} is paid.\n\nChoose the {{roles}} by {{due}} so the kick-off can be booked.', '["clientName","roles","due"]'),
  ('design.team_allocated', 'in_app', 'You''re on {{clientName}} as {{role}}', '{{actor}} added you to the design team. {{note}}', '["clientName","role","actor","note"]'),
  ('design.team_allocated', 'email', 'You''re on {{clientName}} as {{role}}', E'{{actor}} added you to the design team for {{clientName}} as {{role}}.\n\n{{note}}', '["clientName","role","actor","note"]'),
  ('design.kickoff_booked', 'in_app', 'Kick-off with {{clientName}}', '{{when}} · {{place}}. Booked by {{bookedBy}}.', '["clientName","when","place","bookedBy"]'),
  ('design.kickoff_booked', 'email', 'Invitation: kick-off with {{clientName}}', E'Kick-off meeting with {{clientName}}\n\nWhen: {{when}}\nWhere: {{place}}\nBooked by: {{bookedBy}}\n\nConfirm the brief and agree the render sign-off date with the client.', '["clientName","when","place","bookedBy"]'),
  ('design.site_measure_due', 'in_app', 'Design site measure · {{clientName}}', 'Measure every wall, take the photos and answer the site visit questions by {{due}}.', '["clientName","due"]'),
  ('design.site_measure_due', 'email', 'Design site measure: {{clientName}}', E'The kick-off with {{clientName}} is done.\n\nMeasure every wall, take the photos and answer the site visit questions by {{due}}. Whoever on the design team is free can do it.', '["clientName","due"]'),
  ('design.render_tagged', 'in_app', '{{role}} · {{clientName}}', '{{actor}} tagged you on the renders. The client signs them off by {{due}}.', '["clientName","role","actor","due"]'),
  ('design.render_tagged', 'email', 'Renders for {{clientName}}', E'{{actor}} tagged you on the renders for {{clientName}} as {{role}}.\n\nThe client signs them off by {{due}}. Book your render time in the design calendar.', '["clientName","role","actor","due"]'),
  ('design.render_signed_off', 'in_app', 'Renders signed off · {{clientName}}', 'Signed {{signedOn}} by {{signer}}. Samples start now.', '["clientName","signedOn","signer"]'),
  ('design.samples_to_collect', 'in_app', 'Collect the samples · {{clientName}}', 'Collect the samples for every room by {{due}}, from our own stock and brands first.', '["clientName","due"]'),
  ('design.samples_to_collect', 'email', 'Collect the samples: {{clientName}}', E'Samples for {{clientName}} start now.\n\nCollect the samples for every room by {{due}}, from our own stock and brands first. A material from a local supplier needs the reviewer''s sign-off.', '["clientName","due"]'),
  ('design.samples_collected', 'in_app', 'Samples collected · {{clientName}}', 'Book the sample meeting with the client. {{note}}', '["clientName","note"]'),
  ('design.sample_meeting_booked', 'in_app', 'Sample meeting with {{clientName}}', '{{when}} · {{place}}. Booked by {{bookedBy}}.', '["clientName","when","place","bookedBy"]'),
  ('design.sample_meeting_booked', 'email', 'Invitation: sample meeting with {{clientName}}', E'Sample meeting with {{clientName}}\n\nWhen: {{when}}\nWhere: {{place}}\nBooked by: {{bookedBy}}\n\nBring the printed renders and the samples for each room.', '["clientName","when","place","bookedBy"]'),
  ('design.sample_meeting_unbooked', 'in_app', 'Book the sample meeting · {{clientName}}', 'The sample meeting is not booked yet. Samples are due {{due}}.', '["clientName","due"]')
) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
