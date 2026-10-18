-- Factory, first slice: work orders for scope lines made in our factory. A line can be split across
-- several work orders (never more than the line). A work order is released only when its checks pass,
-- then its output is reported (good and scrapped), approved by someone else and quality-checked;
-- what passes goes into stock at the factory, owned by the project, and what fails is made again.
CREATE TABLE workcenters (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  name varchar(120) NOT NULL CHECK (length(btrim(name)) > 0),
  hours_per_day numeric(5, 2) CHECK (hours_per_day IS NULL OR (hours_per_day > 0 AND hours_per_day <= 24)),
  active boolean NOT NULL DEFAULT true,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX workcenters_name_key ON workcenters (workspace_id, lower(name)) WHERE active;
--> statement-breakpoint
CREATE TABLE workspace_factory_settings (
  workspace_id uuid PRIMARY KEY,
  require_drawing boolean NOT NULL DEFAULT true,
  require_payment boolean NOT NULL DEFAULT true,
  require_materials boolean NOT NULL DEFAULT true,
  require_check boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid REFERENCES users (id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE work_orders (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  number integer NOT NULL CHECK (number > 0),
  project_id uuid NOT NULL,
  package_id uuid,
  boq_line_id uuid NOT NULL,
  title varchar(500) NOT NULL CHECK (length(btrim(title)) > 0),
  specification varchar(2000) NOT NULL DEFAULT '',
  quantity numeric(18, 4) NOT NULL CHECK (quantity > 0),
  unit varchar(40) NOT NULL DEFAULT '',
  status varchar(20) NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'released', 'in_production', 'ready', 'on_hold', 'cancelled', 'short_closed')),
  workcenter_id uuid,
  planned_start date,
  planned_end date,
  notes varchar(2000) NOT NULL DEFAULT '',
  drawing_ref varchar(200) NOT NULL DEFAULT '',
  drawing_approved_by uuid REFERENCES users (id),
  drawing_approved_at timestamptz,
  released_by uuid REFERENCES users (id),
  released_at timestamptz,
  started_at timestamptz,
  ready_at timestamptz,
  hold_reason varchar(500),
  held_from varchar(20),
  closed_by uuid REFERENCES users (id),
  closed_at timestamptz,
  close_reason varchar(500),
  created_by uuid NOT NULL REFERENCES users (id),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, number),
  FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects (workspace_id, id),
  FOREIGN KEY (workspace_id, package_id) REFERENCES project_packages (workspace_id, id) ON DELETE SET NULL (package_id),
  FOREIGN KEY (workspace_id, boq_line_id) REFERENCES project_boq_lines (workspace_id, id),
  FOREIGN KEY (workspace_id, workcenter_id) REFERENCES workcenters (workspace_id, id),
  CHECK (planned_end IS NULL OR planned_start IS NULL OR planned_end >= planned_start),
  CHECK ((drawing_approved_at IS NULL) = (drawing_approved_by IS NULL)),
  CHECK ((status = 'on_hold') = (hold_reason IS NOT NULL AND held_from IS NOT NULL)),
  CHECK (status NOT IN ('released', 'in_production', 'ready') OR released_at IS NOT NULL),
  CHECK ((status IN ('cancelled', 'short_closed')) = (closed_at IS NOT NULL)),
  CHECK (closed_at IS NULL OR length(btrim(coalesce(close_reason, ''))) > 0)
);
--> statement-breakpoint
CREATE INDEX work_orders_status_idx ON work_orders (workspace_id, status, planned_start);
--> statement-breakpoint
CREATE INDEX work_orders_line_idx ON work_orders (workspace_id, boq_line_id);
--> statement-breakpoint
-- Output as the factory reports it: good pieces and scrap (with why). Someone else approves or refuses it.
CREATE TABLE work_order_reports (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  work_order_id uuid NOT NULL,
  good numeric(18, 4) NOT NULL CHECK (good >= 0),
  scrap numeric(18, 4) NOT NULL DEFAULT 0 CHECK (scrap >= 0),
  scrap_reason varchar(500) NOT NULL DEFAULT '',
  note varchar(1000) NOT NULL DEFAULT '',
  status varchar(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'refused')),
  reported_by uuid NOT NULL REFERENCES users (id),
  reported_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid REFERENCES users (id),
  decided_at timestamptz,
  decision_note varchar(500) NOT NULL DEFAULT '',
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, work_order_id) REFERENCES work_orders (workspace_id, id),
  CHECK (good + scrap > 0),
  CHECK (scrap = 0 OR length(btrim(scrap_reason)) > 0),
  CHECK ((status = 'pending') = (decided_at IS NULL)),
  CHECK (status = 'pending' OR (decided_by IS NOT NULL AND decided_by <> reported_by)),
  CHECK (status <> 'refused' OR length(btrim(decision_note)) > 0)
);
--> statement-breakpoint
-- Quality checks of approved output: what passed went into stock; what failed is made again.
CREATE TABLE work_order_checks (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  work_order_id uuid NOT NULL,
  passed numeric(18, 4) NOT NULL CHECK (passed >= 0),
  failed numeric(18, 4) NOT NULL DEFAULT 0 CHECK (failed >= 0),
  fail_reason varchar(500) NOT NULL DEFAULT '',
  checked_by uuid NOT NULL REFERENCES users (id),
  checked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, work_order_id) REFERENCES work_orders (workspace_id, id),
  CHECK (passed + failed > 0),
  CHECK (failed = 0 OR length(btrim(fail_reason)) > 0)
);
--> statement-breakpoint
CREATE TABLE work_order_events (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  work_order_id uuid NOT NULL,
  kind varchar(30) NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detail) = 'object'),
  actor_id uuid NOT NULL REFERENCES users (id),
  at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (workspace_id, work_order_id) REFERENCES work_orders (workspace_id, id)
);
--> statement-breakpoint
CREATE INDEX work_order_events_order_idx ON work_order_events (workspace_id, work_order_id, at);
--> statement-breakpoint
CREATE TABLE factory_commands (
  workspace_id uuid NOT NULL,
  command_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  action varchar(40) NOT NULL,
  actor_id uuid NOT NULL REFERENCES users (id),
  at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, command_id)
);
--> statement-breakpoint
-- Made goods enter stock at the factory.
ALTER TABLE stock_movements ADD COLUMN work_order_id uuid;
--> statement-breakpoint
ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_kind_check;
--> statement-breakpoint
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_kind_check
  CHECK (kind IN ('receive', 'issue', 'return', 'transfer_out', 'transfer_in', 'allocate', 'release', 'adjust', 'supplier_return', 'reverse', 'produce'));
--> statement-breakpoint
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_produce_check CHECK (kind <> 'produce' OR (quantity > 0 AND work_order_id IS NOT NULL AND project_id IS NOT NULL));
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['workcenters', 'workspace_factory_settings', 'work_orders', 'work_order_reports', 'work_order_checks', 'work_order_events', 'factory_commands'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($policy$CREATE POLICY tenant_isolation ON %I
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$, t);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON workcenters, workspace_factory_settings, work_orders, work_order_reports TO wodana_app;
    GRANT SELECT, INSERT ON work_order_checks, work_order_events, factory_commands TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO permissions (code, description) VALUES
  ('factory.view', 'See what the factory makes, its work orders and their output'),
  ('factory.manage', 'Plan, release, start, hold and close work orders, and set up workcenters'),
  ('factory.report', 'Report what was made and scrapped on a work order'),
  ('factory.approve', 'Approve reported output and check its quality')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (workspace_id, role_id, permission_id)
SELECT role.workspace_id, role.id, permission.id
  FROM roles role CROSS JOIN permissions permission
 WHERE role.is_system AND role.code IN ('owner', 'administrator') AND permission.code IN ('factory.view', 'factory.manage', 'factory.report', 'factory.approve')
ON CONFLICT (role_id, permission_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('factory.released', 'in_app', '{{order}} released: {{item}}', '{{actor}} released it for {{project}}.', '["order", "item", "project", "actor", "note"]'),
  ('factory.report_waiting', 'in_app', 'Approve output on {{order}}', '{{actor}}: {{note}}', '["order", "item", "project", "actor", "note"]'),
  ('factory.check_failed', 'in_app', '{{order}} failed its check', '{{actor}}: {{note}}', '["order", "item", "project", "actor", "note"]'),
  ('factory.ready', 'in_app', '{{item}} is ready', '{{order}} for {{project}} is made and checked.', '["order", "item", "project", "actor", "note"]')
) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
