ALTER TABLE workspace_teams
  ADD CONSTRAINT workspace_teams_workspace_id_id UNIQUE(workspace_id,id);
--> statement-breakpoint
ALTER TABLE project_resources
  ADD COLUMN workspace_team_id uuid,
  ADD COLUMN capacity_mode varchar(16) NOT NULL DEFAULT 'exclusive',
  ADD COLUMN capacity numeric(10,3) NOT NULL DEFAULT 1,
  ADD COLUMN timezone varchar(64),
  ADD COLUMN version integer NOT NULL DEFAULT 1,
  ADD COLUMN updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT project_resources_workspace_team_fk
    FOREIGN KEY(workspace_id,workspace_team_id)
    REFERENCES workspace_teams(workspace_id,id) ON DELETE SET NULL,
  ADD CONSTRAINT project_resources_capacity_mode_check
    CHECK(capacity_mode IN ('exclusive','pooled')),
  ADD CONSTRAINT project_resources_capacity_check
    CHECK(capacity > 0 AND capacity <= 100000),
  ADD CONSTRAINT project_resources_kind_capacity_check
    CHECK(kind IN ('factory','vendor') OR (capacity_mode='exclusive' AND capacity=1)),
  ADD CONSTRAINT project_resources_version_check CHECK(version > 0);
--> statement-breakpoint
CREATE INDEX project_resources_team_idx
  ON project_resources(workspace_id,workspace_team_id)
  WHERE active;
CREATE INDEX project_resources_capacity_idx
  ON project_resources(workspace_id,business_unit_id,kind,active);
CREATE TRIGGER project_resources_workspace_team_guard
BEFORE INSERT OR UPDATE ON project_resources
FOR EACH ROW EXECUTE FUNCTION enforce_same_workspace_reference('workspace_teams','workspace_team_id');
CREATE TRIGGER project_resources_set_updated_at
BEFORE UPDATE ON project_resources
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
ALTER TABLE project_bookings DROP CONSTRAINT project_bookings_status_check;
DROP INDEX project_bookings_task;
ALTER TABLE project_bookings
  ADD COLUMN units numeric(10,3) NOT NULL DEFAULT 1,
  ADD COLUMN timezone varchar(64),
  ADD COLUMN calendar_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN version integer NOT NULL DEFAULT 1,
  ADD COLUMN request_id varchar(80),
  ADD COLUMN created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN cancellation_reason varchar(1000),
  ADD COLUMN confirmed_at timestamptz,
  ADD COLUMN completed_at timestamptz,
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT project_bookings_workspace_id UNIQUE(workspace_id,id),
  ADD CONSTRAINT project_bookings_status_check
    CHECK(status IN ('draft','tentative','confirmed','completed','cancelled')),
  ADD CONSTRAINT project_bookings_units_check CHECK(units > 0 AND units <= 100000),
  ADD CONSTRAINT project_bookings_version_check CHECK(version > 0),
  ADD CONSTRAINT project_bookings_calendar_snapshot_check
    CHECK(jsonb_typeof(calendar_snapshot)='object'),
  ADD CONSTRAINT project_bookings_request_id_check
    CHECK(request_id IS NULL OR request_id ~ '^[A-Za-z0-9_-]{16,80}$');
--> statement-breakpoint
UPDATE project_bookings booking
SET timezone=workspace.default_timezone,
    confirmed_at=CASE WHEN booking.status='confirmed' THEN now() ELSE NULL END,
    cancelled_at=CASE WHEN booking.status='cancelled' THEN now() ELSE NULL END,
    cancellation_reason=CASE WHEN booking.status='cancelled' THEN 'Imported historical cancellation' ELSE NULL END,
    calendar_snapshot=jsonb_build_object(
      'source','legacy',
      'timezone',workspace.default_timezone,
      'migratedAt',now()
    )
FROM workspaces workspace
WHERE workspace.id=booking.workspace_id;
ALTER TABLE project_bookings ALTER COLUMN timezone SET NOT NULL;
CREATE UNIQUE INDEX project_bookings_active_task_uidx
  ON project_bookings(workspace_id,project_id,task_id)
  WHERE status IN ('draft','tentative','confirmed');
CREATE UNIQUE INDEX project_bookings_request_uidx
  ON project_bookings(workspace_id,request_id)
  WHERE request_id IS NOT NULL;
CREATE INDEX project_bookings_resource_status_dates_idx
  ON project_bookings(workspace_id,resource_id,status,starts_on,ends_on);
CREATE INDEX project_bookings_members_idx
  ON project_bookings USING gin(member_ids);
CREATE TRIGGER project_bookings_set_updated_at
BEFORE UPDATE ON project_bookings
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TABLE project_booking_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL,
  project_id uuid NOT NULL,
  task_id varchar(80) NOT NULL,
  resource_id uuid NOT NULL,
  local_date date NOT NULL,
  end_date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  timezone varchar(64) NOT NULL,
  units numeric(10,3) NOT NULL DEFAULT 1,
  member_ids uuid[] NOT NULL DEFAULT '{}',
  calendar_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_booking_slots_workspace_id UNIQUE(workspace_id,id),
  CONSTRAINT project_booking_slots_booking_fk
    FOREIGN KEY(workspace_id,booking_id)
    REFERENCES project_bookings(workspace_id,id) ON DELETE CASCADE,
  CONSTRAINT project_booking_slots_project_fk
    FOREIGN KEY(workspace_id,project_id)
    REFERENCES delivery_projects(workspace_id,id) ON DELETE CASCADE,
  CONSTRAINT project_booking_slots_resource_fk
    FOREIGN KEY(workspace_id,resource_id)
    REFERENCES project_resources(workspace_id,id),
  CONSTRAINT project_booking_slots_dates_check CHECK(end_date >= local_date),
  CONSTRAINT project_booking_slots_instants_check CHECK(ends_at > starts_at),
  CONSTRAINT project_booking_slots_units_check CHECK(units > 0 AND units <= 100000),
  CONSTRAINT project_booking_slots_calendar_snapshot_check
    CHECK(jsonb_typeof(calendar_snapshot)='object'),
  CONSTRAINT project_booking_slots_unique
    UNIQUE(workspace_id,booking_id,local_date,start_time,end_date,end_time)
);
CREATE INDEX project_booking_slots_resource_time_idx
  ON project_booking_slots(workspace_id,resource_id,starts_at,ends_at);
CREATE INDEX project_booking_slots_project_time_idx
  ON project_booking_slots(workspace_id,project_id,starts_at,ends_at);
CREATE INDEX project_booking_slots_members_idx
  ON project_booking_slots USING gin(member_ids);
--> statement-breakpoint
WITH expanded AS (
  SELECT booking.workspace_id,booking.id AS booking_id,booking.project_id,booking.task_id,
         booking.resource_id,booking.units,booking.member_ids,booking.timezone,
         booking.calendar_snapshot,
         (slot.value->>'date')::date AS local_date,
         CASE
           WHEN slot.value->>'endTime'='24:00'
             OR slot.value->>'endTime' <= slot.value->>'startTime'
           THEN (slot.value->>'date')::date + 1
           ELSE (slot.value->>'date')::date
         END AS end_date,
         (slot.value->>'startTime')::time AS start_time,
         CASE WHEN slot.value->>'endTime'='24:00' THEN '00:00'::time
              ELSE (slot.value->>'endTime')::time END AS end_time
  FROM project_bookings booking
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(booking.slots)='array' THEN booking.slots ELSE '[]'::jsonb END
  ) slot(value)
  WHERE slot.value ? 'date' AND slot.value ? 'startTime' AND slot.value ? 'endTime'
), instants AS (
  SELECT expanded.*,
         (local_date::text||' '||start_time::text)::timestamp AT TIME ZONE timezone AS starts_at,
         (end_date::text||' '||end_time::text)::timestamp AT TIME ZONE timezone AS ends_at
  FROM expanded
)
INSERT INTO project_booking_slots(
  workspace_id,booking_id,project_id,task_id,resource_id,local_date,end_date,
  start_time,end_time,starts_at,ends_at,timezone,units,member_ids,calendar_snapshot
)
SELECT workspace_id,booking_id,project_id,task_id,resource_id,local_date,end_date,
       start_time,end_time,starts_at,ends_at,timezone,units,member_ids,calendar_snapshot
FROM instants
WHERE ends_at > starts_at
ON CONFLICT DO NOTHING;
--> statement-breakpoint
WITH legacy_days AS (
  SELECT booking.workspace_id,booking.id AS booking_id,booking.project_id,booking.task_id,
         booking.resource_id,booking.units,booking.member_ids,booking.timezone,
         booking.calendar_snapshot,day_value::date AS local_date
  FROM project_bookings booking
  CROSS JOIN LATERAL generate_series(booking.starts_on,booking.ends_on,'1 day'::interval) day_value
  WHERE NOT EXISTS(
    SELECT 1 FROM project_booking_slots slot
    WHERE slot.workspace_id=booking.workspace_id AND slot.booking_id=booking.id
  )
)
INSERT INTO project_booking_slots(
  workspace_id,booking_id,project_id,task_id,resource_id,local_date,end_date,
  start_time,end_time,starts_at,ends_at,timezone,units,member_ids,calendar_snapshot
)
SELECT workspace_id,booking_id,project_id,task_id,resource_id,local_date,local_date+1,
       '00:00'::time,'00:00'::time,
       local_date::timestamp AT TIME ZONE timezone,
       (local_date+1)::timestamp AT TIME ZONE timezone,
       timezone,units,member_ids,calendar_snapshot
FROM legacy_days;
--> statement-breakpoint
CREATE TABLE project_booking_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL,
  action varchar(32) NOT NULL,
  from_status varchar(16),
  to_status varchar(16) NOT NULL,
  reason varchar(1000) NOT NULL DEFAULT '',
  snapshot jsonb NOT NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  request_id varchar(80),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_booking_history_booking_fk
    FOREIGN KEY(workspace_id,booking_id)
    REFERENCES project_bookings(workspace_id,id) ON DELETE RESTRICT,
  CONSTRAINT project_booking_history_action_check
    CHECK(action IN ('migrated','created','status_changed','rescheduled','cancelled','completed')),
  CONSTRAINT project_booking_history_from_status_check
    CHECK(from_status IS NULL OR from_status IN ('draft','tentative','confirmed','completed','cancelled')),
  CONSTRAINT project_booking_history_to_status_check
    CHECK(to_status IN ('draft','tentative','confirmed','completed','cancelled')),
  CONSTRAINT project_booking_history_snapshot_check CHECK(jsonb_typeof(snapshot)='object'),
  CONSTRAINT project_booking_history_request_id_check
    CHECK(request_id IS NULL OR request_id ~ '^[A-Za-z0-9_-]{16,80}$')
);
CREATE INDEX project_booking_history_booking_idx
  ON project_booking_history(workspace_id,booking_id,occurred_at);
CREATE UNIQUE INDEX project_booking_history_request_uidx
  ON project_booking_history(workspace_id,request_id)
  WHERE request_id IS NOT NULL;
INSERT INTO project_booking_history(
  workspace_id,booking_id,action,from_status,to_status,reason,snapshot,occurred_at
)
SELECT workspace_id,id,'migrated',NULL,status,'Imported from the existing project booking model',
       jsonb_build_object(
         'projectId',project_id,'taskId',task_id,'resourceId',resource_id,
         'startsOn',starts_on,'endsOn',ends_on,'status',status,'units',units,
         'timezone',timezone,'memberIds',member_ids
       ),created_at
FROM project_bookings;
--> statement-breakpoint
CREATE FUNCTION project_booking_history_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'project_booking_history is append-only' USING ERRCODE='55000';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER project_booking_history_append_only
BEFORE UPDATE OR DELETE ON project_booking_history
FOR EACH ROW EXECUTE FUNCTION project_booking_history_append_only();
--> statement-breakpoint
DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['project_booking_slots','project_booking_history'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (workspace_id=NULLIF(current_setting(''app.current_workspace_id'',true),'''')::uuid) WITH CHECK (workspace_id=NULLIF(current_setting(''app.current_workspace_id'',true),'''')::uuid)',
      table_name
    );
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='wodana_app') THEN
      EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO wodana_app',table_name);
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
INSERT INTO permissions(code,description) VALUES
  ('projects.schedule.view','View permitted project schedules and availability'),
  ('projects.schedule.manage','Manage permitted project resources and bookings'),
  ('projects.schedule.override','Approve documented working-calendar exceptions')
ON CONFLICT(code) DO NOTHING;
ALTER TABLE roles DISABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions DISABLE ROW LEVEL SECURITY;
INSERT INTO role_permissions(workspace_id,role_id,permission_id)
SELECT role.workspace_id,role.id,permission.id
FROM roles role CROSS JOIN permissions permission
WHERE role.is_system AND role.code IN ('owner','administrator')
  AND permission.code IN ('projects.schedule.view','projects.schedule.manage','projects.schedule.override')
ON CONFLICT(role_id,permission_id) DO NOTHING;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
