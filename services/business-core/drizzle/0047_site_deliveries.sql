-- Deliveries at site: photos as proof and who handed the goods over; and goods that arrive with no
-- order, held until someone matches them to one (only then do they count and enter stock) or sends
-- them back.
ALTER TABLE goods_receipts ADD COLUMN handed_over_by varchar(200) NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE workspace_purchasing_settings ADD COLUMN require_site_photo boolean NOT NULL DEFAULT true;
--> statement-breakpoint
CREATE TABLE unmatched_deliveries (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  number integer NOT NULL CHECK (number > 0),
  vendor_id uuid,
  supplier_name varchar(200) NOT NULL DEFAULT '',
  location_id uuid NOT NULL,
  received_on date NOT NULL,
  received_by uuid NOT NULL REFERENCES users (id),
  handed_over_by varchar(200) NOT NULL DEFAULT '',
  delivery_note varchar(120) NOT NULL DEFAULT '',
  notes varchar(2000) NOT NULL DEFAULT '',
  status varchar(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'matched', 'returned')),
  receipt_id uuid,
  resolved_by uuid REFERENCES users (id),
  resolved_at timestamptz,
  resolution_note varchar(500) NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, number),
  FOREIGN KEY (workspace_id, vendor_id) REFERENCES workspace_vendors (workspace_id, id),
  FOREIGN KEY (workspace_id, location_id) REFERENCES stock_locations (workspace_id, id),
  FOREIGN KEY (workspace_id, receipt_id) REFERENCES goods_receipts (workspace_id, id),
  CHECK (vendor_id IS NOT NULL OR length(btrim(supplier_name)) > 0),
  CHECK ((status = 'matched') = (receipt_id IS NOT NULL)),
  CHECK (status = 'open' OR (resolved_by IS NOT NULL AND resolved_at IS NOT NULL)),
  CHECK (status <> 'returned' OR length(btrim(resolution_note)) > 0)
);
--> statement-breakpoint
CREATE TABLE unmatched_delivery_lines (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  delivery_id uuid NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  description varchar(500) NOT NULL CHECK (length(btrim(description)) > 0),
  quantity numeric(18, 4) NOT NULL CHECK (quantity > 0),
  unit varchar(40) NOT NULL DEFAULT '',
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, delivery_id) REFERENCES unmatched_deliveries (workspace_id, id)
);
--> statement-breakpoint
CREATE TABLE goods_receipt_photos (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  -- A photo belongs to a delivery, or to goods that arrived without an order (until they're matched).
  receipt_id uuid,
  unmatched_id uuid,
  original_name varchar(240) NOT NULL,
  mime_type varchar(80) NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size > 0),
  object_key varchar(300) NOT NULL,
  preview_key varchar(300),
  sha256 char(64) NOT NULL,
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, receipt_id) REFERENCES goods_receipts (workspace_id, id),
  FOREIGN KEY (workspace_id, unmatched_id) REFERENCES unmatched_deliveries (workspace_id, id),
  CHECK ((receipt_id IS NULL) <> (unmatched_id IS NULL))
);
--> statement-breakpoint
CREATE INDEX goods_receipt_photos_receipt_idx ON goods_receipt_photos (workspace_id, receipt_id) WHERE receipt_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX goods_receipt_photos_unmatched_idx ON goods_receipt_photos (workspace_id, unmatched_id) WHERE unmatched_id IS NOT NULL;
--> statement-breakpoint
DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['unmatched_deliveries', 'unmatched_delivery_lines', 'goods_receipt_photos'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', name);
    EXECUTE format($policy$CREATE POLICY tenant_isolation ON %I
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$, name);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON unmatched_deliveries, unmatched_delivery_lines, goods_receipt_photos TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, 'in_app', 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('purchasing.unmatched', 'Goods arrived without an order', '{{actor}} received goods from {{supplier}} at {{note}}. Match them to an order or send them back.', '["supplier", "actor", "note"]')
) AS template (code, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
