-- Design flow after Won (PLM-049/050/051/053/128) and the site & materials steps of furniture/joinery
-- orders (PLM-044/080/081). Plan §6.7a batch 1.
--   * Settings (tenant configuration, frozen on each journey when it starts): the internal and client-facing
--     design deadlines, the material-selection week, the estimate week after approval, the role that renders,
--     and the site-visit question list the designer answers on every visit (PLM-128; Katy's list replaces the
--     default per workspace).
--   * Stages: a client-facing deadline next to the internal one (PLM-049), and the daily reminder until the
--     material-selection appointment is booked (PLM-050).
--   * Journeys: the design approval's date, signer and attachment and the estimate timer it starts (PLM-053).
--   * design_site_visit_answers: one answer per question per case (PLM-128); completion needs every one.
--   * The showroom appointment (PLM-050) is booked on the firm's booking slot engine: the booking type is configuration.
--   * design_presentations + design_presentation_options: a stage's client presentation (a round) with its options as
--     files (a design deliverable) or links (Canva); the client picks one in the portal; rounds beyond the package's
--     included revisions are chargeable (PLM-049/051).
--   * The design approval keeps who signed, and the Proposal 2 estimate it handed off to (PLM-053).
-- Idempotent; never disables RLS.
ALTER TABLE workspace_design_settings
  ADD COLUMN IF NOT EXISTS design_internal_days integer NOT NULL DEFAULT 35,
  ADD COLUMN IF NOT EXISTS design_client_days integer NOT NULL DEFAULT 56,
  ADD COLUMN IF NOT EXISTS material_selection_days integer NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS estimate_days integer NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS visualiser_role_code varchar(60) NOT NULL DEFAULT 'visualiser',
  ADD COLUMN IF NOT EXISTS showroom_booking_type_id uuid REFERENCES booking_types (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS site_visit_questions jsonb NOT NULL DEFAULT '[
    {"key": "access", "question": "How do we get in: access, parking and delivery route?"},
    {"key": "services", "question": "Where are the electrical, water and drainage points?"},
    {"key": "ceiling", "question": "Ceiling heights and any beams, bulkheads or AC units?"},
    {"key": "floors", "question": "Floor levels, finishes and anything to protect or remove?"},
    {"key": "existing", "question": "What stays, what goes, and what is the client keeping?"},
    {"key": "constraints", "question": "Building rules, working hours and permits to respect?"},
    {"key": "wishes", "question": "Anything the client asked for on site that is not in the brief?"}
  ]'::jsonb;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE workspace_design_settings
    ADD CONSTRAINT workspace_design_settings_design_days_check CHECK (design_internal_days BETWEEN 1 AND 365 AND design_client_days BETWEEN design_internal_days AND 365),
    ADD CONSTRAINT workspace_design_settings_material_days_check CHECK (material_selection_days BETWEEN 1 AND 90),
    ADD CONSTRAINT workspace_design_settings_estimate_days_check CHECK (estimate_days BETWEEN 1 AND 90),
    ADD CONSTRAINT workspace_design_settings_questions_check CHECK (jsonb_typeof(site_visit_questions) = 'array');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
ALTER TABLE design_journeys
  ADD COLUMN IF NOT EXISTS design_internal_days integer NOT NULL DEFAULT 35,
  ADD COLUMN IF NOT EXISTS design_client_days integer NOT NULL DEFAULT 56,
  ADD COLUMN IF NOT EXISTS material_selection_days integer NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS estimate_days integer NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS site_visit_questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS approved_on date,
  ADD COLUMN IF NOT EXISTS approval_asset_id uuid REFERENCES pre_project_brief_assets (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS estimate_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS estimate_overdue_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS approval_signer varchar(200),
  ADD COLUMN IF NOT EXISTS approval_method varchar(20) CHECK (approval_method IS NULL OR approval_method IN ('portal', 'signed_document', 'email', 'in_person', 'message')),
  ADD COLUMN IF NOT EXISTS estimate_quote_id text,
  ADD COLUMN IF NOT EXISTS estimate_linked_at timestamptz;
--> statement-breakpoint
ALTER TABLE design_journey_stages
  ADD COLUMN IF NOT EXISTS client_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS booking_reminder_at timestamptz;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS design_journey_stages_booking_idx ON design_journey_stages (workspace_id, booking_reminder_at) WHERE status = 'active' AND booking_reminder_at IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS design_journeys_estimate_idx ON design_journeys (workspace_id, estimate_due_at) WHERE estimate_due_at IS NOT NULL AND estimate_overdue_notified_at IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS design_site_visit_answers (
  workspace_id uuid NOT NULL,
  case_id uuid NOT NULL,
  question_key varchar(60) NOT NULL,
  question text NOT NULL,
  answer text NOT NULL CHECK (length(trim(answer)) > 0 AND length(answer) <= 2000),
  answered_by uuid NOT NULL,
  answered_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  PRIMARY KEY (workspace_id, case_id, question_key),
  FOREIGN KEY (workspace_id, case_id) REFERENCES design_journeys (workspace_id, case_id) ON DELETE CASCADE
);
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE design_site_visit_answers ENABLE ROW LEVEL SECURITY;
  ALTER TABLE design_site_visit_answers FORCE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'design_site_visit_answers' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON design_site_visit_answers
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON design_site_visit_answers TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS design_presentations (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  case_id uuid NOT NULL,
  stage varchar(30) NOT NULL CHECK (stage IN ('concepts', 'space_planning', 'material_selection', 'renders')),
  round integer NOT NULL CHECK (round BETWEEN 1 AND 99),
  status varchar(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'presented', 'chosen', 'changes_requested', 'withdrawn')),
  -- A round beyond the package's included revisions: the extra-revision fee is agreed with Sales first.
  chargeable boolean NOT NULL DEFAULT false,
  presented_at timestamptz,
  presented_by uuid,
  chosen_option_id uuid,
  decided_at timestamptz,
  decided_by_user_id uuid,
  decided_by_grant_id uuid,
  decided_by_name varchar(200),
  decision_source varchar(20) CHECK (decision_source IS NULL OR decision_source IN ('portal', 'meeting', 'whatsapp', 'email', 'phone')),
  decision_note text CHECK (decision_note IS NULL OR length(decision_note) <= 2000),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, case_id, stage, round),
  FOREIGN KEY (workspace_id, case_id) REFERENCES design_journeys (workspace_id, case_id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, case_id, decided_by_grant_id) REFERENCES client_portal_grants (workspace_id, case_id, id),
  CHECK (status NOT IN ('chosen', 'changes_requested') OR (decided_at IS NOT NULL AND decided_by_name IS NOT NULL AND decision_source IS NOT NULL)),
  CHECK (status <> 'chosen' OR chosen_option_id IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS design_presentation_options (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  case_id uuid NOT NULL,
  presentation_id uuid NOT NULL,
  position integer NOT NULL DEFAULT 0,
  title varchar(240) NOT NULL CHECK (length(trim(title)) > 0),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
  -- An uploaded design (its latest revision is what the client sees) or a link (a Canva board).
  design_id uuid REFERENCES pre_project_designs (id) ON DELETE RESTRICT,
  link_url varchar(2000) CHECK (link_url IS NULL OR link_url ~ '^https://'),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, presentation_id) REFERENCES design_presentations (workspace_id, id) ON DELETE CASCADE,
  CHECK ((design_id IS NULL) <> (link_url IS NULL))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS design_presentations_case_idx ON design_presentations (workspace_id, case_id, stage, round DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS design_presentation_options_idx ON design_presentation_options (workspace_id, presentation_id, position);
--> statement-breakpoint
DO $$
DECLARE target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['design_presentations', 'design_presentation_options'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', target);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = target AND policyname = 'tenant_isolation') THEN
      EXECUTE format($policy$CREATE POLICY tenant_isolation ON %I
        USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
        WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$, target);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON design_presentations TO wodana_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON design_presentation_options TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('design.material_selection_unbooked', 'in_app', 'Book the material selection · {{clientName}}', 'The showroom appointment is not booked yet. Material selection is due {{due}}.', '["clientName","due"]'),
  ('design.material_selection_booked', 'in_app', 'Material selection with {{clientName}}', '{{when}} · {{place}}. Booked by {{bookedBy}}.', '["clientName","when","place","bookedBy"]'),
  ('design.material_selection_booked', 'email', 'Invitation: material selection with {{clientName}}', E'Material selection with {{clientName}}\n\nWhen: {{when}}\nWhere: {{place}}\nBooked by: {{bookedBy}}\n\nAttach the material list to the project after the appointment.', '["clientName","when","place","bookedBy"]'),
  ('design.extra_revision', 'in_app', 'Extra revision on {{stage}} · {{clientName}}', 'Revision {{round}} of {{title}} goes beyond the {{included}} included. It is chargeable.', '["stage","clientName","round","included","title"]'),
  ('design.site_measured', 'in_app', 'Site measured · {{clientName}}', 'Measurements and photos are in. {{summary}}', '["clientName","summary"]'),
  ('design.site_measured', 'email', 'Site measured: {{clientName}}', E'The site visit for {{clientName}} is recorded with its measurements and photos.\n\n{{summary}}\n\nOpen the case to price it.', '["clientName","summary"]'),
  ('design.estimate_overdue', 'in_app', 'Estimate overdue · {{clientName}}', 'The design was approved {{approvedOn}}. The estimate was due {{due}}.', '["clientName","approvedOn","due"]'),
  ('design.estimate_overdue', 'email', 'Estimate overdue: {{clientName}}', E'{{clientName}} approved the design on {{approvedOn}}. The estimate was due {{due}} and has not been sent.\n\nOpen the case to send it.', '["clientName","approvedOn","due"]'),
  ('design.extra_revision', 'email', 'Chargeable revision: {{stage}} for {{clientName}}', E'Revision {{round}} of {{title}} goes beyond the {{included}} included in the package. Agree the extra-revision fee with {{clientName}} before the work starts.', '["stage","clientName","round","included","title"]'),
  ('design.concept_chosen', 'in_app', '{{clientName}} chose {{title}}', '{{stage}}: {{note}}', '["clientName","title","stage","note"]'),
  ('design.approved_estimate', 'in_app', 'Design approved · {{clientName}}', 'Approved {{approvedOn}}. Share the estimate by {{due}}.', '["clientName","approvedOn","due"]'),
  ('design.approved_estimate', 'email', 'Design approved: {{clientName}}', E'{{clientName}} approved the final design on {{approvedOn}}.\n\nThe estimate (Proposal 2) is due by {{due}}. Open the case to prepare it.', '["clientName","approvedOn","due"]')
) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
