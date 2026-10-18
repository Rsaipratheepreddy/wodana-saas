-- Factory and installation bookings (PLM-063, PLM-069; PLM-135, PLM-136 from Palm's answers of 6 Oct).
--
-- 1. logistics_vehicles: the firm's vehicles register (a name or plate, a type, a capacity note, active). Deliveries
--    record the vehicle used besides the driver; a vehicle can't be booked twice on a day.
-- 2. building_permits: the permit a delivery or installation needs (buildings can't be entered without one), on a
--    project or, for an order with no project (Furniture Only), on the deal: a planned collection day and who goes,
--    then the permit collected with its type, reference, valid-from/valid-to days, file and who collected it. A permit
--    on a project shows on its deal (the Deal File) and the other way round.
-- 3. logistics_assignments: who and what goes on a booked day. One row per booking: a project's delivery, installation,
--    factory slot or permit collection, a production work order, or a deal's delivery. The day itself stays on its
--    source record (delivery_projects.delivery_on / installation_on / factory_slot_on, work_orders.planned_start..
--    planned_end, building_permits.collect_on, crm_deal_fulfilment.delivery_on); this row holds the crew (an HRMS crew),
--    the vehicle and the driver (an HRMS worker: crews and installers are booked by name, without a Wodana login) and a
--    note. Version-checked.
-- 4. logistics_assignment_people: the people on a booking (HRMS workers), one of them the lead.
-- 5. workspace_logistics_settings: how many working days before a delivery a missing permit is raised (3 by default),
--    and whether deals delivered without a project (Furniture Only) need a permit too (off by default). Configuration.
-- 6. The permission logistics.manage (book deliveries, installations, permit collection and production on the factory
--    and logistics calendar), for the owner and administrator roles, and the notice templates for every workspace.
-- Every table is workspace-scoped with forced RLS and a tenant_isolation policy. Nothing is backfilled. Idempotent;
-- never disables RLS.
CREATE TABLE IF NOT EXISTS logistics_vehicles (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name varchar(120) NOT NULL CHECK (length(btrim(name)) > 0),
  plate varchar(40) NOT NULL DEFAULT '',
  kind varchar(60) NOT NULL DEFAULT '',
  capacity_note varchar(200) NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS logistics_vehicles_name_key ON logistics_vehicles (workspace_id, lower(name));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS building_permits (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id uuid,
  opportunity_id uuid REFERENCES crm_opportunities (id) ON DELETE CASCADE,
  status varchar(12) NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'collected', 'cancelled')),
  -- The day someone goes to collect it (a booking on the logistics calendar).
  collect_on date,
  -- The kind of permit (building access, delivery, NOC…), as the firm names it.
  permit_type varchar(80) NOT NULL DEFAULT '',
  permit_number varchar(80) NOT NULL DEFAULT '',
  valid_from date,
  valid_to date,
  collected_on date,
  collected_by_worker_id uuid,
  note varchar(500) NOT NULL DEFAULT '',
  file_name varchar(255),
  file_mime varchar(120),
  file_size integer CHECK (file_size IS NULL OR file_size > 0),
  file_key varchar(500),
  file_sha256 char(64),
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid REFERENCES users (id),
  recorded_at timestamptz,
  cancel_reason varchar(500) NOT NULL DEFAULT '',
  cancelled_by uuid REFERENCES users (id),
  cancelled_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, collected_by_worker_id) REFERENCES hrms_workers (workspace_id, id),
  CHECK ((project_id IS NULL) <> (opportunity_id IS NULL)),
  CHECK (status <> 'planned' OR collect_on IS NOT NULL),
  CHECK (status <> 'collected' OR (length(btrim(permit_number)) > 0 AND valid_from IS NOT NULL AND valid_to IS NOT NULL AND collected_on IS NOT NULL
    AND file_key IS NOT NULL AND recorded_at IS NOT NULL)),
  CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_from <= valid_to),
  CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL))
);
--> statement-breakpoint
-- One collection planned at a time per project or deal.
CREATE UNIQUE INDEX IF NOT EXISTS building_permits_planned_key ON building_permits (workspace_id, project_id) WHERE status = 'planned' AND project_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS building_permits_planned_deal_key ON building_permits (workspace_id, opportunity_id) WHERE status = 'planned' AND opportunity_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS building_permits_project_idx ON building_permits (workspace_id, project_id, status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS building_permits_deal_idx ON building_permits (workspace_id, opportunity_id, status);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS logistics_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  kind varchar(16) NOT NULL CHECK (kind IN ('delivery', 'installation', 'factory_slot', 'permit', 'production')),
  project_id uuid,
  -- A deal's delivery (an order with no project) or its permit collection.
  opportunity_id uuid REFERENCES crm_opportunities (id) ON DELETE CASCADE,
  work_order_id uuid,
  permit_id uuid,
  crew_id uuid,
  vehicle_id uuid,
  driver_worker_id uuid,
  note varchar(500) NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, work_order_id) REFERENCES work_orders (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, permit_id) REFERENCES building_permits (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, crew_id) REFERENCES hrms_crews (workspace_id, id),
  FOREIGN KEY (workspace_id, vehicle_id) REFERENCES logistics_vehicles (workspace_id, id),
  FOREIGN KEY (workspace_id, driver_worker_id) REFERENCES hrms_workers (workspace_id, id),
  CHECK ((project_id IS NULL) <> (opportunity_id IS NULL)),
  CHECK (opportunity_id IS NULL OR kind IN ('delivery', 'permit')),
  CHECK ((kind = 'production') = (work_order_id IS NOT NULL)),
  CHECK ((kind = 'permit') = (permit_id IS NOT NULL)),
  -- A vehicle and a driver go on deliveries.
  CHECK (kind = 'delivery' OR (vehicle_id IS NULL AND driver_worker_id IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS logistics_assignments_project_key ON logistics_assignments (workspace_id, kind, project_id) WHERE kind IN ('delivery', 'installation', 'factory_slot') AND project_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS logistics_assignments_deal_key ON logistics_assignments (workspace_id, opportunity_id) WHERE kind = 'delivery' AND opportunity_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS logistics_assignments_order_key ON logistics_assignments (workspace_id, work_order_id) WHERE work_order_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS logistics_assignments_permit_key ON logistics_assignments (workspace_id, permit_id) WHERE permit_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS logistics_assignments_vehicle_idx ON logistics_assignments (workspace_id, vehicle_id) WHERE vehicle_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS logistics_assignment_people (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  assignment_id uuid NOT NULL,
  worker_id uuid NOT NULL,
  lead boolean NOT NULL DEFAULT false,
  PRIMARY KEY (workspace_id, assignment_id, worker_id),
  FOREIGN KEY (workspace_id, assignment_id) REFERENCES logistics_assignments (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, worker_id) REFERENCES hrms_workers (workspace_id, id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS logistics_assignment_people_lead_key ON logistics_assignment_people (workspace_id, assignment_id) WHERE lead;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS logistics_assignment_people_worker_idx ON logistics_assignment_people (workspace_id, worker_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS workspace_logistics_settings (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  permit_warning_days smallint NOT NULL DEFAULT 3 CHECK (permit_warning_days BETWEEN 0 AND 30),
  deal_delivery_permit boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid REFERENCES users (id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
DO $$
DECLARE target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['logistics_vehicles', 'building_permits', 'logistics_assignments', 'logistics_assignment_people', 'workspace_logistics_settings'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', target);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = target AND policyname = 'tenant_isolation') THEN
      EXECUTE format($policy$CREATE POLICY tenant_isolation ON %I
        USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
        WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$, target);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON logistics_vehicles, building_permits, logistics_assignments, logistics_assignment_people, workspace_logistics_settings TO wodana_app;
    GRANT DELETE ON logistics_assignments, logistics_assignment_people TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO permissions (code, description) VALUES
  ('logistics.manage', 'Book deliveries, installations, permit collection and production on the factory and logistics calendar')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (workspace_id, role_id, permission_id)
SELECT role.workspace_id, role.id, permission.id
  FROM roles role CROSS JOIN permissions permission
 WHERE role.is_system AND role.code IN ('owner', 'administrator') AND permission.code = 'logistics.manage'
ON CONFLICT (role_id, permission_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('logistics.booked', 'in_app', '{{what}} on {{date}} · {{project}}', '{{actor}} booked it. {{crew}}', '["what","project","date","actor","crew"]'),
  ('logistics.booked', 'email', '{{what}} on {{date}}: {{project}}', E'{{actor}} booked {{what}} for {{project}} on {{date}}.\n\n{{crew}}', '["what","project","date","actor","crew"]'),
  ('logistics.permit_collected', 'in_app', 'Building permit collected · {{project}}', 'Permit {{number}}, valid {{from}} to {{to}}.', '["project","number","from","to","actor"]'),
  ('logistics.permit_missing', 'in_app', 'No building permit for {{what}} · {{project}}', 'Collect it before {{what}} on {{date}}.', '["project","what","date","until"]'),
  ('logistics.permit_missing', 'email', 'No building permit for {{what}}: {{project}}', E'There is no building permit for {{project}} yet for {{what}} on {{date}}.\n\nCollect it first: the building can''t be entered without it.', '["project","what","date","until"]'),
  ('logistics.permit_expiring', 'in_app', 'The building permit ends before {{what}} · {{project}}', 'It is valid until {{until}}, before {{what}} on {{date}}.', '["project","what","date","until"]'),
  ('logistics.permit_expiring', 'email', 'The building permit ends before {{what}}: {{project}}', E'The building permit for {{project}} is valid until {{until}}, before {{what}} on {{date}}.\n\nRenew the permit or move the day.', '["project","what","date","until"]')
) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
