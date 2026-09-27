-- Supplier controls: documents with expiry (an expired required one puts the supplier on hold),
-- bank accounts changed only after a call-back to a known number and a second person's approval,
-- and open orders with a supplier that goes on hold waiting for someone to say they continue.
CREATE TABLE vendor_documents (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  vendor_id uuid NOT NULL,
  kind varchar(20) NOT NULL CHECK (kind IN ('trade_licence', 'tax_certificate', 'insurance', 'bank_letter', 'other')),
  label varchar(120) NOT NULL DEFAULT '',
  number varchar(120) NOT NULL DEFAULT '',
  expires_on date,
  required boolean NOT NULL DEFAULT false,
  original_name varchar(240),
  mime_type varchar(80),
  byte_size integer CHECK (byte_size IS NULL OR byte_size > 0),
  object_key varchar(300),
  sha256 char(64),
  replaced_at timestamptz,
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, vendor_id) REFERENCES workspace_vendors (workspace_id, id),
  CHECK (kind <> 'other' OR length(btrim(label)) > 0),
  CHECK ((object_key IS NULL) = (sha256 IS NULL))
);
--> statement-breakpoint
CREATE INDEX vendor_documents_vendor_idx ON vendor_documents (workspace_id, vendor_id) WHERE replaced_at IS NULL;
--> statement-breakpoint
CREATE TABLE vendor_bank_accounts (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  vendor_id uuid NOT NULL,
  account_name varchar(200) NOT NULL CHECK (length(btrim(account_name)) > 0),
  bank_name varchar(200) NOT NULL CHECK (length(btrim(bank_name)) > 0),
  account_number varchar(60) NOT NULL CHECK (length(btrim(account_number)) > 0),
  swift varchar(20) NOT NULL DEFAULT '',
  currency char(3),
  -- How the details reached the firm; an email is the classic fraud route.
  source varchar(20) NOT NULL CHECK (source IN ('supplier_letter', 'email', 'in_person', 'phone')),
  status varchar(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'retired')),
  requested_by uuid NOT NULL REFERENCES users (id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  callback_by uuid REFERENCES users (id),
  callback_at timestamptz,
  callback_note varchar(500) NOT NULL DEFAULT '',
  decided_by uuid REFERENCES users (id),
  decided_at timestamptz,
  reject_reason varchar(500),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, vendor_id) REFERENCES workspace_vendors (workspace_id, id),
  CHECK ((callback_by IS NULL) = (callback_at IS NULL) AND (callback_by IS NULL OR length(btrim(callback_note)) > 0)),
  CHECK (status NOT IN ('approved', 'retired') OR (callback_by IS NOT NULL AND decided_by IS NOT NULL AND decided_by <> requested_by)),
  CHECK (status <> 'rejected' OR (decided_by IS NOT NULL AND length(btrim(reject_reason)) > 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX vendor_bank_accounts_one_approved ON vendor_bank_accounts (workspace_id, vendor_id) WHERE status = 'approved';
--> statement-breakpoint
ALTER TABLE purchase_orders
  ADD COLUMN continue_on_hold_by uuid REFERENCES users (id),
  ADD COLUMN continue_on_hold_at timestamptz,
  ADD COLUMN continue_on_hold_note varchar(500),
  ADD CONSTRAINT purchase_orders_continue_check CHECK ((continue_on_hold_by IS NULL) = (continue_on_hold_at IS NULL));
--> statement-breakpoint
DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['vendor_documents', 'vendor_bank_accounts'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', name);
    EXECUTE format($policy$CREATE POLICY tenant_isolation ON %I
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$, name);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON vendor_documents, vendor_bank_accounts TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, 'in_app', 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('supplier.on_hold', '{{supplier}} is on hold', '{{note}}', '["supplier", "actor", "note"]'),
  ('supplier.document_expiring', '{{supplier}}: {{note}}', 'Ask the supplier for the new one.', '["supplier", "actor", "note"]'),
  ('supplier.bank_change', 'New bank details for {{supplier}}', '{{actor}} recorded them ({{note}}). Call the supplier on a number you already have before approving.', '["supplier", "actor", "note"]')
) AS template (code, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
