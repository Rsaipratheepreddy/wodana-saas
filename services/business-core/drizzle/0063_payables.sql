-- Payables. A supplier's invoice (their number, once per supplier) is entered against order lines and
-- matched three ways: never more than was received, and at the ordered price within the workspace's
-- tolerance. A matching invoice is approved as it's submitted; one that doesn't match (or arrives before
-- the goods) is held until someone else approves it with why. Credited supplier returns become debit notes
-- once their goods had been invoiced.
-- Payments (or advances on an order) are allocated to approved invoices, never beyond what's owed.
ALTER TABLE workspace_purchasing_settings ADD COLUMN invoice_tolerance_percent numeric(5, 2) NOT NULL DEFAULT 1 CHECK (invoice_tolerance_percent BETWEEN 0 AND 50);
--> statement-breakpoint
CREATE TABLE supplier_invoices (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  vendor_id uuid NOT NULL,
  legal_entity_id uuid NOT NULL,
  number varchar(80) NOT NULL CHECK (length(btrim(number)) > 0),
  invoice_date date NOT NULL,
  due_date date,
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  net numeric(18, 4) NOT NULL DEFAULT 0,
  tax numeric(18, 4) NOT NULL DEFAULT 0,
  total numeric(18, 4) NOT NULL DEFAULT 0,
  -- The total printed on the supplier's invoice; held when the lines don't add up to it.
  stated_total numeric(18, 4) CHECK (stated_total IS NULL OR stated_total >= 0),
  status varchar(10) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'held', 'approved', 'cancelled')),
  hold_reasons varchar(2000) NOT NULL DEFAULT '',
  approved_by uuid REFERENCES users (id),
  approved_at timestamptz,
  approval_note varchar(1000) NOT NULL DEFAULT '',
  cancel_reason varchar(500),
  file_name varchar(255),
  file_type varchar(100),
  file_key varchar(500),
  file_sha256 char(64),
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, vendor_id) REFERENCES workspace_vendors (workspace_id, id),
  FOREIGN KEY (workspace_id, legal_entity_id) REFERENCES legal_entities (workspace_id, id),
  CHECK (due_date IS NULL OR due_date >= invoice_date),
  -- Why it didn't match stays on it; a held invoice is approved only by someone other than who entered it.
  CHECK (status <> 'held' OR length(btrim(hold_reasons)) > 0),
  CHECK (status <> 'approved' OR approved_at IS NOT NULL),
  CHECK (approved_by IS NULL OR approved_by <> created_by),
  CHECK (status <> 'approved' OR length(btrim(hold_reasons)) = 0 OR (approved_by IS NOT NULL AND length(btrim(approval_note)) > 0)),
  CHECK ((status = 'cancelled') = (cancel_reason IS NOT NULL))
);
--> statement-breakpoint
-- A supplier's invoice number is entered once (unless that invoice was cancelled).
CREATE UNIQUE INDEX supplier_invoices_number_key ON supplier_invoices (workspace_id, vendor_id, lower(btrim(number))) WHERE status <> 'cancelled';
--> statement-breakpoint
CREATE TABLE supplier_invoice_lines (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  position integer NOT NULL DEFAULT 0,
  order_line_id uuid,
  project_id uuid,
  description varchar(500) NOT NULL CHECK (length(btrim(description)) > 0),
  quantity numeric(18, 4) NOT NULL CHECK (quantity > 0),
  unit_price numeric(18, 4) NOT NULL CHECK (unit_price >= 0),
  tax_rate numeric(7, 4) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate <= 100),
  net numeric(18, 4) NOT NULL,
  tax numeric(18, 4) NOT NULL,
  total numeric(18, 4) NOT NULL,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, invoice_id) REFERENCES supplier_invoices (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, order_line_id) REFERENCES purchase_order_lines (workspace_id, id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects (workspace_id, id)
);
--> statement-breakpoint
CREATE INDEX supplier_invoice_lines_order_line_idx ON supplier_invoice_lines (workspace_id, order_line_id);
--> statement-breakpoint
CREATE TABLE supplier_payments (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  vendor_id uuid NOT NULL,
  legal_entity_id uuid NOT NULL,
  paid_on date NOT NULL,
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  amount numeric(18, 4) NOT NULL CHECK (amount > 0),
  method varchar(10) NOT NULL CHECK (method IN ('bank', 'cheque', 'cash', 'card', 'other')),
  reference varchar(120) NOT NULL DEFAULT '',
  -- An advance is paid against an order before its invoice; it's allocated to that order's invoices later.
  order_id uuid,
  -- A bank payment goes to the supplier's approved account (verified by call-back and a second person).
  bank_account_id uuid,
  status varchar(10) NOT NULL DEFAULT 'recorded' CHECK (status IN ('recorded', 'reversed')),
  reverse_reason varchar(500),
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, vendor_id) REFERENCES workspace_vendors (workspace_id, id),
  FOREIGN KEY (workspace_id, legal_entity_id) REFERENCES legal_entities (workspace_id, id),
  FOREIGN KEY (workspace_id, order_id) REFERENCES purchase_orders (workspace_id, id),
  FOREIGN KEY (workspace_id, bank_account_id) REFERENCES vendor_bank_accounts (workspace_id, id),
  CHECK ((method = 'bank') = (bank_account_id IS NOT NULL)),
  CHECK ((status = 'reversed') = (reverse_reason IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX supplier_payments_order_idx ON supplier_payments (workspace_id, order_id) WHERE order_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE supplier_payment_allocations (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  payment_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  amount numeric(18, 4) NOT NULL CHECK (amount > 0),
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, payment_id) REFERENCES supplier_payments (workspace_id, id),
  FOREIGN KEY (workspace_id, invoice_id) REFERENCES supplier_invoices (workspace_id, id)
);
--> statement-breakpoint
CREATE INDEX supplier_payment_allocations_invoice_idx ON supplier_payment_allocations (workspace_id, invoice_id);
--> statement-breakpoint
CREATE INDEX supplier_payment_allocations_payment_idx ON supplier_payment_allocations (workspace_id, payment_id);
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['supplier_invoices', 'supplier_invoice_lines', 'supplier_payments', 'supplier_payment_allocations'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($policy$CREATE POLICY tenant_isolation ON %I
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$, t);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON supplier_invoices, supplier_payments TO wodana_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON supplier_invoice_lines TO wodana_app;
    GRANT SELECT, INSERT ON supplier_payment_allocations TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO permissions (code, description) VALUES
  ('payables.view', 'See supplier invoices, what is owed to suppliers and payments made'),
  ('payables.manage', 'Enter supplier invoices and record payments to suppliers'),
  ('payables.approve', 'Approve supplier invoices that don''t match their order or receipt')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (workspace_id, role_id, permission_id)
SELECT role.workspace_id, role.id, permission.id
  FROM roles role CROSS JOIN permissions permission
 WHERE role.is_system AND role.code IN ('owner', 'administrator') AND permission.code IN ('payables.view', 'payables.manage', 'payables.approve')
ON CONFLICT (role_id, permission_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('payables.held', 'in_app', 'Supplier invoice held: {{supplier}} {{invoice}}', '{{note}}', '["supplier", "invoice", "amount", "actor", "note"]'),
  ('payables.due', 'in_app', 'Supplier invoices due · {{supplier}}', '{{note}}', '["supplier", "invoice", "amount", "actor", "note"]')
) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
