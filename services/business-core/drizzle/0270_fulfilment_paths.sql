-- Fulfilment per path (PLM-071, PLM-083, PLM-125, PLM-126).
-- 1. crm_flow_fulfilment_rules: per flow (enquiry type) and furniture path, as configuration: whether an order needs a
--    BOQ (QS pricing) by default, which events reserve and take out stock, and the lead time in working days from
--    which event (optionally the catalogue's own production or supplier time). A flow without rows uses the product
--    defaults of its template; a path without its own row uses the flow's. A path may name the place its goods are
--    held at and taken from first (the showroom).
-- 2. crm_deal_fulfilment: one row per won (or quoted) deal: the BOQ-required choice for this order, the transfer
--    request to the factory and its arrival (path B), the booked delivery day, and the cancellation. Collection and delivery stay
--    crm_deal_fulfilment_events, which Deal Closed reads.
-- 3. stock_reservations: stock held for a deal or a project by an event (quote accepted, supplier order received,
--    production booked), then taken out (Won, production started, collection/delivery) or released (cancel, refund).
--    One row per source line, so every event is idempotent. Stock a deal takes leaves the ledger as a 'sale' movement
--    and comes back as 'sale_return'; materials for production use the existing allocate/issue movements.
-- 4. purchase_order_lines.opportunity_id: a supplier order raised for a deal (path C); its goods arrive as free stock
--    and are held for the deal.
-- 5. workspace_purchasing_settings.require_client_payment: orders for a project or deal go out only once the client's
--    payment for that order is in (the release payments of the order's quotation; a deal is won on its proof).
-- 6. Permissions stock.alerts (hear when stock runs low or a sale is short) and fulfilment.deliver (deliver orders and
--    record proof of delivery), and the notice templates.
-- Workspace-scoped tables use forced RLS and a tenant_isolation policy. Nothing is backfilled. Idempotent; never
-- disables RLS.
CREATE TABLE IF NOT EXISTS crm_flow_fulfilment_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  flow_id uuid NOT NULL,
  furniture_path varchar(30) CHECK (furniture_path IS NULL OR furniture_path IN ('take_home_now', 'in_stock_delivery', 'supplier_order', 'core_collection_factory', 'bespoke')),
  -- Null: follow the quotation settings (QS review on or off for the firm).
  boq_required boolean,
  reserve_on varchar(20) NOT NULL DEFAULT 'none' CHECK (reserve_on IN ('none', 'quote_accepted', 'supplier_received', 'production_booked')),
  deduct_on varchar(20) NOT NULL DEFAULT 'none' CHECK (deduct_on IN ('none', 'won', 'fulfilled', 'production_started')),
  lead_min_days smallint CHECK (lead_min_days IS NULL OR lead_min_days BETWEEN 0 AND 365),
  lead_max_days smallint CHECK (lead_max_days IS NULL OR lead_max_days BETWEEN 0 AND 365),
  lead_from varchar(20) NOT NULL DEFAULT 'won' CHECK (lead_from IN ('won', 'drawing_approved')),
  -- The catalogue's own time when longer: a product's production days, else its supplier's lead time.
  lead_from_catalogue boolean NOT NULL DEFAULT false,
  -- Where a deal's goods are held and taken from first (the showroom for goods taken home); null: the default places.
  take_from_location_id uuid,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, flow_id) REFERENCES crm_flows (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, take_from_location_id) REFERENCES stock_locations (workspace_id, id),
  CHECK ((lead_min_days IS NULL) = (lead_max_days IS NULL)),
  CHECK (lead_min_days IS NULL OR lead_min_days <= lead_max_days)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS crm_flow_fulfilment_rules_uidx ON crm_flow_fulfilment_rules (workspace_id, flow_id, coalesce(furniture_path, ''));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS crm_deal_fulfilment (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL REFERENCES crm_opportunities (id) ON DELETE CASCADE,
  -- Null: the path's (or enquiry type's) default.
  boq_required boolean,
  transfer_requested_at timestamptz,
  transfer_requested_by uuid REFERENCES users (id),
  transfer_note varchar(500) NOT NULL DEFAULT '',
  transfer_arrived_at timestamptz,
  transfer_arrived_by uuid REFERENCES users (id),
  delivery_on date,
  delivery_note varchar(500) NOT NULL DEFAULT '',
  delivery_booked_by uuid REFERENCES users (id),
  delivery_booked_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES users (id),
  cancel_reason varchar(1000) NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, opportunity_id),
  CHECK ((transfer_requested_at IS NULL) = (transfer_requested_by IS NULL)),
  CHECK (transfer_arrived_at IS NULL OR transfer_requested_at IS NOT NULL),
  CHECK ((delivery_on IS NULL) = (delivery_booked_at IS NULL)),
  CHECK (cancelled_at IS NULL OR length(btrim(cancel_reason)) > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS fulfilment_commands (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id uuid NOT NULL,
  action varchar(32) NOT NULL,
  actor_id uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS stock_reservations (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  -- What held it: an accepted quotation line, a supplier order's received line, or a work order's material.
  source varchar(24) NOT NULL CHECK (source IN ('quote_line', 'supplier_receipt', 'work_order_material')),
  source_key varchar(200) NOT NULL CHECK (length(btrim(source_key)) > 0),
  opportunity_id uuid REFERENCES crm_opportunities (id) ON DELETE CASCADE,
  project_id uuid,
  work_order_id uuid,
  work_order_material_id uuid,
  item_id uuid NOT NULL,
  -- Where it's held (a soft hold on a deal may say nowhere in particular until it's taken).
  location_id uuid,
  quantity numeric(18, 4) NOT NULL CHECK (quantity > 0),
  status varchar(10) NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'deducted', 'released')),
  -- What was taken out (less when the stock ran short) and what went back.
  deducted numeric(18, 4) NOT NULL DEFAULT 0 CHECK (deducted >= 0),
  returned numeric(18, 4) NOT NULL DEFAULT 0 CHECK (returned >= 0 AND returned <= deducted),
  reason varchar(500) NOT NULL DEFAULT '',
  reserved_at timestamptz NOT NULL DEFAULT now(),
  deducted_at timestamptz,
  released_at timestamptz,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects (workspace_id, id),
  FOREIGN KEY (workspace_id, item_id) REFERENCES stock_items (workspace_id, id),
  FOREIGN KEY (workspace_id, location_id) REFERENCES stock_locations (workspace_id, id),
  CHECK (opportunity_id IS NOT NULL OR project_id IS NOT NULL),
  CHECK ((status = 'reserved') = (deducted_at IS NULL AND released_at IS NULL)),
  CHECK (status <> 'deducted' OR deducted_at IS NOT NULL),
  CHECK ((status = 'released') = (released_at IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS stock_reservations_source_uidx ON stock_reservations (workspace_id, source, source_key);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS stock_reservations_held_idx ON stock_reservations (workspace_id, item_id) WHERE status = 'reserved';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS stock_reservations_opportunity_idx ON stock_reservations (workspace_id, opportunity_id) WHERE opportunity_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS stock_reservations_project_idx ON stock_reservations (workspace_id, project_id) WHERE project_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS reservation_id uuid;
--> statement-breakpoint
ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_reservation_fk;
--> statement-breakpoint
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_reservation_fk FOREIGN KEY (workspace_id, reservation_id) REFERENCES stock_reservations (workspace_id, id);
--> statement-breakpoint
ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_kind_check;
--> statement-breakpoint
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_kind_check
  CHECK (kind IN ('receive', 'issue', 'return', 'transfer_out', 'transfer_in', 'allocate', 'release', 'adjust', 'supplier_return', 'reverse', 'produce', 'sale', 'sale_return'));
--> statement-breakpoint
ALTER TABLE stock_movements DROP CONSTRAINT IF EXISTS stock_movements_sale_check;
--> statement-breakpoint
-- Goods sold leave free stock for the deal that holds them, and come back to where they left.
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_sale_check
  CHECK (kind NOT IN ('sale', 'sale_return') OR (reservation_id IS NOT NULL AND project_id IS NULL AND ((kind = 'sale') = (quantity < 0))));
--> statement-breakpoint
ALTER TABLE purchase_order_lines ADD COLUMN IF NOT EXISTS opportunity_id uuid REFERENCES crm_opportunities (id);
--> statement-breakpoint
ALTER TABLE purchase_order_lines DROP CONSTRAINT IF EXISTS purchase_order_lines_for_deal;
--> statement-breakpoint
ALTER TABLE purchase_order_lines ADD CONSTRAINT purchase_order_lines_for_deal CHECK (opportunity_id IS NULL OR (source = 'free' AND project_id IS NULL));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS purchase_order_lines_opportunity_idx ON purchase_order_lines (workspace_id, opportunity_id) WHERE opportunity_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE workspace_purchasing_settings ADD COLUMN IF NOT EXISTS require_client_payment boolean NOT NULL DEFAULT false;
--> statement-breakpoint
DO $$
DECLARE target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['crm_flow_fulfilment_rules', 'crm_deal_fulfilment', 'fulfilment_commands', 'stock_reservations'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', target);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = target AND policyname = 'tenant_isolation') THEN
      EXECUTE format($policy$CREATE POLICY tenant_isolation ON %I
        USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
        WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$, target);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON crm_flow_fulfilment_rules, crm_deal_fulfilment, fulfilment_commands, stock_reservations TO wodana_app;
    GRANT DELETE ON crm_flow_fulfilment_rules TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS set_updated_at ON crm_flow_fulfilment_rules;
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON crm_flow_fulfilment_rules FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
INSERT INTO permissions (code, description) VALUES
  ('stock.alerts', 'Hear when stock runs low or a sale finds too little in stock'),
  ('fulfilment.deliver', 'Deliver won orders and record the proof of delivery')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (workspace_id, role_id, permission_id)
SELECT role.workspace_id, role.id, permission.id
  FROM roles role CROSS JOIN permissions permission
 WHERE role.is_system AND role.code IN ('owner', 'administrator') AND permission.code IN ('stock.alerts', 'fulfilment.deliver')
ON CONFLICT (role_id, permission_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('stock.sale_short', 'in_app', 'Not enough {{item}} · {{deal}}', '{{note}}', '["item","deal","note"]'),
  ('stock.sale_short', 'email', 'Not enough {{item}} in stock: {{deal}}', E'{{deal}} took {{item}} from stock, but there wasn''t enough.\n\n{{note}}', '["item","deal","note"]'),
  ('fulfilment.transfer_requested', 'in_app', 'Send to the showroom · {{deal}}', '{{actor}} asked for {{items}}. {{note}}', '["deal","actor","items","note"]'),
  ('fulfilment.transfer_requested', 'email', 'Transfer request: {{deal}}', E'{{actor}} asked the factory to send {{items}} for {{deal}}.\n\n{{note}}', '["deal","actor","items","note"]'),
  ('fulfilment.delivery_booked', 'in_app', 'Delivery {{date}} · {{deal}}', '{{actor}} booked the delivery. {{note}}', '["deal","actor","date","note"]'),
  ('fulfilment.delivery_booked', 'email', 'Delivery booked for {{date}}: {{deal}}', E'{{actor}} booked the delivery of {{deal}} for {{date}}.\n\n{{note}}', '["deal","actor","date","note"]'),
  ('fulfilment.order_arrived', 'in_app', 'In for {{deal}}', '{{items}} arrived from the supplier. Arrange the collection or delivery.', '["deal","items"]'),
  ('fulfilment.order_arrived', 'email', 'The supplier order arrived: {{deal}}', E'{{items}} arrived for {{deal}}.\n\nArrange the collection or delivery with the client.', '["deal","items"]'),
  ('fulfilment.late', 'in_app', 'Late · {{deal}}', 'It was expected by {{date}}.', '["deal","date"]'),
  ('fulfilment.late', 'email', 'Late: {{deal}}', E'{{deal}} was expected with the client by {{date}} and isn''t collected or delivered yet.', '["deal","date"]')
) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
