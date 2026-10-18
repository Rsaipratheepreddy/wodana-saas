-- Factory order ready (PLM-064, PLM-065, PLM-067): a quality check carries a note and an optional photo; a
-- work order records the day it was ready and the client's payment stage that falls due then; the payment
-- reminder that date triggers goes once per stage.
ALTER TABLE work_order_checks ADD COLUMN note varchar(1000) NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE work_orders
  ADD COLUMN ready_on date,
  ADD COLUMN ready_payment_id text CHECK (ready_payment_id IS NULL OR length(ready_payment_id) BETWEEN 1 AND 200);
--> statement-breakpoint
-- Work already ready keeps the day it became ready, in its workspace's time zone.
UPDATE work_orders wo SET ready_on = (wo.ready_at AT TIME ZONE coalesce(nullif(workspace.default_timezone, ''), 'UTC'))::date
  FROM workspaces workspace WHERE workspace.id = wo.workspace_id AND wo.status = 'ready' AND wo.ready_at IS NOT NULL AND wo.ready_on IS NULL;
--> statement-breakpoint
CREATE INDEX work_orders_ready_payment_idx ON work_orders (workspace_id, project_id, ready_payment_id) WHERE ready_payment_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE work_order_check_photos (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  check_id uuid NOT NULL,
  work_order_id uuid NOT NULL,
  original_name varchar(240) NOT NULL,
  mime_type varchar(80) NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size > 0),
  object_key varchar(300) NOT NULL,
  preview_key varchar(300),
  sha256 char(64) NOT NULL,
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  -- One photo per check.
  UNIQUE (workspace_id, check_id),
  FOREIGN KEY (workspace_id, check_id) REFERENCES work_order_checks (workspace_id, id),
  FOREIGN KEY (workspace_id, work_order_id) REFERENCES work_orders (workspace_id, id)
);
--> statement-breakpoint
-- The payment reminder an order-ready date triggered, once per payment stage, and what came of it.
CREATE TABLE factory_ready_reminders (
  workspace_id uuid NOT NULL,
  case_id uuid NOT NULL,
  payment_id text NOT NULL,
  project_id uuid NOT NULL,
  work_order_id uuid NOT NULL,
  ready_on date NOT NULL,
  outcome varchar(40) NOT NULL,
  channel varchar(20) CHECK (channel IS NULL OR channel IN ('whatsapp', 'email')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, case_id, payment_id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects (workspace_id, id),
  FOREIGN KEY (workspace_id, work_order_id) REFERENCES work_orders (workspace_id, id)
);
--> statement-breakpoint
DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['work_order_check_photos', 'factory_ready_reminders'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', name);
    EXECUTE format($policy$CREATE POLICY tenant_isolation ON %I
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$, name);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT ON work_order_check_photos TO wodana_app;
    GRANT SELECT, INSERT, UPDATE ON factory_ready_reminders TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('factory.order_ready', 'in_app', '{{item}} is ready · {{project}}', '{{order}} was ready on {{date}}. {{payment}}', '["order","item","project","date","actor","payment"]'),
  ('factory.order_ready', 'email', '{{item}} is ready: {{project}}', E'{{order}} {{item}} for {{project}} was ready on {{date}}.\n\n{{payment}}', '["order","item","project","date","actor","payment"]'),
  ('factory.project_ready', 'in_app', 'Everything for {{project}} is made', 'All factory items passed their checks. Schedule delivery and installation.', '["order","item","project","date","actor","payment"]'),
  ('factory.project_ready', 'email', 'Everything for {{project}} is made', E'Every factory item for {{project}} passed its checks on {{date}}.\n\nSchedule delivery and installation.', '["order","item","project","date","actor","payment"]')
) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
