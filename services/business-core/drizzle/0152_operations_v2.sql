-- Operations v2: purchasing, stock and the people who run them.
--
-- 1. Role templates for delivery work beyond the Owner (buyer, purchasing approver, storekeeper, factory
--    lead, QC inspector) and for Finance (finance, finance approver). Kits that deliver projects list the
--    delivery templates; every kit lists the finance ones. Existing workspaces get the roles they're
--    missing (editable, unassigned), so someone other than the Owner can approve orders, output and bills.
-- 2. Reorder points: free stock of an item at a place (or everywhere) at or below its point is low.
-- 3. Shipment tracking inside an order: carrier, tracking reference and link, shipped and expected dates.
-- 4. Ordering for a project on hold needs the buyer's reason, kept on the order.
-- 5. A late supplier line blocks the work that needs it: one blocker per line, closed when the goods are in.
-- Every new table has workspace_id, forced RLS and a tenant_isolation policy.
UPDATE tenant_setup_profiles
   SET configuration = jsonb_set(configuration, '{roleTemplates}', (
         SELECT to_jsonb(array_agg(DISTINCT code ORDER BY code)) FROM (
           SELECT jsonb_array_elements_text(configuration->'roleTemplates') AS code
           UNION SELECT unnest(ARRAY['finance', 'finance_approver'])
           UNION SELECT unnest(CASE WHEN configuration->'applicableJobSections' ? 'delivery'
                                    THEN ARRAY['buyer', 'purchasing_approver', 'storekeeper', 'factory_lead', 'qc_inspector'] ELSE ARRAY[]::text[] END)
         ) codes))
 WHERE kind = 'firm_kit' AND jsonb_typeof(configuration->'roleTemplates') = 'array';
--> statement-breakpoint
WITH template (code, name, description, delivery, permissions) AS (VALUES
  ('buyer', 'Buyer', 'Buys what projects need: price requests, orders to suppliers, confirmations and chasing late deliveries', true,
   ARRAY['projects.view', 'purchasing.view', 'purchasing.manage', 'vendors.view', 'vendors.manage', 'stock.view', 'stock.receive', 'catalog.view']),
  ('purchasing_approver', 'Purchasing approver', 'Approves the orders others raise, supplier alternatives and new suppliers', true,
   ARRAY['projects.view', 'purchasing.view', 'purchasing.approve', 'vendors.view', 'vendors.approve', 'stock.view']),
  ('storekeeper', 'Storekeeper', 'Receives deliveries, keeps stock by place, issues and moves it, and counts it', true,
   ARRAY['projects.view', 'purchasing.view', 'stock.view', 'stock.manage', 'stock.receive', 'stock.adjust', 'catalog.view']),
  ('factory_lead', 'Factory lead', 'Plans and releases work orders, approves others'' output and sends made goods to site', true,
   ARRAY['projects.view', 'factory.view', 'factory.manage', 'factory.report', 'factory.approve', 'stock.view', 'stock.manage', 'purchasing.view', 'catalog.view']),
  ('qc_inspector', 'QC inspector', 'Checks factory output and inspects deliveries; never checks their own work', true,
   ARRAY['projects.view', 'factory.view', 'factory.approve', 'stock.view', 'stock.inspect', 'purchasing.view']),
  ('finance', 'Finance', 'Enters supplier invoices, records payments and client receipts, and verifies deal payments', false,
   ARRAY['pre_projects.view', 'crm.opportunities.view', 'commercial.finance.verify', 'commercial.costs.view', 'payables.view', 'payables.manage', 'receivables.view',
         'receivables.manage', 'accounting.manage', 'purchasing.view', 'projects.view']),
  ('finance_approver', 'Finance approver', 'Approves held supplier invoices and payment runs that someone else prepared', false,
   ARRAY['payables.view', 'payables.approve', 'receivables.view', 'purchasing.view', 'projects.view'])
), kit AS (
  -- A workspace's kit decides whether it delivers projects; one set up without a kit gets everything.
  SELECT DISTINCT ON (setup.workspace_id) setup.workspace_id, coalesce(profile.configuration->'applicableJobSections' ? 'delivery', true) AS delivers
    FROM workspace_setup_versions setup
    LEFT JOIN tenant_setup_profiles profile ON profile.kind = 'firm_kit' AND profile.code = setup.firm_kit_code AND profile.selectable
   ORDER BY setup.workspace_id, setup.created_at DESC
), added AS (
  INSERT INTO roles (workspace_id, code, name, description, is_system)
  SELECT workspace.id, template.code, template.name, template.description, false
    FROM workspaces workspace CROSS JOIN template
    LEFT JOIN kit ON kit.workspace_id = workspace.id
   WHERE (NOT template.delivery OR coalesce(kit.delivers, true))
     AND NOT EXISTS (SELECT 1 FROM roles existing WHERE existing.workspace_id = workspace.id AND existing.code = template.code)
  RETURNING id, workspace_id, code
)
INSERT INTO role_permissions (workspace_id, role_id, permission_id)
SELECT added.workspace_id, added.id, permission.id
  FROM added JOIN template ON template.code = added.code
  JOIN permissions permission ON permission.code = ANY(template.permissions)
ON CONFLICT (role_id, permission_id) DO NOTHING;
--> statement-breakpoint
CREATE TABLE stock_reorder_points (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  item_id uuid NOT NULL,
  -- One place, or every place together when empty.
  location_id uuid,
  -- Free stock at or below this is low; what to order then (optional), and from whom (optional).
  reorder_at numeric(18, 4) NOT NULL CHECK (reorder_at >= 0),
  reorder_quantity numeric(18, 4) CHECK (reorder_quantity IS NULL OR reorder_quantity > 0),
  vendor_id uuid,
  -- When it last went low (cleared once it's back above) and when people were told about it.
  low_since timestamptz,
  alerted_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, item_id) REFERENCES stock_items (workspace_id, id),
  FOREIGN KEY (workspace_id, location_id) REFERENCES stock_locations (workspace_id, id),
  FOREIGN KEY (workspace_id, vendor_id) REFERENCES workspace_vendors (workspace_id, id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX stock_reorder_points_key ON stock_reorder_points (workspace_id, item_id, coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid));
--> statement-breakpoint
CREATE TABLE purchase_order_shipments (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  order_id uuid NOT NULL,
  carrier varchar(120) NOT NULL DEFAULT '',
  tracking_ref varchar(120) NOT NULL DEFAULT '',
  tracking_url varchar(500) NOT NULL DEFAULT '' CHECK (tracking_url = '' OR tracking_url ~* '^https?://'),
  status varchar(12) NOT NULL DEFAULT 'booked' CHECK (status IN ('booked', 'in_transit', 'delayed', 'arrived', 'cancelled')),
  shipped_on date,
  eta date,
  note varchar(500) NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES users (id),
  updated_by uuid NOT NULL REFERENCES users (id),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, order_id) REFERENCES purchase_orders (workspace_id, id),
  CHECK (eta IS NULL OR shipped_on IS NULL OR eta >= shipped_on)
);
--> statement-breakpoint
CREATE INDEX purchase_order_shipments_order_idx ON purchase_order_shipments (workspace_id, order_id);
--> statement-breakpoint
ALTER TABLE purchase_orders
  ADD COLUMN hold_override_by uuid REFERENCES users (id),
  ADD COLUMN hold_override_at timestamptz,
  ADD COLUMN hold_override_reason varchar(500),
  ADD CONSTRAINT purchase_orders_hold_override_reason CHECK (hold_override_at IS NULL OR length(btrim(hold_override_reason)) > 0);
--> statement-breakpoint
CREATE TABLE purchase_line_blockers (
  workspace_id uuid NOT NULL,
  order_line_id uuid NOT NULL,
  work_item_id uuid NOT NULL,
  raised_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  PRIMARY KEY (workspace_id, work_item_id),
  FOREIGN KEY (workspace_id, order_line_id) REFERENCES purchase_order_lines (workspace_id, id),
  FOREIGN KEY (workspace_id, work_item_id) REFERENCES work_items (workspace_id, id)
);
--> statement-breakpoint
-- One open blocker per late line.
CREATE UNIQUE INDEX purchase_line_blockers_open ON purchase_line_blockers (workspace_id, order_line_id) WHERE closed_at IS NULL;
--> statement-breakpoint
DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['stock_reorder_points', 'purchase_order_shipments', 'purchase_line_blockers'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', name);
    EXECUTE format($policy$CREATE POLICY tenant_isolation ON %I
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$, name);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON stock_reorder_points TO wodana_app;
    GRANT SELECT, INSERT, UPDATE ON purchase_order_shipments, purchase_line_blockers TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('stock.low', 'in_app', 'Stock is low: {{item}}', '{{note}}', '["item", "place", "note"]'),
  ('stock.low', 'email', 'Stock is low: {{item}}', '{{note}}', '["item", "place", "note"]'),
  ('purchasing.shipment_late', 'in_app', '{{order}} arrives later', '{{supplier}}: {{note}}', '["order", "supplier", "amount", "actor", "note"]'),
  ('purchasing.blocking_work', 'in_app', '{{order}} is holding up work', '{{supplier}}: {{note}}', '["order", "supplier", "amount", "actor", "note"]'),
  ('purchasing.over_ordered', 'in_app', '{{variation}} leaves orders past what {{project}} needs', '{{note}}', '["variation", "project", "note"]'),
  ('purchasing.hold_override', 'in_app', '{{order}} goes ahead while its project is on hold', '{{actor}}: {{note}}', '["order", "supplier", "amount", "actor", "note"]')
) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
