-- HRMS H4: studio timesheets. People log their hours per day against a project (and its stage) or
-- internal work; a week is submitted and approved by their manager, never by themself. Approved weeks
-- are a record.
CREATE TABLE hrms_timesheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  membership_id uuid NOT NULL,
  owner_user_id uuid NOT NULL REFERENCES users(id),
  week_start date NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'draft' CONSTRAINT hrms_timesheets_status_check CHECK (status IN ('draft', 'submitted', 'approved', 'returned')),
  submitted_at timestamptz,
  decided_by uuid REFERENCES users(id),
  decided_at timestamptz,
  decision_note text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hrms_timesheets_workspace_id_id_key UNIQUE (workspace_id, id),
  CONSTRAINT hrms_timesheets_week_key UNIQUE (workspace_id, membership_id, week_start),
  CONSTRAINT hrms_timesheets_member_fkey FOREIGN KEY (workspace_id, membership_id) REFERENCES hrms_employees(workspace_id, membership_id),
  -- Someone else approves a person's week.
  CONSTRAINT hrms_timesheets_separation_check CHECK (decided_by IS NULL OR decided_by <> owner_user_id),
  CONSTRAINT hrms_timesheets_decided_check CHECK ((status IN ('approved', 'returned')) = (decided_by IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE hrms_time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  timesheet_id uuid NOT NULL,
  work_date date NOT NULL,
  project_id uuid,
  stage_id uuid,
  minutes integer NOT NULL CONSTRAINT hrms_time_entries_minutes_check CHECK (minutes > 0 AND minutes <= 1440),
  note varchar(500) NOT NULL DEFAULT '',
  CONSTRAINT hrms_time_entries_timesheet_fkey FOREIGN KEY (workspace_id, timesheet_id) REFERENCES hrms_timesheets(workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT hrms_time_entries_project_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects(workspace_id, id),
  CONSTRAINT hrms_time_entries_stage_check CHECK (stage_id IS NULL OR project_id IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX hrms_time_entries_sheet_idx ON hrms_time_entries (workspace_id, timesheet_id, work_date);
--> statement-breakpoint
CREATE INDEX hrms_time_entries_project_idx ON hrms_time_entries (workspace_id, project_id, work_date) WHERE project_id IS NOT NULL;
--> statement-breakpoint
CREATE FUNCTION guard_hrms_timesheet() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE sheet uuid;
BEGIN
  IF TG_TABLE_NAME = 'hrms_timesheets' THEN
    IF OLD.status = 'approved' THEN
      RAISE EXCEPTION 'An approved timesheet cannot change' USING ERRCODE = '23514';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  sheet := CASE WHEN TG_OP = 'INSERT' THEN NEW.timesheet_id ELSE OLD.timesheet_id END;
  IF EXISTS (SELECT 1 FROM hrms_timesheets week WHERE week.id = sheet AND week.status IN ('submitted', 'approved')) THEN
    RAISE EXCEPTION 'Hours on a submitted or approved week cannot change' USING ERRCODE = '23514';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
--> statement-breakpoint
CREATE TRIGGER hrms_timesheets_frozen BEFORE UPDATE OR DELETE ON hrms_timesheets
  FOR EACH ROW EXECUTE FUNCTION guard_hrms_timesheet();
--> statement-breakpoint
CREATE TRIGGER hrms_time_entries_frozen BEFORE INSERT OR UPDATE OR DELETE ON hrms_time_entries
  FOR EACH ROW EXECUTE FUNCTION guard_hrms_timesheet();
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['hrms_timesheets', 'hrms_time_entries'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($policy$CREATE POLICY tenant_isolation ON %I
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$, t);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON hrms_timesheets TO wodana_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON hrms_time_entries TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, 'in_app', 'en', 1, 'approved', template.subject, template.body,
       '["person", "leaveType", "dates", "days", "note", "actor", "when", "place"]'::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('hrms.timesheet_submitted', 'Timesheet to approve: {{person}}', '{{dates}}: {{days}} logged.'),
  ('hrms.timesheet_approved', 'Timesheet approved: {{dates}}', '{{actor}} approved your week.'),
  ('hrms.timesheet_returned', 'Timesheet sent back: {{dates}}', '{{actor}}: {{note}}')
) AS template (code, subject, body)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
