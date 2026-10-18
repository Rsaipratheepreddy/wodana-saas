-- HRMS H2: crews and workers without logins. A supervisor marks a crew's day at a project's site (or
-- the workshop) with one group photo and the phone's position; someone else approves it, the day rate
-- of each worker is fixed then, and the day's cost goes to the project.
CREATE TABLE hrms_crews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  name varchar(120) NOT NULL CONSTRAINT hrms_crews_name_check CHECK (length(btrim(name)) > 0),
  trade varchar(80) NOT NULL CONSTRAINT hrms_crews_trade_check CHECK (length(btrim(trade)) > 0),
  vendor_id uuid,
  lead_membership_id uuid,
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hrms_crews_workspace_id_id_key UNIQUE (workspace_id, id),
  CONSTRAINT hrms_crews_vendor_fkey FOREIGN KEY (workspace_id, vendor_id) REFERENCES workspace_vendors(workspace_id, id),
  CONSTRAINT hrms_crews_lead_fkey FOREIGN KEY (workspace_id, lead_membership_id) REFERENCES workspace_memberships(workspace_id, id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX hrms_crews_name_key ON hrms_crews (workspace_id, lower(name));
--> statement-breakpoint
CREATE TABLE hrms_workers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  crew_id uuid,
  name varchar(120) NOT NULL CONSTRAINT hrms_workers_name_check CHECK (length(btrim(name)) > 0),
  trade varchar(80) NOT NULL CONSTRAINT hrms_workers_trade_check CHECK (length(btrim(trade)) > 0),
  worker_code varchar(40) NOT NULL DEFAULT '',
  phone varchar(40) NOT NULL DEFAULT '',
  day_rate numeric(18, 4) CONSTRAINT hrms_workers_rate_check CHECK (day_rate >= 0),
  currency char(3) CONSTRAINT hrms_workers_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hrms_workers_rate_currency_check CHECK ((day_rate IS NULL) = (currency IS NULL)),
  CONSTRAINT hrms_workers_workspace_id_id_key UNIQUE (workspace_id, id),
  CONSTRAINT hrms_workers_crew_fkey FOREIGN KEY (workspace_id, crew_id) REFERENCES hrms_crews(workspace_id, id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX hrms_workers_code_key ON hrms_workers (workspace_id, lower(worker_code)) WHERE worker_code <> '';
--> statement-breakpoint
CREATE INDEX hrms_workers_crew_idx ON hrms_workers (workspace_id, crew_id);
--> statement-breakpoint
CREATE TABLE hrms_crew_days (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  crew_id uuid NOT NULL,
  project_id uuid,
  work_date date NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'draft' CONSTRAINT hrms_crew_days_status_check CHECK (status IN ('draft', 'submitted', 'approved', 'returned')),
  marked_by uuid NOT NULL REFERENCES users(id),
  marked_membership_id uuid NOT NULL,
  capture_id uuid,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  note text NOT NULL DEFAULT '',
  exception_reason text NOT NULL DEFAULT '',
  submitted_at timestamptz,
  decided_by uuid REFERENCES users(id),
  decided_at timestamptz,
  decision_note text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hrms_crew_days_workspace_id_id_key UNIQUE (workspace_id, id),
  CONSTRAINT hrms_crew_days_crew_fkey FOREIGN KEY (workspace_id, crew_id) REFERENCES hrms_crews(workspace_id, id),
  CONSTRAINT hrms_crew_days_project_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects(workspace_id, id),
  CONSTRAINT hrms_crew_days_capture_fkey FOREIGN KEY (workspace_id, marked_membership_id, capture_id) REFERENCES hrms_captures(workspace_id, membership_id, id),
  -- Someone other than the person who marked the day approves it.
  CONSTRAINT hrms_crew_days_separation_check CHECK (decided_by IS NULL OR decided_by <> marked_by),
  CONSTRAINT hrms_crew_days_decided_check CHECK ((status IN ('approved', 'returned')) = (decided_by IS NOT NULL))
);
--> statement-breakpoint
-- One sheet per crew, day and place.
CREATE UNIQUE INDEX hrms_crew_days_key ON hrms_crew_days (workspace_id, crew_id, work_date, coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid));
--> statement-breakpoint
CREATE UNIQUE INDEX hrms_crew_days_capture_key ON hrms_crew_days (capture_id) WHERE capture_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX hrms_crew_days_project_idx ON hrms_crew_days (workspace_id, project_id, work_date);
--> statement-breakpoint
CREATE TABLE hrms_crew_day_workers (
  workspace_id uuid NOT NULL,
  crew_day_id uuid NOT NULL,
  worker_id uuid NOT NULL,
  presence varchar(12) NOT NULL CONSTRAINT hrms_crew_day_workers_presence_check CHECK (presence IN ('present', 'half_day', 'absent')),
  overtime_hours numeric(5, 2) NOT NULL DEFAULT 0 CONSTRAINT hrms_crew_day_workers_overtime_check CHECK (overtime_hours >= 0 AND overtime_hours <= 16),
  -- Fixed when the day is approved: the worker's own rate, else their trade's rate on that day.
  day_rate numeric(18, 4),
  currency char(3),
  PRIMARY KEY (workspace_id, crew_day_id, worker_id),
  CONSTRAINT hrms_crew_day_workers_day_fkey FOREIGN KEY (workspace_id, crew_day_id) REFERENCES hrms_crew_days(workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT hrms_crew_day_workers_worker_fkey FOREIGN KEY (workspace_id, worker_id) REFERENCES hrms_workers(workspace_id, id),
  CONSTRAINT hrms_crew_day_workers_rate_currency_check CHECK ((day_rate IS NULL) = (currency IS NULL))
);
--> statement-breakpoint
CREATE INDEX hrms_crew_day_workers_worker_idx ON hrms_crew_day_workers (workspace_id, worker_id);
--> statement-breakpoint
-- An approved day is a record: it and its people no longer change.
CREATE FUNCTION guard_hrms_crew_day() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'hrms_crew_days' THEN
    IF OLD.status = 'approved' THEN
      RAISE EXCEPTION 'An approved crew day cannot change' USING ERRCODE = '23514';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF EXISTS (SELECT 1 FROM hrms_crew_days day WHERE day.workspace_id = OLD.workspace_id AND day.id = OLD.crew_day_id AND day.status = 'approved')
     AND pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'An approved crew day cannot change' USING ERRCODE = '23514';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
--> statement-breakpoint
CREATE TRIGGER hrms_crew_days_frozen BEFORE UPDATE OR DELETE ON hrms_crew_days
  FOR EACH ROW EXECUTE FUNCTION guard_hrms_crew_day();
--> statement-breakpoint
CREATE TRIGGER hrms_crew_day_workers_frozen BEFORE UPDATE OR DELETE ON hrms_crew_day_workers
  FOR EACH ROW EXECUTE FUNCTION guard_hrms_crew_day();
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['hrms_crews', 'hrms_workers', 'hrms_crew_days', 'hrms_crew_day_workers'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($policy$CREATE POLICY tenant_isolation ON %I
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$, t);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON hrms_crews, hrms_workers, hrms_crew_days TO wodana_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON hrms_crew_day_workers TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, 'in_app', 'en', 1, 'approved', template.subject, template.body,
       '["person", "leaveType", "dates", "days", "note", "actor", "when", "place"]'::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('hrms.crew_day_submitted', 'Crew day to approve: {{person}}', '{{actor}} marked {{days}} at {{place}} on {{dates}}. {{note}}'),
  ('hrms.crew_day_approved', 'Crew day approved: {{person}}', '{{actor}} approved {{dates}} at {{place}}.'),
  ('hrms.crew_day_returned', 'Crew day sent back: {{person}}', '{{actor}}: {{note}}')
) AS template (code, subject, body)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
