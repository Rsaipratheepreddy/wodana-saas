-- Receiving: goods arriving against an order's lines, at a location (a warehouse, the factory or a
-- project's site). What arrives is split into accepted, rejected (with the reason) and waiting for
-- inspection — always adding up to what arrived — and someone other than the receiver inspects.
ALTER TABLE purchase_orders DROP CONSTRAINT purchase_orders_status_check;
--> statement-breakpoint
ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_status_check
  CHECK (status IN ('draft', 'pending_approval', 'approved', 'sent', 'confirmed', 'partly_received', 'received', 'closed', 'cancelled'));
--> statement-breakpoint
ALTER TABLE purchase_orders DROP CONSTRAINT purchase_orders_check4;
--> statement-breakpoint
ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_sent_check
  CHECK (status NOT IN ('sent', 'confirmed', 'partly_received', 'received') OR sent_at IS NOT NULL);
--> statement-breakpoint
ALTER TABLE purchase_orders DROP CONSTRAINT purchase_orders_check5;
--> statement-breakpoint
ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_confirmed_check CHECK (status <> 'confirmed' OR confirmed_at IS NOT NULL);
--> statement-breakpoint
ALTER TABLE purchase_orders ADD COLUMN closed_at timestamptz, ADD COLUMN close_reason varchar(500);
--> statement-breakpoint
ALTER TABLE workspace_purchasing_settings
  ADD COLUMN require_inspection boolean NOT NULL DEFAULT true,
  ADD COLUMN receive_tolerance_percent numeric(5, 2) NOT NULL DEFAULT 0 CHECK (receive_tolerance_percent >= 0 AND receive_tolerance_percent <= 50);
--> statement-breakpoint
CREATE TABLE stock_locations (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  kind varchar(12) NOT NULL CHECK (kind IN ('warehouse', 'factory', 'site', 'other')),
  name varchar(160) NOT NULL CHECK (length(btrim(name)) > 0),
  project_id uuid,
  address varchar(500) NOT NULL DEFAULT '',
  is_default boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects (workspace_id, id),
  CHECK ((kind = 'site') = (project_id IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX stock_locations_one_site ON stock_locations (workspace_id, project_id) WHERE kind = 'site';
--> statement-breakpoint
CREATE UNIQUE INDEX stock_locations_one_default ON stock_locations (workspace_id, kind) WHERE is_default;
--> statement-breakpoint
CREATE TABLE goods_receipts (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  number integer NOT NULL CHECK (number > 0),
  order_id uuid NOT NULL,
  location_id uuid NOT NULL,
  received_on date NOT NULL,
  received_by uuid NOT NULL REFERENCES users (id),
  delivery_note varchar(120) NOT NULL DEFAULT '',
  notes varchar(2000) NOT NULL DEFAULT '',
  inspected_by uuid REFERENCES users (id),
  inspected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, number),
  FOREIGN KEY (workspace_id, order_id) REFERENCES purchase_orders (workspace_id, id),
  FOREIGN KEY (workspace_id, location_id) REFERENCES stock_locations (workspace_id, id),
  CHECK (inspected_by IS NULL OR inspected_by <> received_by)
);
--> statement-breakpoint
CREATE INDEX goods_receipts_order_idx ON goods_receipts (workspace_id, order_id);
--> statement-breakpoint
CREATE TABLE goods_receipt_lines (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  receipt_id uuid NOT NULL,
  order_line_id uuid NOT NULL,
  received numeric(18, 4) NOT NULL CHECK (received > 0),
  accepted numeric(18, 4) NOT NULL DEFAULT 0 CHECK (accepted >= 0),
  rejected numeric(18, 4) NOT NULL DEFAULT 0 CHECK (rejected >= 0),
  pending numeric(18, 4) NOT NULL DEFAULT 0 CHECK (pending >= 0),
  reject_reason varchar(500) NOT NULL DEFAULT '',
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, receipt_id) REFERENCES goods_receipts (workspace_id, id),
  FOREIGN KEY (workspace_id, order_line_id) REFERENCES purchase_order_lines (workspace_id, id),
  CHECK (accepted + rejected + pending = received),
  CHECK (rejected = 0 OR length(btrim(reject_reason)) > 0)
);
--> statement-breakpoint
CREATE INDEX goods_receipt_lines_order_line_idx ON goods_receipt_lines (workspace_id, order_line_id);
--> statement-breakpoint
-- A receipt line changes once: when what's waiting is inspected. What arrived never changes.
CREATE FUNCTION goods_receipt_line_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR NEW.received IS DISTINCT FROM OLD.received OR NEW.order_line_id IS DISTINCT FROM OLD.order_line_id OR OLD.pending = 0 THEN
    RAISE EXCEPTION 'A received quantity cannot be changed.';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER goods_receipt_lines_guard BEFORE UPDATE OR DELETE ON goods_receipt_lines
FOR EACH ROW EXECUTE FUNCTION goods_receipt_line_guard();
--> statement-breakpoint
DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['stock_locations', 'goods_receipts', 'goods_receipt_lines'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', name);
    EXECUTE format($policy$CREATE POLICY tenant_isolation ON %I
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$, name);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON stock_locations, goods_receipts, goods_receipt_lines TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, 'in_app', 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('purchasing.received', '{{order}} arrived', '{{actor}} received it at {{note}}.', '["order", "supplier", "amount", "actor", "note"]'),
  ('purchasing.rejected', 'Goods rejected on {{order}}', '{{actor}}: {{note}}', '["order", "supplier", "amount", "actor", "note"]'),
  ('purchasing.inspection_needed', '{{order}} is waiting for inspection', '{{actor}} received it; someone else checks it.', '["order", "supplier", "amount", "actor", "note"]')
) AS template (code, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
--> statement-breakpoint
INSERT INTO permissions (code, description) VALUES
  ('stock.receive', 'Record goods arriving against purchase orders'),
  ('stock.inspect', 'Inspect received goods: accept or reject what arrived')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (workspace_id, role_id, permission_id)
SELECT role.workspace_id, role.id, permission.id
  FROM roles role CROSS JOIN permissions permission
 WHERE role.is_system AND role.code IN ('owner', 'administrator') AND permission.code IN ('stock.receive', 'stock.inspect')
ON CONFLICT (role_id, permission_id) DO NOTHING;
