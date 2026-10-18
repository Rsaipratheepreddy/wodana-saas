-- Employee attendance is independent of payroll and uses workspace membership.
CREATE UNIQUE INDEX IF NOT EXISTS workspace_memberships_workspace_id_id_key ON workspace_memberships(workspace_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS pre_project_cases_workspace_id_id_key ON pre_project_cases(workspace_id,id);
CREATE TABLE delivery_projects (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id),
 case_id uuid NOT NULL, name varchar(240) NOT NULL CHECK(length(trim(name))>0),
 status varchar(20) NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','archived')),
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 version integer NOT NULL DEFAULT 1, UNIQUE(workspace_id,id), UNIQUE(workspace_id,case_id),
 FOREIGN KEY(workspace_id,case_id) REFERENCES pre_project_cases(workspace_id,id)
);
CREATE TABLE project_assignments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id),
 project_id uuid, case_id uuid, membership_id uuid NOT NULL, is_manager boolean NOT NULL DEFAULT false,
 active boolean NOT NULL DEFAULT true, UNIQUE(workspace_id,id),
 CHECK(num_nonnulls(project_id,case_id)=1),
 FOREIGN KEY(workspace_id,project_id) REFERENCES delivery_projects(workspace_id,id),
 FOREIGN KEY(workspace_id,case_id) REFERENCES pre_project_cases(workspace_id,id),
 FOREIGN KEY(workspace_id,membership_id) REFERENCES workspace_memberships(workspace_id,id)
);
CREATE UNIQUE INDEX project_assignment_project_key ON project_assignments(workspace_id,project_id,membership_id) WHERE project_id IS NOT NULL;
CREATE UNIQUE INDEX project_assignment_case_key ON project_assignments(workspace_id,case_id,membership_id) WHERE case_id IS NOT NULL;
CREATE TABLE work_locations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id),
 name varchar(160) NOT NULL CHECK(length(trim(name))>0), kind varchar(16) NOT NULL CHECK(kind IN ('office','site')),
 project_id uuid, case_id uuid, address varchar(500) NOT NULL DEFAULT '',
 latitude double precision NOT NULL CHECK(latitude BETWEEN -90 AND 90), longitude double precision NOT NULL CHECK(longitude BETWEEN -180 AND 180),
 radius_m integer NOT NULL DEFAULT 150 CHECK(radius_m BETWEEN 25 AND 2000),
 active boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 1,
 UNIQUE(workspace_id,id),
 CHECK((kind='office' AND num_nonnulls(project_id,case_id)=0) OR (kind='site' AND num_nonnulls(project_id,case_id)=1)),
 FOREIGN KEY(workspace_id,project_id) REFERENCES delivery_projects(workspace_id,id),
 FOREIGN KEY(workspace_id,case_id) REFERENCES pre_project_cases(workspace_id,id)
);
--> statement-breakpoint
CREATE TABLE hrms_calendars (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id),
 name varchar(120) NOT NULL, timezone varchar(80) NOT NULL,
 working_days integer[] NOT NULL DEFAULT ARRAY[1,2,3,4,5], holidays date[] NOT NULL DEFAULT '{}',
 day_start time NOT NULL DEFAULT '09:00', half_day time NOT NULL DEFAULT '13:00', day_end time NOT NULL DEFAULT '18:00',
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id,id),
 CHECK(cardinality(working_days) BETWEEN 1 AND 7 AND working_days <@ ARRAY[0,1,2,3,4,5,6]),
 CHECK(day_start < half_day AND half_day < day_end)
);
CREATE TABLE hrms_settings (
 workspace_id uuid PRIMARY KEY REFERENCES workspaces(id), default_calendar_id uuid NOT NULL,
 fallback_approver_id uuid, max_gps_accuracy_m integer NOT NULL DEFAULT 100 CHECK(max_gps_accuracy_m BETWEEN 5 AND 500),
 max_capture_age_seconds integer NOT NULL DEFAULT 120 CHECK(max_capture_age_seconds BETWEEN 30 AND 600),
 media_retention_days integer NOT NULL DEFAULT 365 CHECK(media_retention_days BETWEEN 30 AND 3650),
 version integer NOT NULL DEFAULT 1,
 FOREIGN KEY(workspace_id,default_calendar_id) REFERENCES hrms_calendars(workspace_id,id),
 FOREIGN KEY(workspace_id,fallback_approver_id) REFERENCES workspace_memberships(workspace_id,id)
);
CREATE TABLE hrms_employees (
 workspace_id uuid NOT NULL REFERENCES workspaces(id), membership_id uuid NOT NULL,
 enabled boolean NOT NULL DEFAULT true, employee_code varchar(40) NOT NULL DEFAULT '',
 designation varchar(120) NOT NULL DEFAULT '', department varchar(120) NOT NULL DEFAULT '',
 manager_id uuid, calendar_id uuid NOT NULL, remote_allowed boolean NOT NULL DEFAULT false,
 active_from date NOT NULL DEFAULT CURRENT_DATE, active_to date, version integer NOT NULL DEFAULT 1,
 PRIMARY KEY(workspace_id,membership_id), CHECK(manager_id IS DISTINCT FROM membership_id), CHECK(active_to IS NULL OR active_to>=active_from),
 FOREIGN KEY(workspace_id,membership_id) REFERENCES workspace_memberships(workspace_id,id),
 FOREIGN KEY(workspace_id,manager_id) REFERENCES workspace_memberships(workspace_id,id),
 FOREIGN KEY(workspace_id,calendar_id) REFERENCES hrms_calendars(workspace_id,id)
);
CREATE UNIQUE INDEX hrms_employee_code_key ON hrms_employees(workspace_id,lower(employee_code)) WHERE employee_code<>'';
CREATE TABLE hrms_captures (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, membership_id uuid NOT NULL,
 issued_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours',
 object_key text UNIQUE, sha256 varchar(64), byte_size integer, photo_uploaded_at timestamptz,
 UNIQUE(workspace_id,id), UNIQUE(workspace_id,membership_id,id),
 FOREIGN KEY(workspace_id,membership_id) REFERENCES hrms_employees(workspace_id,membership_id)
);
CREATE TABLE hrms_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, membership_id uuid NOT NULL,
 started_at timestamptz NOT NULL, ended_at timestamptz, calendar_snapshot jsonb NOT NULL,
 version integer NOT NULL DEFAULT 1, UNIQUE(workspace_id,id), UNIQUE(workspace_id,membership_id,id),
 CHECK(ended_at IS NULL OR ended_at>started_at),
 FOREIGN KEY(workspace_id,membership_id) REFERENCES hrms_employees(workspace_id,membership_id)
);
CREATE UNIQUE INDEX hrms_one_open_session ON hrms_sessions(workspace_id,membership_id) WHERE ended_at IS NULL;
CREATE INDEX hrms_sessions_history_idx ON hrms_sessions(workspace_id,membership_id,started_at);
CREATE TABLE hrms_attendance_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, membership_id uuid NOT NULL, session_id uuid NOT NULL,
 action_id uuid NOT NULL, request_hash varchar(64) NOT NULL, capture_id uuid,
 kind varchar(20) NOT NULL CHECK(kind IN ('check_in','check_out','switch')),
 occurred_at timestamptz NOT NULL, device_at timestamptz NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
 evidence jsonb NOT NULL, note text NOT NULL DEFAULT '', recorded_by uuid NOT NULL REFERENCES users(id),
 UNIQUE(workspace_id,id), UNIQUE(workspace_id,membership_id,action_id), UNIQUE(capture_id),
 FOREIGN KEY(workspace_id,membership_id,session_id) REFERENCES hrms_sessions(workspace_id,membership_id,id),
 FOREIGN KEY(workspace_id,membership_id,capture_id) REFERENCES hrms_captures(workspace_id,membership_id,id)
);
CREATE TABLE hrms_segments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, session_id uuid NOT NULL,
 mode varchar(20) NOT NULL CHECK(mode IN ('office','site','field','remote')),
 location_id uuid, project_id uuid, case_id uuid, context_snapshot jsonb NOT NULL,
 started_at timestamptz NOT NULL, ended_at timestamptz, start_event_id uuid NOT NULL, end_event_id uuid,
 CHECK(ended_at IS NULL OR ended_at>started_at), CHECK(num_nonnulls(project_id,case_id)<=1),
 CHECK(mode<>'site' OR (location_id IS NOT NULL AND num_nonnulls(project_id,case_id)=1)),
 UNIQUE(workspace_id,id), FOREIGN KEY(workspace_id,session_id) REFERENCES hrms_sessions(workspace_id,id),
 FOREIGN KEY(workspace_id,location_id) REFERENCES work_locations(workspace_id,id),
 FOREIGN KEY(workspace_id,project_id) REFERENCES delivery_projects(workspace_id,id),
 FOREIGN KEY(workspace_id,case_id) REFERENCES pre_project_cases(workspace_id,id),
 FOREIGN KEY(workspace_id,start_event_id) REFERENCES hrms_attendance_events(workspace_id,id),
 FOREIGN KEY(workspace_id,end_event_id) REFERENCES hrms_attendance_events(workspace_id,id)
);
CREATE UNIQUE INDEX hrms_one_open_segment ON hrms_segments(session_id) WHERE ended_at IS NULL;
CREATE TABLE hrms_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, membership_id uuid NOT NULL, session_id uuid NOT NULL,
 action_id uuid NOT NULL, kind varchar(20) NOT NULL CHECK(kind IN ('exception','correction','missing_checkout')),
 event_id uuid, requested_at timestamptz, original_at timestamptz, reason text NOT NULL,
 status varchar(20) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','withdrawn')),
 decision_reason text, decided_by uuid REFERENCES users(id), decided_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,id), UNIQUE(workspace_id,membership_id,action_id),
 FOREIGN KEY(workspace_id,membership_id,session_id) REFERENCES hrms_sessions(workspace_id,membership_id,id),
 FOREIGN KEY(workspace_id,event_id) REFERENCES hrms_attendance_events(workspace_id,id)
);
CREATE TABLE hrms_leave_types (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id), name varchar(100) NOT NULL,
 annual_days numeric(6,1) NOT NULL CHECK(annual_days>=0 AND annual_days<=366), allow_half_day boolean NOT NULL DEFAULT true,
 active boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 1, UNIQUE(workspace_id,id), UNIQUE(workspace_id,name)
);
CREATE TABLE hrms_leave_allowances (
 workspace_id uuid NOT NULL, membership_id uuid NOT NULL, leave_type_id uuid NOT NULL, year integer NOT NULL CHECK(year BETWEEN 2000 AND 2200),
 days numeric(6,1) NOT NULL CHECK(days>=0 AND days<=366), version integer NOT NULL DEFAULT 1,
 PRIMARY KEY(workspace_id,membership_id,leave_type_id,year),
 FOREIGN KEY(workspace_id,membership_id) REFERENCES hrms_employees(workspace_id,membership_id),
 FOREIGN KEY(workspace_id,leave_type_id) REFERENCES hrms_leave_types(workspace_id,id)
);
CREATE TABLE hrms_leave_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, membership_id uuid NOT NULL, leave_type_id uuid NOT NULL,
 action_id uuid NOT NULL, request_hash varchar(64) NOT NULL, start_date date NOT NULL, end_date date NOT NULL,
 day_part varchar(16) NOT NULL CHECK(day_part IN ('full','first_half','second_half')),
 units jsonb NOT NULL, calendar_snapshot jsonb NOT NULL, reason text NOT NULL,
 status varchar(24) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','withdrawn','cancellation_pending','cancelled')),
 decided_by uuid REFERENCES users(id), decision_reason text, decided_at timestamptz, cancellation_reason text,
 created_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1,
 UNIQUE(workspace_id,id), UNIQUE(workspace_id,membership_id,action_id), CHECK(end_date>=start_date),
 FOREIGN KEY(workspace_id,membership_id) REFERENCES hrms_employees(workspace_id,membership_id),
 FOREIGN KEY(workspace_id,leave_type_id) REFERENCES hrms_leave_types(workspace_id,id)
);
CREATE INDEX hrms_leave_dates_idx ON hrms_leave_requests(workspace_id,membership_id,start_date,end_date);
--> statement-breakpoint
-- Serialize every attendance projection write, including administrative corrections.
CREATE FUNCTION guard_hrms_session_overlap() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.workspace_id::text || ':' || NEW.membership_id::text,0));
 IF EXISTS(SELECT 1 FROM hrms_sessions s WHERE s.workspace_id=NEW.workspace_id AND s.membership_id=NEW.membership_id AND s.id<>NEW.id
  AND tstzrange(s.started_at,s.ended_at,'[)') && tstzrange(NEW.started_at,NEW.ended_at,'[)')) THEN
  RAISE EXCEPTION 'Attendance sessions cannot overlap' USING ERRCODE='23514';
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER hrms_session_overlap BEFORE INSERT OR UPDATE ON hrms_sessions FOR EACH ROW EXECUTE FUNCTION guard_hrms_session_overlap();
CREATE FUNCTION immutable_hrms_record() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Original attendance evidence and calendars are immutable'; END $$;
CREATE TRIGGER hrms_evidence_immutable BEFORE UPDATE OR DELETE ON hrms_attendance_events FOR EACH ROW EXECUTE FUNCTION immutable_hrms_record();
CREATE TRIGGER hrms_calendar_immutable BEFORE UPDATE OR DELETE ON hrms_calendars FOR EACH ROW EXECUTE FUNCTION immutable_hrms_record();
--> statement-breakpoint
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['delivery_projects','project_assignments','work_locations','hrms_calendars','hrms_settings','hrms_employees','hrms_captures','hrms_sessions','hrms_attendance_events','hrms_segments','hrms_reviews','hrms_leave_types','hrms_leave_allowances','hrms_leave_requests'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_isolation ON %I USING(workspace_id=NULLIF(current_setting(''app.current_workspace_id'',true),'''')::uuid) WITH CHECK(workspace_id=NULLIF(current_setting(''app.current_workspace_id'',true),'''')::uuid)',t);
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='wodana_app') THEN EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO wodana_app',t); END IF;
 END LOOP;
END $$;
INSERT INTO permissions(code,description) VALUES
 ('hrms.self','Use own employee attendance, leave and history when enrolled'),
 ('hrms.team','Review attendance and leave for direct reports'),
 ('hrms.manage','Manage employee HRMS settings and organization attendance'),
 ('hrms.evidence','Read private attendance photos for authorized employee scope'),
 ('projects.view','View assigned delivery projects and site attendance'),
 ('projects.manage','Release delivery project identities and manage sites and assignments')
ON CONFLICT(code) DO NOTHING;
ALTER TABLE roles DISABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions DISABLE ROW LEVEL SECURITY;
INSERT INTO role_permissions(workspace_id,role_id,permission_id)
 SELECT r.workspace_id,r.id,p.id FROM roles r CROSS JOIN permissions p
 WHERE r.is_system AND r.code IN ('owner','administrator') AND (p.code LIKE 'hrms.%' OR p.code LIKE 'projects.%') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(workspace_id,role_id,permission_id)
 SELECT r.workspace_id,r.id,p.id FROM roles r CROSS JOIN permissions p
 WHERE r.is_system AND r.code='member' AND p.code IN ('hrms.self','projects.view') ON CONFLICT DO NOTHING;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY; ALTER TABLE roles FORCE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY; ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
