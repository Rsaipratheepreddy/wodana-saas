-- HRMS H1: works on day one. Calendars can be edited (sessions and leave keep the snapshot they were
-- made with), holidays are named ranges on a calendar, leave types can be unlimited or unpaid, and
-- people are told about leave and attendance decisions.
ALTER TABLE hrms_calendars
  ADD COLUMN version integer NOT NULL DEFAULT 1,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
--> statement-breakpoint
DROP TRIGGER hrms_calendar_immutable ON hrms_calendars;
--> statement-breakpoint
CREATE TABLE hrms_holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  calendar_id uuid NOT NULL,
  name varchar(120) NOT NULL CONSTRAINT hrms_holidays_name_check CHECK (length(btrim(name)) > 0),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hrms_holidays_range_check CHECK (ends_on >= starts_on AND ends_on - starts_on <= 30),
  CONSTRAINT hrms_holidays_calendar_fkey FOREIGN KEY (workspace_id, calendar_id) REFERENCES hrms_calendars(workspace_id, id)
);
--> statement-breakpoint
CREATE INDEX hrms_holidays_calendar_idx ON hrms_holidays (workspace_id, calendar_id, starts_on);
--> statement-breakpoint
ALTER TABLE hrms_holidays ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE hrms_holidays FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON hrms_holidays
  USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON hrms_holidays TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
-- A calendar's list of days off is kept by the database from its named holidays, in the same transaction.
CREATE FUNCTION sync_hrms_calendar_holidays() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE target uuid;
BEGIN
  FOREACH target IN ARRAY (CASE
    WHEN TG_OP = 'DELETE' THEN ARRAY[OLD.calendar_id]
    WHEN TG_OP = 'UPDATE' AND NEW.calendar_id <> OLD.calendar_id THEN ARRAY[OLD.calendar_id, NEW.calendar_id]
    ELSE ARRAY[NEW.calendar_id] END) LOOP
    UPDATE hrms_calendars calendar
       SET holidays = coalesce((SELECT array_agg(DISTINCT day::date ORDER BY day::date)
                                  FROM hrms_holidays holiday
                                  CROSS JOIN LATERAL generate_series(holiday.starts_on, holiday.ends_on, interval '1 day') day
                                 WHERE holiday.calendar_id = target), '{}'::date[]),
           updated_at = now()
     WHERE calendar.id = target;
  END LOOP;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE FUNCTION guard_hrms_holiday_overlap() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('hrms-holidays:' || NEW.calendar_id::text, 0));
  IF EXISTS (SELECT 1 FROM hrms_holidays other
              WHERE other.workspace_id = NEW.workspace_id AND other.calendar_id = NEW.calendar_id AND other.id <> NEW.id
                AND other.starts_on <= NEW.ends_on AND other.ends_on >= NEW.starts_on) THEN
    RAISE EXCEPTION 'Holidays on one calendar cannot overlap' USING ERRCODE = '23P01';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER hrms_holidays_no_overlap BEFORE INSERT OR UPDATE ON hrms_holidays
  FOR EACH ROW EXECUTE FUNCTION guard_hrms_holiday_overlap();
--> statement-breakpoint
CREATE TRIGGER hrms_holidays_sync AFTER INSERT OR UPDATE OR DELETE ON hrms_holidays
  FOR EACH ROW EXECUTE FUNCTION sync_hrms_calendar_holidays();
--> statement-breakpoint
-- Days off already on a calendar become one-day holidays.
INSERT INTO hrms_holidays (workspace_id, calendar_id, name, starts_on, ends_on)
SELECT calendar.workspace_id, calendar.id, 'Holiday', day, day
  FROM hrms_calendars calendar CROSS JOIN LATERAL unnest(calendar.holidays) day;
--> statement-breakpoint
-- Calendars stay (sessions, leave and plans refer to them), and their days off come only from named holidays.
CREATE FUNCTION guard_hrms_calendar() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Work calendars are kept once made' USING ERRCODE = '23514';
  END IF;
  IF pg_trigger_depth() < 2 AND ((TG_OP = 'INSERT' AND cardinality(NEW.holidays) > 0)
      OR (TG_OP = 'UPDATE' AND NEW.holidays IS DISTINCT FROM OLD.holidays)) THEN
    RAISE EXCEPTION 'A calendar''s days off come from its named holidays' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER hrms_calendar_guard BEFORE INSERT OR UPDATE OR DELETE ON hrms_calendars
  FOR EACH ROW EXECUTE FUNCTION guard_hrms_calendar();
--> statement-breakpoint
ALTER TABLE hrms_leave_types
  ADD COLUMN limited boolean NOT NULL DEFAULT true,
  ADD COLUMN paid boolean NOT NULL DEFAULT true;
--> statement-breakpoint
-- The reminder run also looks at workspaces where someone is still checked in.
CREATE OR REPLACE FUNCTION list_reminder_workspaces() RETURNS TABLE(workspace_id uuid)
  LANGUAGE sql SECURITY DEFINER
  SET search_path TO 'public', 'pg_temp'
  AS $$
  SELECT project.workspace_id FROM delivery_projects project
  UNION
  SELECT commercial.workspace_id FROM commercial_cases commercial
  UNION
  SELECT journey.workspace_id FROM design_journeys journey
  UNION
  SELECT session.workspace_id FROM hrms_sessions session WHERE session.ended_at IS NULL;
$$;
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body,
       '["person", "leaveType", "dates", "days", "note", "actor", "when", "place"]'::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('hrms.leave_requested', 'in_app', 'Leave to approve: {{person}}', '{{leaveType}} · {{dates}} ({{days}}): {{note}}'),
  ('hrms.leave_requested', 'email', 'Leave to approve: {{person}}', E'{{person}} asked for {{leaveType}}: {{dates}} ({{days}}).\n\n{{note}}'),
  ('hrms.leave_cancellation_requested', 'in_app', 'Leave cancellation to approve: {{person}}', '{{leaveType}} · {{dates}}: {{note}}'),
  ('hrms.leave_approved', 'in_app', 'Leave approved: {{dates}}', '{{actor}} approved your {{leaveType}}.'),
  ('hrms.leave_approved', 'email', 'Leave approved: {{dates}}', E'{{actor}} approved your {{leaveType}}: {{dates}} ({{days}}).\n\n{{note}}'),
  ('hrms.leave_rejected', 'in_app', 'Leave not approved: {{dates}}', '{{actor}}: {{note}}'),
  ('hrms.leave_rejected', 'email', 'Leave not approved: {{dates}}', E'{{actor}} didn''t approve your {{leaveType}}: {{dates}}.\n\n{{note}}'),
  ('hrms.leave_cancelled', 'in_app', 'Leave cancelled: {{dates}}', '{{actor}} agreed to cancel your {{leaveType}}.'),
  ('hrms.leave_cancellation_refused', 'in_app', 'Leave stays booked: {{dates}}', '{{actor}}: {{note}}'),
  ('hrms.leave_holiday', 'in_app', 'Leave changed: {{dates}}', '{{note}} is now a holiday and no longer counts as leave. This request now counts {{days}}.'),
  ('hrms.attendance_to_review', 'in_app', 'Attendance to review: {{person}}', '{{when}}: {{note}}'),
  ('hrms.attendance_approved', 'in_app', 'Attendance approved: {{when}}', '{{actor}}: {{note}}'),
  ('hrms.attendance_rejected', 'in_app', 'Attendance not approved: {{when}}', '{{actor}}: {{note}}'),
  ('hrms.checkout_missing', 'in_app', 'You''re still checked in', 'Checked in at {{place}} since {{when}}. Check out, or ask for a correction.'),
  ('hrms.checkout_missing', 'email', 'You''re still checked in', E'You checked in at {{place}} at {{when}} and haven''t checked out.\n\nCheck out now, or ask for a correction with the time you left.')
) AS template (code, channel, subject, body)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
