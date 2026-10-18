-- Price requests: the same lines sent to several suppliers, each supplier's price per line recorded as
-- it replies, and each line awarded to one supplier (with the reason when it isn't the cheapest).
-- Awarding turns into one draft order per supplier at the quoted prices.
CREATE TABLE price_requests (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  number integer NOT NULL CHECK (number > 0),
  status varchar(12) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'awarded', 'cancelled')),
  needed_by date,
  notes varchar(2000) NOT NULL DEFAULT '',
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  legal_entity_id uuid NOT NULL,
  created_by uuid NOT NULL REFERENCES users (id),
  awarded_by uuid REFERENCES users (id),
  awarded_at timestamptz,
  cancel_reason varchar(500),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, number),
  FOREIGN KEY (workspace_id, legal_entity_id) REFERENCES legal_entities (workspace_id, id),
  CHECK ((status = 'awarded') = (awarded_at IS NOT NULL)),
  CHECK ((status = 'cancelled') = (cancel_reason IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE price_request_lines (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  request_id uuid NOT NULL,
  position integer NOT NULL DEFAULT 0,
  project_id uuid,
  source varchar(10) NOT NULL CHECK (source IN ('material', 'line', 'free')),
  material_item_id uuid,
  boq_line_id uuid,
  description varchar(500) NOT NULL CHECK (length(btrim(description)) > 0),
  specification varchar(1000) NOT NULL DEFAULT '',
  quantity numeric(18, 4) NOT NULL CHECK (quantity > 0),
  unit varchar(40) NOT NULL DEFAULT '',
  -- The supplier the line went to, once awarded, and why when it isn't the cheapest.
  awarded_vendor_id uuid,
  award_reason varchar(500) NOT NULL DEFAULT '',
  order_id uuid,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, request_id) REFERENCES price_requests (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects (workspace_id, id),
  FOREIGN KEY (workspace_id, material_item_id) REFERENCES project_material_items (workspace_id, id),
  FOREIGN KEY (workspace_id, boq_line_id) REFERENCES project_boq_lines (workspace_id, id),
  FOREIGN KEY (workspace_id, awarded_vendor_id) REFERENCES workspace_vendors (workspace_id, id),
  FOREIGN KEY (workspace_id, order_id) REFERENCES purchase_orders (workspace_id, id),
  CHECK ((source = 'material') = (material_item_id IS NOT NULL)),
  CHECK ((source = 'line') = (boq_line_id IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE price_request_suppliers (
  workspace_id uuid NOT NULL,
  request_id uuid NOT NULL,
  vendor_id uuid NOT NULL,
  status varchar(12) NOT NULL DEFAULT 'asked' CHECK (status IN ('asked', 'replied', 'declined')),
  asked_to varchar(320),
  lead_time_days integer CHECK (lead_time_days IS NULL OR lead_time_days BETWEEN 0 AND 3650),
  valid_until date,
  note varchar(1000) NOT NULL DEFAULT '',
  replied_at timestamptz,
  PRIMARY KEY (workspace_id, request_id, vendor_id),
  FOREIGN KEY (workspace_id, request_id) REFERENCES price_requests (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, vendor_id) REFERENCES workspace_vendors (workspace_id, id)
);
--> statement-breakpoint
CREATE TABLE price_request_quotes (
  workspace_id uuid NOT NULL,
  request_id uuid NOT NULL,
  vendor_id uuid NOT NULL,
  line_id uuid NOT NULL,
  unit_price numeric(18, 4) NOT NULL CHECK (unit_price >= 0),
  discount_percent numeric(5, 2) NOT NULL DEFAULT 0 CHECK (discount_percent >= 0 AND discount_percent < 100),
  PRIMARY KEY (workspace_id, request_id, vendor_id, line_id),
  FOREIGN KEY (workspace_id, request_id, vendor_id) REFERENCES price_request_suppliers (workspace_id, request_id, vendor_id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, line_id) REFERENCES price_request_lines (workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX price_requests_status_idx ON price_requests (workspace_id, status, created_at DESC);
--> statement-breakpoint
DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['price_requests', 'price_request_lines', 'price_request_suppliers', 'price_request_quotes'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', name);
    EXECUTE format($policy$CREATE POLICY tenant_isolation ON %I
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$, name);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO wodana_app', name);
    END IF;
  END LOOP;
END $$;
