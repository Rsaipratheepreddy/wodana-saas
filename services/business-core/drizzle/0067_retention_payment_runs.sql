-- Retention and payment runs.
-- Retention: an order holds back a share of what its supplier invoices (the supplier's usual share by
-- default) until the project is handed over. When an invoice is approved, what it holds back is fixed per
-- project. Releases are recorded apart — automatically once the client accepted the project's handover, or
-- earlier or later by someone who approves payables, with why — so partial and per-project releases add up
-- exactly. What's held isn't payable, nor overdue, until it's released.
-- Payment runs: someone who pays suppliers lists approved invoices and how much of each to pay; someone else
-- approves the list before the money goes out; marking it paid records one bank payment per supplier, company
-- and currency, allocated exactly as the run says. A submitted or approved run reserves what it pays, so
-- nothing pays the same balance twice. A workspace can require invoices to be paid only through runs.
ALTER TABLE workspace_vendors ADD COLUMN retention_percent numeric(5, 2) NOT NULL DEFAULT 0 CHECK (retention_percent >= 0 AND retention_percent < 100);
--> statement-breakpoint
ALTER TABLE purchase_orders ADD COLUMN retention_percent numeric(5, 2) NOT NULL DEFAULT 0 CHECK (retention_percent >= 0 AND retention_percent < 100);
--> statement-breakpoint
-- Each line's order retention when its invoice was approved (a snapshot; later terms never change it).
ALTER TABLE supplier_invoice_lines ADD COLUMN retention_percent numeric(5, 2) NOT NULL DEFAULT 0 CHECK (retention_percent >= 0 AND retention_percent < 100);
--> statement-breakpoint
-- On: invoices are paid only through an approved run; an advance on an order is still recorded directly.
ALTER TABLE workspace_purchasing_settings ADD COLUMN payment_runs_required boolean NOT NULL DEFAULT false;
--> statement-breakpoint
-- What an approved invoice holds back, per project its lines are for (lines for no project together).
CREATE TABLE supplier_invoice_retentions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  project_id uuid,
  amount numeric(18, 4) NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, invoice_id, id),
  FOREIGN KEY (workspace_id, invoice_id) REFERENCES supplier_invoices (workspace_id, id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects (workspace_id, id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX supplier_invoice_retentions_project_key ON supplier_invoice_retentions (workspace_id, invoice_id, project_id) NULLS NOT DISTINCT;
--> statement-breakpoint
CREATE TABLE supplier_retention_releases (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  retention_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  amount numeric(18, 4) NOT NULL CHECK (amount > 0),
  -- Automatic: the daily run, once the client accepted the project's handover. Otherwise someone who approves payables, with why.
  automatic boolean NOT NULL DEFAULT false,
  reason varchar(500),
  released_by uuid REFERENCES users (id),
  released_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, invoice_id, retention_id) REFERENCES supplier_invoice_retentions (workspace_id, invoice_id, id),
  CHECK (automatic = (released_by IS NULL)),
  CHECK (automatic OR length(btrim(coalesce(reason, ''))) > 0)
);
--> statement-breakpoint
CREATE INDEX supplier_retention_releases_invoice_idx ON supplier_retention_releases (workspace_id, invoice_id, retention_id);
--> statement-breakpoint
CREATE TABLE payment_runs (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  number integer NOT NULL CHECK (number > 0),
  note varchar(500) NOT NULL DEFAULT '',
  status varchar(10) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'paid', 'cancelled')),
  created_by uuid NOT NULL REFERENCES users (id),
  -- Who last changed or submitted the list. Someone else — neither they nor who started it — approves it.
  prepared_by uuid NOT NULL REFERENCES users (id),
  submitted_at timestamptz,
  approved_by uuid REFERENCES users (id),
  approved_at timestamptz,
  return_note varchar(1000),
  paid_by uuid REFERENCES users (id),
  paid_at timestamptz,
  paid_on date,
  cancel_reason varchar(500),
  created_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, number),
  CHECK (approved_by IS NULL OR (approved_by <> prepared_by AND approved_by <> created_by)),
  CHECK ((approved_by IS NULL) = (approved_at IS NULL)),
  CHECK (status NOT IN ('submitted', 'approved', 'paid') OR submitted_at IS NOT NULL),
  CHECK (status NOT IN ('approved', 'paid') OR approved_by IS NOT NULL),
  CHECK (status NOT IN ('draft', 'submitted') OR approved_by IS NULL),
  CHECK ((status = 'paid') = (paid_by IS NOT NULL AND paid_at IS NOT NULL AND paid_on IS NOT NULL)),
  CHECK ((status = 'cancelled') = (cancel_reason IS NOT NULL)),
  CHECK (cancel_reason IS NULL OR length(btrim(cancel_reason)) > 0)
);
--> statement-breakpoint
CREATE TABLE payment_run_items (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  run_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  amount numeric(18, 4) NOT NULL CHECK (amount > 0),
  -- The supplier's approved bank account when the run was approved: the money goes into that one only.
  bank_account_id uuid,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, run_id, invoice_id),
  FOREIGN KEY (workspace_id, run_id) REFERENCES payment_runs (workspace_id, id),
  FOREIGN KEY (workspace_id, invoice_id) REFERENCES supplier_invoices (workspace_id, id),
  FOREIGN KEY (workspace_id, bank_account_id) REFERENCES vendor_bank_accounts (workspace_id, id)
);
--> statement-breakpoint
CREATE INDEX payment_run_items_invoice_idx ON payment_run_items (workspace_id, invoice_id);
--> statement-breakpoint
-- A run's list changes only while it's a draft; approving it only records the bank account per line.
CREATE FUNCTION payment_run_items_frozen() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  item payment_run_items;
  run_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN item := OLD; ELSE item := NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.run_id = OLD.run_id AND NEW.invoice_id = OLD.invoice_id AND NEW.amount = OLD.amount THEN RETURN NEW; END IF;
  SELECT status INTO run_status FROM payment_runs WHERE workspace_id = item.workspace_id AND id = item.run_id;
  IF run_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'A payment run''s invoices change only while it is a draft.';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER payment_run_items_frozen BEFORE INSERT OR UPDATE OR DELETE ON payment_run_items FOR EACH ROW EXECUTE FUNCTION payment_run_items_frozen();
--> statement-breakpoint
-- A run's payments: by bank, one per supplier, company and currency.
ALTER TABLE supplier_payments
  ADD COLUMN run_id uuid,
  ADD CONSTRAINT supplier_payments_run_fk FOREIGN KEY (workspace_id, run_id) REFERENCES payment_runs (workspace_id, id),
  ADD CONSTRAINT supplier_payments_run_check CHECK (run_id IS NULL OR (method = 'bank' AND order_id IS NULL));
--> statement-breakpoint
CREATE UNIQUE INDEX supplier_payments_run_key ON supplier_payments (workspace_id, run_id, vendor_id, legal_entity_id, currency) WHERE run_id IS NOT NULL;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['supplier_invoice_retentions', 'supplier_retention_releases', 'payment_runs', 'payment_run_items'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($policy$CREATE POLICY tenant_isolation ON %I
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$, t);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT ON supplier_invoice_retentions, supplier_retention_releases TO wodana_app;
    GRANT SELECT, INSERT, UPDATE ON payment_runs TO wodana_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON payment_run_items TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
UPDATE permissions SET description = 'Enter supplier invoices, prepare payment runs and record payments to suppliers' WHERE code = 'payables.manage';
--> statement-breakpoint
UPDATE permissions SET description = 'Approve supplier invoices that don''t match, payment runs, and releasing retention early' WHERE code = 'payables.approve';
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, 'in_app', 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('payables.retention_released', 'Retention to pay · {{supplier}}', '{{note}}', '["supplier", "invoice", "amount", "actor", "note"]'),
  ('payables.run_submitted', 'Payment run {{run}} needs your approval', '{{actor}} prepared {{amount}}.', '["run", "amount", "actor", "note"]'),
  ('payables.run_approved', 'Payment run {{run}} is approved', '{{actor}} approved {{amount}}. Pay it, then mark it paid.', '["run", "amount", "actor", "note"]'),
  ('payables.run_returned', 'Payment run {{run}} was sent back', '{{actor}}: {{note}}', '["run", "amount", "actor", "note"]'),
  ('payables.run_paid', 'Payment run {{run}} is paid', '{{actor}} recorded {{amount}} paid on {{note}}.', '["run", "amount", "actor", "note"]')
) AS template (code, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
