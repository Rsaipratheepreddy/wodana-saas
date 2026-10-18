-- Work done outside and goods sent out. An outsourced step (polishing, upholstery) raises a draft
-- service order to the supplier for the work order's goods; the work order's quality check waits until
-- they're back (received on that order). Made goods go to the project's site as a move linked to the
-- work order, received there like any move.
CREATE TABLE work_order_operations (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  work_order_id uuid NOT NULL,
  name varchar(200) NOT NULL CHECK (length(btrim(name)) > 0),
  vendor_id uuid NOT NULL,
  order_id uuid NOT NULL,
  order_line_id uuid NOT NULL,
  quantity numeric(18, 4) NOT NULL CHECK (quantity > 0),
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, work_order_id) REFERENCES work_orders (workspace_id, id),
  FOREIGN KEY (workspace_id, vendor_id) REFERENCES workspace_vendors (workspace_id, id),
  FOREIGN KEY (workspace_id, order_id) REFERENCES purchase_orders (workspace_id, id),
  FOREIGN KEY (workspace_id, order_line_id) REFERENCES purchase_order_lines (workspace_id, id)
);
--> statement-breakpoint
ALTER TABLE purchase_order_lines ADD COLUMN work_order_id uuid;
--> statement-breakpoint
ALTER TABLE purchase_order_lines ADD CONSTRAINT purchase_order_lines_work_order_fkey FOREIGN KEY (workspace_id, work_order_id) REFERENCES work_orders (workspace_id, id);
--> statement-breakpoint
ALTER TABLE stock_transfers ADD COLUMN work_order_id uuid;
--> statement-breakpoint
ALTER TABLE stock_transfers ADD CONSTRAINT stock_transfers_work_order_fkey FOREIGN KEY (workspace_id, work_order_id) REFERENCES work_orders (workspace_id, id);
--> statement-breakpoint
DO $$
BEGIN
  EXECUTE 'ALTER TABLE work_order_operations ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE work_order_operations FORCE ROW LEVEL SECURITY';
  EXECUTE $policy$CREATE POLICY tenant_isolation ON work_order_operations
    USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
    WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT ON work_order_operations TO wodana_app;
  END IF;
END $$;
