-- Receivables. A tax invoice is issued for a project's payment milestone, numbered by its company's invoice
-- sequence, with the milestone split by the accepted quotation's tax rates and the client and company as they
-- were on the day (a snapshot: later edits never change an issued invoice). An invoice is corrected by
-- crediting it in full with a numbered credit note and issuing it again; price changes go through a
-- variation. What was paid comes from the finance-verified receipts on its milestone.
CREATE TABLE client_invoices (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  legal_entity_id uuid NOT NULL,
  project_id uuid NOT NULL,
  case_id uuid NOT NULL,
  payment_id varchar(80) NOT NULL,
  quote_id varchar(80) NOT NULL,
  number varchar(80) NOT NULL,
  issue_date date NOT NULL,
  due_date date NOT NULL,
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  net numeric(18, 4) NOT NULL,
  tax numeric(18, 4) NOT NULL,
  total numeric(18, 4) NOT NULL CHECK (total > 0),
  prices_include_tax boolean NOT NULL,
  milestone_title varchar(200) NOT NULL,
  customer_name varchar(240) NOT NULL,
  customer_address varchar(1000) NOT NULL DEFAULT '',
  customer_tax_number varchar(80) NOT NULL DEFAULT '',
  company_name varchar(240) NOT NULL,
  company_address varchar(1000) NOT NULL DEFAULT '',
  company_tax_number varchar(80) NOT NULL DEFAULT '',
  note varchar(1000) NOT NULL DEFAULT '',
  status varchar(10) NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'credited')),
  issued_by uuid NOT NULL REFERENCES users (id),
  issued_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, legal_entity_id) REFERENCES legal_entities (workspace_id, id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects (workspace_id, id),
  CHECK (due_date >= issue_date),
  CHECK (total = net + tax)
);
--> statement-breakpoint
-- A number is used once per company; a milestone has at most one live invoice.
CREATE UNIQUE INDEX client_invoices_number_key ON client_invoices (workspace_id, legal_entity_id, number);
--> statement-breakpoint
CREATE UNIQUE INDEX client_invoices_live_key ON client_invoices (workspace_id, case_id, payment_id) WHERE status = 'issued';
--> statement-breakpoint
CREATE INDEX client_invoices_project_idx ON client_invoices (workspace_id, project_id);
--> statement-breakpoint
CREATE TABLE client_invoice_lines (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  position integer NOT NULL,
  description varchar(500) NOT NULL,
  tax_rate numeric(7, 4) NOT NULL CHECK (tax_rate >= 0 AND tax_rate <= 100),
  net numeric(18, 4) NOT NULL,
  tax numeric(18, 4) NOT NULL,
  total numeric(18, 4) NOT NULL,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, invoice_id) REFERENCES client_invoices (workspace_id, id),
  CHECK (total = net + tax)
);
--> statement-breakpoint
CREATE TABLE client_credit_notes (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  legal_entity_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  number varchar(80) NOT NULL,
  issue_date date NOT NULL,
  currency char(3) NOT NULL,
  net numeric(18, 4) NOT NULL,
  tax numeric(18, 4) NOT NULL,
  total numeric(18, 4) NOT NULL CHECK (total > 0),
  reason varchar(1000) NOT NULL CHECK (length(btrim(reason)) > 0),
  issued_by uuid NOT NULL REFERENCES users (id),
  issued_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  -- Credited in full, once.
  UNIQUE (workspace_id, invoice_id),
  FOREIGN KEY (workspace_id, legal_entity_id) REFERENCES legal_entities (workspace_id, id),
  FOREIGN KEY (workspace_id, invoice_id) REFERENCES client_invoices (workspace_id, id),
  CHECK (total = net + tax)
);
--> statement-breakpoint
CREATE UNIQUE INDEX client_credit_notes_number_key ON client_credit_notes (workspace_id, legal_entity_id, number);
--> statement-breakpoint
-- Issued documents never change: an invoice only moves from issued to credited; lines and credit notes are fixed.
CREATE FUNCTION client_invoice_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'issued % records are never deleted', TG_TABLE_NAME; END IF;
  IF TG_TABLE_NAME = 'client_invoices' THEN
    IF OLD.status <> 'issued' OR NEW.status <> 'credited' OR (to_jsonb(NEW) - ARRAY['status', 'version']) <> (to_jsonb(OLD) - ARRAY['status', 'version']) THEN
      RAISE EXCEPTION 'an issued invoice only changes by being credited';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% rows are fixed once written', TG_TABLE_NAME;
END $$;
--> statement-breakpoint
CREATE TRIGGER client_invoices_guard BEFORE UPDATE OR DELETE ON client_invoices FOR EACH ROW EXECUTE FUNCTION client_invoice_guard();
--> statement-breakpoint
CREATE TRIGGER client_invoice_lines_guard BEFORE UPDATE OR DELETE ON client_invoice_lines FOR EACH ROW EXECUTE FUNCTION client_invoice_guard();
--> statement-breakpoint
CREATE TRIGGER client_credit_notes_guard BEFORE UPDATE OR DELETE ON client_credit_notes FOR EACH ROW EXECUTE FUNCTION client_invoice_guard();
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['client_invoices', 'client_invoice_lines', 'client_credit_notes'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($policy$CREATE POLICY tenant_isolation ON %I
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$, t);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON client_invoices TO wodana_app;
    GRANT SELECT, INSERT ON client_invoice_lines, client_credit_notes TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO permissions (code, description) VALUES
  ('receivables.view', 'See tax invoices, credit notes and what clients owe'),
  ('receivables.manage', 'Issue tax invoices to clients and credit them')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (workspace_id, role_id, permission_id)
SELECT role.workspace_id, role.id, permission.id
  FROM roles role CROSS JOIN permissions permission
 WHERE role.is_system AND role.code IN ('owner', 'administrator') AND permission.code IN ('receivables.view', 'receivables.manage')
ON CONFLICT (role_id, permission_id) DO NOTHING;
--> statement-breakpoint
-- Credit note numbering per company, like the other documents (the prefix can be changed in Settings).
INSERT INTO document_sequences (workspace_id, legal_entity_id, document_type, prefix)
SELECT entity.workspace_id, entity.id, 'CREDIT_NOTE', entity.code || '-CN-{YYYY}-' FROM legal_entities entity
ON CONFLICT (legal_entity_id, document_type) DO NOTHING;
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, 'in_app', 'en', 1, 'approved', template.subject, '{{note}}', '["invoice", "client", "amount", "actor", "note"]'::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('receivables.overdue', 'Client invoice overdue: {{invoice}}'),
  ('receivables.credited', 'Invoice credited: {{invoice}}')
) AS template (code, subject)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
