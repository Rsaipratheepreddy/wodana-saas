-- Finance requests (PLM-107–110, 113): staff ask Finance for an invoice to a client, a refund to a client or a
-- payment to a supplier, from the client, deal or project where they are, instead of over WhatsApp.
--   * finance_requests: one row per request (FR-n per workspace), its kind's fields as columns. Status moves
--     new → in_progress → needs_info (back to the requester with a note) → done | rejected, by Finance only.
--     Amounts are numeric; an invoice is tax-exclusive (net, the issuing company's rate, tax, total).
--   * finance_request_lines: an invoice's lines (typed, from a quote, or a payment stage) and a refund's items.
--   * finance_request_files: the quote or BOQ, the supplier's tax invoice, a proof.
--   * finance_request_events: what happened, for the requester and Finance (status, notes to the requester).
--   * finance_request_settings: the finance inbox every submission is emailed to (unset until the firm enters
--     it), the expected refund days (unset: not shown) and whether a reached payment stage raises its invoice
--     request automatically (off).
--   * finance_payment_methods: the firm's payment methods, each with the refund guidance shown to the requester
--     and whether a refund needs the client's bank details.
-- Refunds and payables are approved through the E3 approval engine (kinds `refund` and `payable_request`).
-- Permissions: finance_requests.raise (staff ask) and finance_requests.manage (Finance works the board).
CREATE TABLE finance_request_settings (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces (id),
  finance_inbox varchar(320) CHECK (finance_inbox IS NULL OR finance_inbox ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  refund_days integer CHECK (refund_days IS NULL OR refund_days BETWEEN 1 AND 365),
  stage_invoice_requests boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid REFERENCES users (id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE finance_payment_methods (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  label varchar(80) NOT NULL CHECK (length(btrim(label)) > 0),
  refund_guidance varchar(1000) NOT NULL DEFAULT '',
  needs_bank_details boolean NOT NULL DEFAULT false,
  position integer NOT NULL DEFAULT 0,
  archived_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (workspace_id, id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX finance_payment_methods_label_key ON finance_payment_methods (workspace_id, lower(btrim(label))) WHERE archived_at IS NULL;
--> statement-breakpoint
CREATE TABLE finance_requests (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  number integer NOT NULL CHECK (number > 0),
  kind varchar(8) NOT NULL CHECK (kind IN ('invoice', 'refund', 'payable')),
  status varchar(12) NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'needs_info', 'done', 'rejected')),
  -- manual: a person raised it; stage: a reached payment stage raised it (the salesperson is its requester).
  source varchar(8) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'stage')),
  requested_by uuid NOT NULL REFERENCES users (id),
  party_id uuid REFERENCES crm_parties (id),
  opportunity_id uuid REFERENCES crm_opportunities (id),
  project_id uuid,
  vendor_id uuid,
  salesperson_id uuid REFERENCES users (id),
  legal_entity_id uuid,
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  client_email varchar(320) NOT NULL DEFAULT '',
  client_tax_number varchar(120) NOT NULL DEFAULT '',
  -- Invoice: standard, a QS progress invoice or a web-shop order; lines pulled from a quote or a payment stage.
  invoice_kind varchar(10) CHECK (invoice_kind IN ('standard', 'progress', 'web_order')),
  case_id uuid,
  quote_id text,
  payment_stage_id varchar(80),
  payment_stage_title varchar(200) NOT NULL DEFAULT '',
  payment_terms varchar(1000) NOT NULL DEFAULT '',
  contract_reference varchar(200) NOT NULL DEFAULT '',
  order_number varchar(80) NOT NULL DEFAULT '',
  order_gross numeric(18, 4) CHECK (order_gross IS NULL OR order_gross > 0),
  payment_method_id uuid,
  payment_method varchar(80) NOT NULL DEFAULT '',
  tax_code varchar(40) NOT NULL DEFAULT '',
  tax_label varchar(80) NOT NULL DEFAULT '',
  tax_rate numeric(7, 4) CHECK (tax_rate IS NULL OR (tax_rate >= 0 AND tax_rate <= 100)),
  net_amount numeric(18, 4) CHECK (net_amount IS NULL OR net_amount >= 0),
  tax_amount numeric(18, 4) CHECK (tax_amount IS NULL OR tax_amount >= 0),
  -- The invoice's total, the refund's value, or the supplier's full amount.
  total_amount numeric(18, 4) NOT NULL CHECK (total_amount > 0),
  -- Refund: the client's invoice and why; the bank details only when the method needs them (Finance only).
  invoice_number varchar(80) NOT NULL DEFAULT '',
  reason varchar(2000) NOT NULL DEFAULT '',
  bank_details varchar(1000) NOT NULL DEFAULT '',
  -- Payable: the supplier's quote or invoice, what to pay now, who checked it, where the material goes.
  supplier_reference varchar(120) NOT NULL DEFAULT '',
  pay_now_amount numeric(18, 4) CHECK (pay_now_amount IS NULL OR pay_now_amount > 0),
  authorised_by uuid REFERENCES users (id),
  material_location varchar(8) CHECK (material_location IN ('factory', 'office', 'project')),
  supplier_tax_number varchar(120) NOT NULL DEFAULT '',
  paid_on_statement boolean NOT NULL DEFAULT false,
  statement_amount numeric(18, 4) CHECK (statement_amount IS NULL OR statement_amount >= 0),
  statement_checked_at timestamptz,
  statement_checked_by uuid REFERENCES users (id),
  remarks varchar(2000) NOT NULL DEFAULT '',
  -- Finance's own: the accounting reference (e.g. the QuickBooks invoice number) and notes nobody else reads.
  finance_reference varchar(120) NOT NULL DEFAULT '',
  internal_note varchar(4000) NOT NULL DEFAULT '',
  handled_by uuid REFERENCES users (id),
  closed_by uuid REFERENCES users (id),
  closed_at timestamptz,
  close_note varchar(1000) NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, number),
  FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects (workspace_id, id),
  FOREIGN KEY (workspace_id, vendor_id) REFERENCES workspace_vendors (workspace_id, id),
  FOREIGN KEY (workspace_id, legal_entity_id) REFERENCES legal_entities (workspace_id, id),
  FOREIGN KEY (workspace_id, payment_method_id) REFERENCES finance_payment_methods (workspace_id, id),
  -- An invoice or a refund is for a client; a payable is to a supplier.
  CHECK (kind = 'payable' OR party_id IS NOT NULL),
  CHECK (kind <> 'payable' OR vendor_id IS NOT NULL),
  -- An invoice names its issuing company and kind, and is tax-exclusive: total = net + tax at the stated rate.
  CHECK (kind <> 'invoice' OR (legal_entity_id IS NOT NULL AND invoice_kind IS NOT NULL AND tax_rate IS NOT NULL AND net_amount IS NOT NULL
    AND tax_amount IS NOT NULL AND total_amount = net_amount + tax_amount)),
  -- A person's invoice request carries the client's email (the accounting system sends the invoice to it).
  CHECK (kind <> 'invoice' OR source = 'stage' OR length(btrim(client_email)) > 0),
  CHECK (kind <> 'refund' OR length(btrim(reason)) > 0),
  CHECK (kind <> 'payable' OR (pay_now_amount IS NOT NULL AND pay_now_amount <= total_amount AND material_location IS NOT NULL)),
  CHECK (material_location IS DISTINCT FROM 'project' OR project_id IS NOT NULL),
  CHECK ((statement_checked_at IS NULL) = (statement_checked_by IS NULL)),
  -- Closed by Finance (never the requester's own Done), with why when rejected.
  CHECK ((status IN ('done', 'rejected')) = (closed_at IS NOT NULL AND closed_by IS NOT NULL)),
  CHECK (status <> 'rejected' OR length(btrim(close_note)) > 0)
);
--> statement-breakpoint
CREATE INDEX finance_requests_board_idx ON finance_requests (workspace_id, status, created_at DESC);
--> statement-breakpoint
CREATE INDEX finance_requests_requester_idx ON finance_requests (workspace_id, requested_by, created_at DESC);
--> statement-breakpoint
CREATE INDEX finance_requests_project_idx ON finance_requests (workspace_id, project_id) WHERE project_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX finance_requests_opportunity_idx ON finance_requests (workspace_id, opportunity_id) WHERE opportunity_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX finance_requests_party_idx ON finance_requests (workspace_id, party_id) WHERE party_id IS NOT NULL;
--> statement-breakpoint
-- A payment stage raises its invoice request once, however often the daily run passes.
CREATE UNIQUE INDEX finance_requests_stage_key ON finance_requests (workspace_id, case_id, payment_stage_id) WHERE source = 'stage';
--> statement-breakpoint
CREATE TRIGGER finance_requests_party_id_workspace_guard BEFORE INSERT OR UPDATE ON finance_requests
  FOR EACH ROW EXECUTE FUNCTION enforce_same_workspace_reference('crm_parties', 'party_id');
--> statement-breakpoint
CREATE TRIGGER finance_requests_opportunity_id_workspace_guard BEFORE INSERT OR UPDATE ON finance_requests
  FOR EACH ROW EXECUTE FUNCTION enforce_same_workspace_reference('crm_opportunities', 'opportunity_id');
--> statement-breakpoint
CREATE TABLE finance_request_lines (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  request_id uuid NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  description varchar(500) NOT NULL CHECK (length(btrim(description)) > 0),
  quantity numeric(18, 4) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price numeric(18, 4) NOT NULL,
  amount numeric(18, 4) NOT NULL,
  UNIQUE (workspace_id, request_id, position),
  FOREIGN KEY (workspace_id, request_id) REFERENCES finance_requests (workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE finance_request_files (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  request_id uuid NOT NULL,
  kind varchar(12) NOT NULL CHECK (kind IN ('quote', 'tax_invoice', 'proof', 'other')),
  name varchar(255) NOT NULL,
  content_type varchar(100) NOT NULL,
  storage_key varchar(500) NOT NULL,
  sha256 char(64) NOT NULL,
  uploaded_by uuid NOT NULL REFERENCES users (id),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, request_id, kind, sha256),
  FOREIGN KEY (workspace_id, request_id) REFERENCES finance_requests (workspace_id, id)
);
--> statement-breakpoint
CREATE TABLE finance_request_events (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  request_id uuid NOT NULL,
  kind varchar(16) NOT NULL CHECK (kind IN ('submitted', 'resubmitted', 'status', 'needs_info', 'approval', 'done', 'rejected', 'file')),
  from_status varchar(12),
  to_status varchar(12),
  note varchar(2000) NOT NULL DEFAULT '',
  actor_id uuid REFERENCES users (id),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, request_id) REFERENCES finance_requests (workspace_id, id)
);
--> statement-breakpoint
CREATE INDEX finance_request_events_request_idx ON finance_request_events (workspace_id, request_id, occurred_at);
--> statement-breakpoint
CREATE TABLE finance_request_commands (
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
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['finance_request_settings', 'finance_payment_methods', 'finance_requests', 'finance_request_lines', 'finance_request_files',
    'finance_request_events', 'finance_request_commands'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($policy$CREATE POLICY tenant_isolation ON %I
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$, t);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON finance_request_settings, finance_payment_methods, finance_requests TO wodana_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON finance_request_lines TO wodana_app;
    GRANT SELECT, INSERT ON finance_request_files, finance_request_events, finance_request_commands TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO permissions (code, description) VALUES
  ('finance_requests.raise', 'Ask Finance for an invoice, a refund or a supplier payment'),
  ('finance_requests.manage', 'Work the Finance requests board: status, notes to the requester, references and settings')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
-- Owners and administrators hold both, like every permission.
INSERT INTO role_permissions (workspace_id, role_id, permission_id)
SELECT role.workspace_id, role.id, permission.id
  FROM roles role CROSS JOIN permissions permission
 WHERE role.is_system AND role.code IN ('owner', 'administrator') AND permission.code IN ('finance_requests.raise', 'finance_requests.manage')
ON CONFLICT (role_id, permission_id) DO NOTHING;
--> statement-breakpoint
-- Finance works the board: roles that enter supplier invoices or issue client invoices.
INSERT INTO role_permissions (workspace_id, role_id, permission_id)
SELECT role.workspace_id, role.id, permission.id
  FROM roles role CROSS JOIN permissions permission
 WHERE NOT role.is_system AND permission.code IN ('finance_requests.raise', 'finance_requests.manage')
   AND EXISTS (SELECT 1 FROM role_permissions held JOIN permissions finance ON finance.id = held.permission_id
                WHERE held.role_id = role.id AND finance.code IN ('payables.manage', 'receivables.manage'))
ON CONFLICT (role_id, permission_id) DO NOTHING;
--> statement-breakpoint
-- Staff raise requests: sales, QS, project managers, buyers and whoever verifies deal payments.
INSERT INTO role_permissions (workspace_id, role_id, permission_id)
SELECT role.workspace_id, role.id, permission.id
  FROM roles role CROSS JOIN permissions permission
 WHERE NOT role.is_system AND permission.code = 'finance_requests.raise'
   AND EXISTS (SELECT 1 FROM role_permissions held JOIN permissions staff ON staff.id = held.permission_id
                WHERE held.role_id = role.id AND staff.code IN ('crm.opportunities.manage', 'commercial.estimate', 'projects.manage', 'purchasing.manage',
                  'commercial.finance.verify'))
ON CONFLICT (role_id, permission_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body,
  '["reference", "kind", "client", "amount", "project", "actor", "note"]'::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('finance_request.submitted', 'in_app', '{{kind}} request {{reference}} · {{client}}', '{{actor}} asks for {{amount}}. {{note}}'),
  ('finance_request.submitted', 'email', '{{kind}} request {{reference}} · {{client}}', '{{actor}} asks Finance for {{amount}}.

{{project}}

{{note}}'),
  ('finance_request.answered', 'in_app', '{{reference}} is back with you', '{{actor}}: {{note}}'),
  ('finance_request.needs_info', 'in_app', 'Finance needs more on {{reference}}', '{{actor}}: {{note}}'),
  ('finance_request.needs_info', 'email', 'Finance needs more on {{reference}}', '{{actor}} sent your {{kind}} request for {{client}} back: {{note}}

Open it to add what is missing and send it again.'),
  ('finance_request.approved', 'in_app', '{{reference}} is approved', '{{kind}} for {{client}}, {{amount}}: ready to process.'),
  ('finance_request.done', 'in_app', '{{reference}} is done', '{{kind}} for {{client}}, {{amount}}. {{note}}'),
  ('finance_request.done', 'email', '{{reference}} is done', '{{actor}} completed the {{kind}} request for {{client}} ({{amount}}).

{{note}}'),
  ('finance_request.rejected', 'in_app', '{{reference}} was rejected', '{{actor}}: {{note}}'),
  ('finance_request.rejected', 'email', '{{reference}} was rejected', '{{actor}} rejected the {{kind}} request for {{client}}: {{note}}')
) AS template (code, channel, subject, body)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
