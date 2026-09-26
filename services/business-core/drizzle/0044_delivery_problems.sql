-- Delivery problems: why goods were rejected (damaged, defective, wrong item, not to spec), goods
-- missing against the supplier's delivery note, returns to the supplier (replaced or credited, also
-- for defects found after acceptance), reversing a receipt entered by mistake, and inspecting a
-- delivery line by line.
ALTER TABLE goods_receipt_lines
  ADD COLUMN reject_kind varchar(12) CHECK (reject_kind IN ('damaged', 'defective', 'wrong_item', 'wrong_spec', 'other')),
  -- What the supplier's delivery note says came; more than arrived is missing.
  ADD COLUMN noted numeric(18, 4) CHECK (noted IS NULL OR noted >= 0),
  ADD COLUMN inspected_by uuid REFERENCES users (id),
  ADD COLUMN inspected_at timestamptz;
--> statement-breakpoint
-- Rejections recorded before reasons had kinds are "other". The guard is lifted only for this backfill.
ALTER TABLE goods_receipt_lines DISABLE TRIGGER goods_receipt_lines_guard;
--> statement-breakpoint
UPDATE goods_receipt_lines SET reject_kind = 'other' WHERE rejected > 0 AND reject_kind IS NULL;
--> statement-breakpoint
ALTER TABLE goods_receipt_lines ENABLE TRIGGER goods_receipt_lines_guard;
--> statement-breakpoint
ALTER TABLE goods_receipt_lines ADD CONSTRAINT goods_receipt_lines_reject_kind_required CHECK (rejected = 0 OR reject_kind IS NOT NULL);
--> statement-breakpoint
ALTER TABLE goods_receipts
  ADD COLUMN reversed_at timestamptz,
  ADD COLUMN reversed_by uuid REFERENCES users (id),
  ADD COLUMN reverse_reason varchar(500),
  ADD CONSTRAINT goods_receipts_reversed_check CHECK ((reversed_at IS NULL) = (reversed_by IS NULL) AND (reversed_at IS NULL OR length(btrim(reverse_reason)) > 0));
--> statement-breakpoint
CREATE TABLE supplier_returns (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  number integer NOT NULL CHECK (number > 0),
  order_id uuid NOT NULL,
  -- Where the goods leave from: the place they were received.
  location_id uuid NOT NULL,
  -- The supplier sends them again, or credits them and they're no longer owed.
  outcome varchar(8) NOT NULL CHECK (outcome IN ('replace', 'credit')),
  status varchar(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'sent', 'cancelled')),
  note varchar(2000) NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_on date,
  sent_by uuid REFERENCES users (id),
  cancel_reason varchar(500),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, number),
  FOREIGN KEY (workspace_id, order_id) REFERENCES purchase_orders (workspace_id, id),
  FOREIGN KEY (workspace_id, location_id) REFERENCES stock_locations (workspace_id, id),
  CHECK ((status = 'sent') = (sent_on IS NOT NULL)),
  CHECK (status <> 'cancelled' OR length(btrim(cancel_reason)) > 0)
);
--> statement-breakpoint
CREATE INDEX supplier_returns_order_idx ON supplier_returns (workspace_id, order_id);
--> statement-breakpoint
CREATE TABLE supplier_return_lines (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  return_id uuid NOT NULL,
  receipt_line_id uuid NOT NULL,
  order_line_id uuid NOT NULL,
  -- Rejected at delivery, or accepted and found wrong later (those leave stock when they go back).
  source varchar(8) NOT NULL CHECK (source IN ('rejected', 'accepted')),
  quantity numeric(18, 4) NOT NULL CHECK (quantity > 0),
  reason_kind varchar(12) NOT NULL CHECK (reason_kind IN ('damaged', 'defective', 'wrong_item', 'wrong_spec', 'other')),
  reason varchar(500) NOT NULL CHECK (length(btrim(reason)) > 0),
  -- What the supplier owes back for a credited line, at the order line's price.
  credit_amount numeric(18, 4) CHECK (credit_amount IS NULL OR credit_amount >= 0),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, return_id) REFERENCES supplier_returns (workspace_id, id),
  FOREIGN KEY (workspace_id, receipt_line_id) REFERENCES goods_receipt_lines (workspace_id, id),
  FOREIGN KEY (workspace_id, order_line_id) REFERENCES purchase_order_lines (workspace_id, id)
);
--> statement-breakpoint
CREATE INDEX supplier_return_lines_receipt_line_idx ON supplier_return_lines (workspace_id, receipt_line_id);
--> statement-breakpoint
CREATE INDEX supplier_return_lines_order_line_idx ON supplier_return_lines (workspace_id, order_line_id);
--> statement-breakpoint
ALTER TABLE stock_movements ADD COLUMN supplier_return_id uuid;
--> statement-breakpoint
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_supplier_return_fk FOREIGN KEY (workspace_id, supplier_return_id) REFERENCES supplier_returns (workspace_id, id);
--> statement-breakpoint
ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_kind_check;
--> statement-breakpoint
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_kind_check
  CHECK (kind IN ('receive', 'issue', 'return', 'transfer_out', 'transfer_in', 'allocate', 'release', 'adjust', 'supplier_return', 'reverse'));
--> statement-breakpoint
ALTER TABLE stock_movements
  ADD CONSTRAINT stock_movements_supplier_return_check CHECK (kind <> 'supplier_return' OR (quantity < 0 AND supplier_return_id IS NOT NULL)),
  ADD CONSTRAINT stock_movements_reverse_check CHECK (kind <> 'reverse' OR (quantity < 0 AND receipt_line_id IS NOT NULL));
--> statement-breakpoint
DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['supplier_returns', 'supplier_return_lines'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', name);
    EXECUTE format($policy$CREATE POLICY tenant_isolation ON %I
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$, name);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON supplier_returns, supplier_return_lines TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, 'in_app', 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('purchasing.missing', 'Goods missing on {{order}}', '{{actor}}: {{note}}', '["order", "supplier", "amount", "actor", "note"]'),
  ('purchasing.supplier_return', 'Goods going back to {{supplier}}', '{{actor}} raised a return on {{order}}: {{note}}', '["order", "supplier", "amount", "actor", "note"]'),
  ('purchasing.receipt_reversed', 'A delivery on {{order}} was reversed', '{{actor}}: {{note}}', '["order", "supplier", "amount", "actor", "note"]')
) AS template (code, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
