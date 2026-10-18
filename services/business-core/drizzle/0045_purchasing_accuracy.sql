-- Accuracy fixes across purchasing and stock:
--  * materials the client doesn't choose (cement, screws) don't wait for the client's sign-off;
--  * ordering more than a project needs says why;
--  * a credited return carries its tax as well as its net;
--  * every stock and purchasing command is recorded once, so a retry never posts twice.
ALTER TABLE project_material_items ADD COLUMN client_choice boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE purchase_orders ADD COLUMN over_reason varchar(500);
--> statement-breakpoint
ALTER TABLE supplier_return_lines ADD COLUMN credit_tax numeric(18, 4) CHECK (credit_tax IS NULL OR credit_tax >= 0);
--> statement-breakpoint
-- Credits recorded before tax was carried take the order line's tax for the same share.
UPDATE supplier_return_lines line SET credit_tax = round(ordered.tax / ordered.quantity * line.quantity, 4)
  FROM purchase_order_lines ordered
 WHERE ordered.workspace_id = line.workspace_id AND ordered.id = line.order_line_id AND line.credit_amount IS NOT NULL AND ordered.quantity > 0;
--> statement-breakpoint
CREATE TABLE stock_commands (
  workspace_id uuid NOT NULL,
  id uuid NOT NULL,
  action varchar(24) NOT NULL,
  actor_id uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id)
);
--> statement-breakpoint
CREATE TABLE purchasing_commands (
  workspace_id uuid NOT NULL,
  id uuid NOT NULL,
  entity_id uuid NOT NULL,
  action varchar(24) NOT NULL,
  actor_id uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id)
);
--> statement-breakpoint
DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['stock_commands', 'purchasing_commands'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', name);
    EXECUTE format($policy$CREATE POLICY tenant_isolation ON %I
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$, name);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT ON stock_commands, purchasing_commands TO wodana_app;
  END IF;
END $$;
