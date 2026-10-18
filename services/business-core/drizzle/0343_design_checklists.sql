-- Design question lists with sections and checklists (Palm's discovery questions and joinery checklists).
--
-- 1. The question list (configuration JSON, unchanged column) may carry a `section` for the general questions and
--    `kind: "check"` for checklist lines. Each scope's match words live beside it in site_visit_scopes (settings) and
--    are frozen with the questions when a journey starts (design_journeys.site_visit_scopes).
-- 2. design_site_visit_answers: a checklist line is answered with a status (confirmed, pending, not applicable) and an
--    optional "Requirement or reference" note in `answer`; free-text answers are unchanged (no status, text required).
-- 3. design_checklist_choices: the designer's "Applies to this job" choice per scope on a job. Without a choice the
--    scope follows the matching. Business records of the job: workspace-scoped, forced RLS, tenant_isolation.
-- Idempotent; never disables RLS.
ALTER TABLE workspace_design_settings ADD COLUMN IF NOT EXISTS site_visit_scopes jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE design_journeys ADD COLUMN IF NOT EXISTS site_visit_scopes jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE design_site_visit_answers ADD COLUMN IF NOT EXISTS status varchar(20);
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE design_site_visit_answers DROP CONSTRAINT IF EXISTS design_site_visit_answers_answer_check;
  ALTER TABLE design_site_visit_answers ADD CONSTRAINT design_site_visit_answers_answer_check
    CHECK ((status IS NOT NULL OR length(trim(answer)) > 0) AND length(answer) <= 2000);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE design_site_visit_answers ADD CONSTRAINT design_site_visit_answers_status_check
    CHECK (status IS NULL OR status IN ('confirmed', 'pending', 'not_applicable'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS design_checklist_choices (
  workspace_id uuid NOT NULL,
  case_id uuid NOT NULL,
  scope_key varchar(60) NOT NULL CHECK (length(btrim(scope_key)) > 0),
  scope varchar(60) NOT NULL,
  applies boolean NOT NULL,
  chosen_by uuid NOT NULL REFERENCES users (id),
  chosen_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (workspace_id, case_id, scope_key),
  FOREIGN KEY (workspace_id, case_id) REFERENCES design_journeys (workspace_id, case_id) ON DELETE CASCADE
);
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE design_checklist_choices ENABLE ROW LEVEL SECURITY;
  ALTER TABLE design_checklist_choices FORCE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'design_checklist_choices' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON design_checklist_choices
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON design_checklist_choices TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO workspace_record_classification (table_name, disposition, clear_predicate, file_columns) VALUES
  ('design_checklist_choices', 'clear', NULL, '{}')
ON CONFLICT (table_name) DO UPDATE SET disposition = excluded.disposition,
  clear_predicate = excluded.clear_predicate, file_columns = excluded.file_columns;
