-- Purchase orders: one supplier, one buying company, lines that each say what they're for — a material on
-- a project's signed-off material list, a bought line of its scope, or a free line. Totals are exact
-- decimals kept on the order. An approved order that changes keeps a frozen copy of what was approved.
CREATE TABLE workspace_purchasing_settings (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces (id),
  -- Orders at or above this amount (in the workspace currency) need approval; orders in another
  -- currency always do. NULL: no approval needed.
  approval_threshold numeric(18, 4) CHECK (approval_threshold IS NULL OR approval_threshold >= 0) DEFAULT 0,
  require_material_signoff boolean NOT NULL DEFAULT true,
  require_approved_supplier boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid REFERENCES users (id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE purchase_orders (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  number varchar(60) NOT NULL,
  legal_entity_id uuid NOT NULL,
  vendor_id uuid NOT NULL,
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status varchar(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_approval', 'approved', 'sent', 'confirmed', 'closed', 'cancelled')),
  payment_terms varchar(12) NOT NULL CHECK (payment_terms IN ('upfront', 'on_delivery', 'split', 'credit', 'statement')),
  advance_percent numeric(5, 2) CHECK (advance_percent IS NULL OR (advance_percent > 0 AND advance_percent < 100)),
  credit_days integer CHECK (credit_days IS NULL OR credit_days BETWEEN 1 AND 365),
  terms_note varchar(500) NOT NULL DEFAULT '',
  deliver_to varchar(12) NOT NULL DEFAULT 'site' CHECK (deliver_to IN ('site', 'factory', 'warehouse', 'pickup', 'other')),
  delivery_address varchar(500) NOT NULL DEFAULT '',
  expected_date date,
  promised_date date,
  supplier_reference varchar(120) NOT NULL DEFAULT '',
  notes varchar(2000) NOT NULL DEFAULT '',
  subtotal numeric(18, 4) NOT NULL DEFAULT 0,
  discount_total numeric(18, 4) NOT NULL DEFAULT 0,
  tax_total numeric(18, 4) NOT NULL DEFAULT 0,
  total numeric(18, 4) NOT NULL DEFAULT 0,
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_by uuid NOT NULL REFERENCES users (id),
  submitted_by uuid REFERENCES users (id),
  approved_by uuid REFERENCES users (id),
  approved_at timestamptz,
  sent_at timestamptz,
  sent_to varchar(320),
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason varchar(500),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, number),
  FOREIGN KEY (workspace_id, legal_entity_id) REFERENCES legal_entities (workspace_id, id),
  FOREIGN KEY (workspace_id, vendor_id) REFERENCES workspace_vendors (workspace_id, id),
  CHECK ((payment_terms = 'split') = (advance_percent IS NOT NULL)),
  CHECK ((payment_terms = 'credit') = (credit_days IS NOT NULL)),
  CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
  CHECK (status IN ('draft', 'pending_approval', 'cancelled') OR approved_at IS NOT NULL),
  CHECK (status NOT IN ('sent', 'confirmed', 'closed') OR sent_at IS NOT NULL),
  CHECK (status NOT IN ('confirmed', 'closed') OR confirmed_at IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX purchase_orders_status_idx ON purchase_orders (workspace_id, status, created_at DESC);
--> statement-breakpoint
CREATE INDEX purchase_orders_vendor_idx ON purchase_orders (workspace_id, vendor_id);
--> statement-breakpoint
CREATE TABLE purchase_order_lines (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  order_id uuid NOT NULL,
  position integer NOT NULL DEFAULT 0,
  project_id uuid,
  source varchar(10) NOT NULL CHECK (source IN ('material', 'line', 'free')),
  material_item_id uuid,
  boq_line_id uuid,
  description varchar(500) NOT NULL CHECK (length(btrim(description)) > 0),
  specification varchar(1000) NOT NULL DEFAULT '',
  quantity numeric(18, 4) NOT NULL CHECK (quantity > 0),
  unit varchar(40) NOT NULL DEFAULT '',
  unit_price numeric(18, 4) NOT NULL CHECK (unit_price >= 0),
  discount_percent numeric(5, 2) NOT NULL DEFAULT 0 CHECK (discount_percent >= 0 AND discount_percent < 100),
  tax_rate numeric(7, 4) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate <= 100),
  net numeric(18, 4) NOT NULL,
  tax numeric(18, 4) NOT NULL,
  total numeric(18, 4) NOT NULL,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, order_id) REFERENCES purchase_orders (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects (workspace_id, id),
  FOREIGN KEY (workspace_id, material_item_id) REFERENCES project_material_items (workspace_id, id),
  FOREIGN KEY (workspace_id, boq_line_id) REFERENCES project_boq_lines (workspace_id, id),
  CHECK ((source = 'material') = (material_item_id IS NOT NULL)),
  CHECK ((source = 'line') = (boq_line_id IS NOT NULL)),
  CHECK (source = 'free' OR project_id IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX purchase_order_lines_order_idx ON purchase_order_lines (workspace_id, order_id, position);
--> statement-breakpoint
CREATE INDEX purchase_order_lines_material_idx ON purchase_order_lines (workspace_id, material_item_id) WHERE material_item_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX purchase_order_lines_boq_idx ON purchase_order_lines (workspace_id, boq_line_id) WHERE boq_line_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX purchase_order_lines_project_idx ON purchase_order_lines (workspace_id, project_id) WHERE project_id IS NOT NULL;
--> statement-breakpoint
-- What happened to an order, in order. Never edited.
CREATE TABLE purchase_order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  order_id uuid NOT NULL,
  kind varchar(30) NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detail) = 'object'),
  actor_id uuid REFERENCES users (id),
  at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (workspace_id, order_id) REFERENCES purchase_orders (workspace_id, id)
);
--> statement-breakpoint
CREATE INDEX purchase_order_events_order_idx ON purchase_order_events (workspace_id, order_id, at);
--> statement-breakpoint
-- The order exactly as it was approved, kept when an approved order is changed. Never edited.
CREATE TABLE purchase_order_revisions (
  workspace_id uuid NOT NULL,
  order_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision >= 0),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  reason varchar(500) NOT NULL,
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_id, order_id, revision),
  FOREIGN KEY (workspace_id, order_id) REFERENCES purchase_orders (workspace_id, id)
);
--> statement-breakpoint
CREATE FUNCTION purchase_order_history_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Purchase order history cannot be changed.';
END $$;
--> statement-breakpoint
CREATE TRIGGER purchase_order_events_frozen BEFORE UPDATE OR DELETE ON purchase_order_events
FOR EACH ROW EXECUTE FUNCTION purchase_order_history_immutable();
--> statement-breakpoint
CREATE TRIGGER purchase_order_revisions_frozen BEFORE UPDATE OR DELETE ON purchase_order_revisions
FOR EACH ROW EXECUTE FUNCTION purchase_order_history_immutable();
--> statement-breakpoint
DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['workspace_purchasing_settings', 'purchase_orders', 'purchase_order_lines', 'purchase_order_events', 'purchase_order_revisions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', name);
    EXECUTE format($policy$CREATE POLICY tenant_isolation ON %I
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$, name);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON workspace_purchasing_settings, purchase_orders TO wodana_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON purchase_order_lines TO wodana_app;
    GRANT SELECT, INSERT ON purchase_order_events, purchase_order_revisions TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('purchasing.approval_needed', 'in_app', '{{order}} needs your approval', '{{actor}} raised {{order}} to {{supplier}} for {{amount}}.', '["order", "supplier", "amount", "actor", "note"]'),
  ('purchasing.approval_needed', 'email', '{{order}} needs your approval · {{amount}}', E'{{actor}} raised {{order}} to {{supplier}} for {{amount}}.\n\nOpen it to approve or send it back.', '["order", "supplier", "amount", "actor", "note"]'),
  ('purchasing.approved', 'in_app', '{{order}} is approved', '{{actor}} approved {{order}} to {{supplier}}. Send it to the supplier.', '["order", "supplier", "amount", "actor", "note"]'),
  ('purchasing.returned', 'in_app', '{{order}} was sent back', '{{actor}}: {{note}}', '["order", "supplier", "amount", "actor", "note"]')
) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
