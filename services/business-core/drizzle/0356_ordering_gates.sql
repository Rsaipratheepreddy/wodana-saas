-- PLM-159 / PLM-163 / PLM-169: the ordering gate's optional checks, each a purchasing setting (off by default), and
-- what the checks record.
--
-- 1. workspace_purchasing_settings: require_drawings_verified (the project's technical drawings or data sheets passed
--    their check), require_boq_approved (the project BOQ is QS-approved or locked; "To order" offers its lines only
--    then), require_price_approval (an order or work order whose verified cost is above the agreed amount, or whose
--    scope change is pending, waits for the client's approved price correction), require_qs_signoff (a draft order is
--    signed off by the QS), require_material_list_confirmed (the QS confirmed the project's material list).
-- 2. purchase_orders.qs_signed_off_by / _at: the QS's sign-off on the draft (cleared when its lines change).
-- 3. purchase_order_gate_waivers: a check marked "Not applicable" on one order, with the reason, by someone who
--    approves orders. Shown on the order and audited.
-- 4. delivery_projects.material_list_confirmed_*: the QS's confirmation of the material list, with the fingerprint of
--    the list confirmed (a list that changes since is no longer confirmed).
-- Tenant records: workspace-scoped, forced RLS, tenant_isolation. Idempotent; never disables RLS.
ALTER TABLE workspace_purchasing_settings
  ADD COLUMN IF NOT EXISTS require_drawings_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS require_boq_approved boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS require_price_approval boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS require_qs_signoff boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS require_material_list_confirmed boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS qs_signed_off_by uuid REFERENCES users (id),
  ADD COLUMN IF NOT EXISTS qs_signed_off_at timestamptz;
--> statement-breakpoint
ALTER TABLE delivery_projects
  ADD COLUMN IF NOT EXISTS material_list_confirmed_by uuid REFERENCES users (id),
  ADD COLUMN IF NOT EXISTS material_list_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS material_list_confirmed_hash char(64);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS purchase_order_gate_waivers (
  workspace_id uuid NOT NULL,
  order_id uuid NOT NULL,
  check_key varchar(40) NOT NULL CHECK (check_key IN ('drawings_verified', 'boq_approved', 'price_approved', 'qs_signoff', 'material_list_confirmed')),
  reason varchar(500) NOT NULL CHECK (length(btrim(reason)) > 0),
  waived_by uuid NOT NULL REFERENCES users (id),
  waived_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, order_id, check_key),
  FOREIGN KEY (workspace_id, order_id) REFERENCES purchase_orders (workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE purchase_order_gate_waivers ENABLE ROW LEVEL SECURITY;
  ALTER TABLE purchase_order_gate_waivers FORCE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'purchase_order_gate_waivers' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON purchase_order_gate_waivers
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON purchase_order_gate_waivers TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO workspace_record_classification (table_name, disposition, clear_predicate, file_columns) VALUES
  ('purchase_order_gate_waivers', 'clear', NULL, '{}')
ON CONFLICT (table_name) DO UPDATE SET disposition = excluded.disposition,
  clear_predicate = excluded.clear_predicate, file_columns = excluded.file_columns;
