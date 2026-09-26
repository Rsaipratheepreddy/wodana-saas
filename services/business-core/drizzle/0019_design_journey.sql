-- PLM-047/048 (and 049–053 next): the design journey of a case. Which stages apply comes from the
-- design package (space planning, renders); timings are workspace configuration. Each stage has an
-- owner, a deadline and an overdue alert that fires once.
ALTER TABLE workspace_design_settings
  ADD COLUMN inspiration_days integer NOT NULL DEFAULT 7 CHECK (inspiration_days BETWEEN 1 AND 60),
  ADD COLUMN site_visit_hours integer NOT NULL DEFAULT 72 CHECK (site_visit_hours BETWEEN 1 AND 720);
--> statement-breakpoint
CREATE TABLE design_journeys (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES pre_project_cases (id) ON DELETE CASCADE,
  package_id uuid REFERENCES design_packages (id),
  package_name varchar(120),
  included_revisions integer NOT NULL DEFAULT 2 CHECK (included_revisions BETWEEN 0 AND 20),
  includes_space_planning boolean NOT NULL DEFAULT false,
  includes_renders boolean NOT NULL DEFAULT false,
  reviewer_role_code varchar(60),
  inspiration_days integer NOT NULL DEFAULT 7,
  site_visit_hours integer NOT NULL DEFAULT 72,
  started_by uuid,
  started_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  PRIMARY KEY (workspace_id, case_id)
);
--> statement-breakpoint
CREATE TABLE design_journey_stages (
  workspace_id uuid NOT NULL,
  case_id uuid NOT NULL,
  stage varchar(30) NOT NULL CHECK (stage IN ('inspiration', 'site_visit', 'concepts', 'space_planning', 'material_selection', 'renders', 'approval')),
  position integer NOT NULL,
  status varchar(12) NOT NULL DEFAULT 'locked' CHECK (status IN ('locked', 'active', 'done')),
  owner_membership_id uuid REFERENCES workspace_memberships (id),
  activity_id uuid REFERENCES crm_activities (id) ON DELETE SET NULL,
  started_at timestamptz,
  due_at timestamptz,
  completed_at timestamptz,
  completed_by uuid,
  note text,
  overdue_notified_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  PRIMARY KEY (workspace_id, case_id, stage),
  FOREIGN KEY (workspace_id, case_id) REFERENCES design_journeys (workspace_id, case_id) ON DELETE CASCADE,
  CHECK (status <> 'done' OR completed_at IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX design_journey_stages_due_idx ON design_journey_stages (workspace_id, due_at) WHERE status = 'active' AND overdue_notified_at IS NULL;
--> statement-breakpoint
CREATE TABLE design_journey_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  case_id uuid NOT NULL,
  stage varchar(30) NOT NULL,
  action varchar(40) NOT NULL,
  note text,
  actor_user_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (workspace_id, case_id) REFERENCES design_journeys (workspace_id, case_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX design_journey_events_case_idx ON design_journey_events (workspace_id, case_id, occurred_at DESC);
--> statement-breakpoint
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['design_journeys', 'design_journey_stages', 'design_journey_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$p$, table_name);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO wodana_app', table_name);
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.list_reminder_workspaces() RETURNS TABLE(workspace_id uuid)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT project.workspace_id FROM delivery_projects project
  UNION
  SELECT commercial.workspace_id FROM commercial_cases commercial
  UNION
  SELECT journey.workspace_id FROM design_journeys journey;
$$;
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('design.stage_started', 'in_app', '{{stage}} · {{clientName}}', '{{stage}} has started. Due {{due}}.', '["stage","clientName","due"]'),
  ('design.stage_overdue', 'in_app', '{{stage}} is overdue · {{clientName}}', 'It was due {{due}}.', '["stage","clientName","due"]'),
  ('design.stage_overdue', 'email', '{{stage}} is overdue: {{clientName}}', E'{{stage}} for {{clientName}} was due {{due}}.\n\nOpen the project to catch up.', '["stage","clientName","due"]'),
  ('design.site_visit_booked', 'in_app', 'Site visit with {{clientName}}', '{{when}} · {{place}}. Booked by {{bookedBy}}.', '["clientName","when","place","bookedBy"]'),
  ('design.site_visit_booked', 'email', 'Invitation: site visit with {{clientName}}', E'Site visit with {{clientName}}\n\nWhen: {{when}}\nWhere: {{place}}\nBooked by: {{bookedBy}}\n\nRecord every wall''s measurements and photos in the project.', '["clientName","when","place","bookedBy"]')
) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
