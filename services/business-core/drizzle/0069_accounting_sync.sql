-- Accounting sync. Each company can post to one accounting connection (QuickBooks or Zoho Books) from a start
-- date: tax invoices, credit notes, client payments on invoiced milestones, approved supplier bills, and
-- supplier payments (each allocation, and a void when it's reversed). Wodana stays the source of truth: a
-- posting is an outbox row the integration worker leases, sends and reports back. Contacts are mapped once
-- (or created); tax rates map to the provider's tax codes; a rate with no mapping blocks the posting rather
-- than posting the wrong tax. A provider total that differs from Wodana's is flagged.
CREATE TABLE accounting_links (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  legal_entity_id uuid NOT NULL,
  connection_id uuid NOT NULL REFERENCES integration_connections (id),
  start_date date NOT NULL,
  sales_item_id varchar(120),
  expense_account_id varchar(120),
  payments_account_id varchar(120),
  deposit_account_id varchar(120),
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid NOT NULL REFERENCES users (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, legal_entity_id),
  FOREIGN KEY (workspace_id, legal_entity_id) REFERENCES legal_entities (workspace_id, id)
);
--> statement-breakpoint
CREATE TABLE accounting_tax_codes (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  link_id uuid NOT NULL,
  rate numeric(7, 4) NOT NULL CHECK (rate >= 0 AND rate <= 100),
  provider_tax_id varchar(120) NOT NULL CHECK (length(btrim(provider_tax_id)) > 0),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, link_id, rate),
  FOREIGN KEY (workspace_id, link_id) REFERENCES accounting_links (workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE accounting_contacts (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  link_id uuid NOT NULL,
  kind varchar(10) NOT NULL CHECK (kind IN ('customer', 'vendor')),
  party_id uuid NOT NULL,
  provider_id varchar(120) NOT NULL CHECK (length(btrim(provider_id)) > 0),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, link_id, kind, party_id),
  FOREIGN KEY (workspace_id, link_id) REFERENCES accounting_links (workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE accounting_postings (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  link_id uuid NOT NULL,
  kind varchar(24) NOT NULL CHECK (kind IN ('invoice', 'credit_note', 'invoice_payment', 'bill', 'bill_payment', 'bill_payment_void')),
  source_id varchar(80) NOT NULL,
  depends_on uuid,
  document_date date NOT NULL,
  -- cancelled: its source was undone before it was ever posted (a supplier payment reversed first).
  status varchar(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'blocked', 'cancelled')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_at timestamptz,
  lease_token uuid,
  lease_until timestamptz,
  expected_total numeric(18, 4),
  provider_id varchar(120),
  provider_number varchar(120),
  provider_total numeric(18, 4),
  error_code varchar(40),
  error varchar(500),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, link_id, kind, source_id),
  FOREIGN KEY (workspace_id, link_id) REFERENCES accounting_links (workspace_id, id),
  FOREIGN KEY (workspace_id, depends_on) REFERENCES accounting_postings (workspace_id, id),
  CHECK ((status = 'sent') = (provider_id IS NOT NULL AND sent_at IS NOT NULL)),
  CHECK (status NOT IN ('failed', 'blocked') OR error IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX accounting_postings_due_idx ON accounting_postings (workspace_id, status, next_at);
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['accounting_links', 'accounting_tax_codes', 'accounting_contacts', 'accounting_postings'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($policy$CREATE POLICY tenant_isolation ON %I
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$, t);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON accounting_links, accounting_contacts, accounting_postings TO wodana_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON accounting_tax_codes TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
-- The worker works across workspaces: it lists the ones posting to accounting, then works inside each one.
CREATE FUNCTION list_accounting_workspaces() RETURNS TABLE (workspace_id uuid) LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT DISTINCT link.workspace_id FROM accounting_links link WHERE link.active
$$;
--> statement-breakpoint
-- A result names its posting and lease; this finds whose workspace it is, only while the lease holds.
CREATE FUNCTION accounting_posting_workspace(p_id uuid, p_lease uuid) RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT workspace_id FROM accounting_postings WHERE id = p_id AND lease_token = p_lease AND lease_until > now()
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION list_accounting_workspaces() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION accounting_posting_workspace(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT EXECUTE ON FUNCTION list_accounting_workspaces() TO wodana_app;
    GRANT EXECUTE ON FUNCTION accounting_posting_workspace(uuid, uuid) TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO permissions (code, description) VALUES
  ('accounting.manage', 'Choose where each company posts to accounting, map its accounts and tax codes, and retry postings')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (workspace_id, role_id, permission_id)
SELECT role.workspace_id, role.id, permission.id
  FROM roles role CROSS JOIN permissions permission
 WHERE role.is_system AND role.code IN ('owner', 'administrator') AND permission.code = 'accounting.manage'
ON CONFLICT (role_id, permission_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, 'accounting.attention', 'in_app', 'en', 1, 'approved', 'Accounting needs attention · {{company}}', '{{note}}', '["company", "note"]'::jsonb, now()
  FROM workspaces workspace
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
