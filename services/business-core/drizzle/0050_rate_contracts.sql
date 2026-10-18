-- Rate contracts: prices agreed with a supplier for a period, per catalog item. While one is valid its
-- price is the default on orders, and a line priced above it shows that.
CREATE TABLE supplier_rate_contracts (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  vendor_id uuid NOT NULL,
  reference varchar(80) NOT NULL CHECK (length(btrim(reference)) > 0),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  valid_from date NOT NULL,
  valid_to date NOT NULL,
  note varchar(1000) NOT NULL DEFAULT '',
  status varchar(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  cancel_reason varchar(500),
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, vendor_id, reference),
  FOREIGN KEY (workspace_id, vendor_id) REFERENCES workspace_vendors (workspace_id, id),
  CHECK (valid_to >= valid_from),
  CHECK (status <> 'cancelled' OR length(btrim(cancel_reason)) > 0)
);
--> statement-breakpoint
CREATE TABLE supplier_rate_contract_lines (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  contract_id uuid NOT NULL,
  catalog_item_id uuid NOT NULL,
  unit_price numeric(18, 4) NOT NULL CHECK (unit_price >= 0),
  minimum numeric(18, 4) CHECK (minimum IS NULL OR minimum > 0),
  pack_size numeric(18, 4) CHECK (pack_size IS NULL OR pack_size > 0),
  lead_days integer CHECK (lead_days IS NULL OR lead_days >= 0),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, contract_id, catalog_item_id),
  FOREIGN KEY (workspace_id, contract_id) REFERENCES supplier_rate_contracts (workspace_id, id),
  FOREIGN KEY (workspace_id, catalog_item_id) REFERENCES catalog_items (workspace_id, id)
);
--> statement-breakpoint
DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['supplier_rate_contracts', 'supplier_rate_contract_lines'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', name);
    EXECUTE format($policy$CREATE POLICY tenant_isolation ON %I
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$, name);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON supplier_rate_contracts, supplier_rate_contract_lines TO wodana_app;
  END IF;
END $$;
