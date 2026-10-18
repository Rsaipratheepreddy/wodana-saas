-- Ledger (engine E7, code name `books`): the double-entry core every posting builds on (plan §6.21b).
--   * books_settings: one row per company (legal entity): on or off, start and lock dates, functional currency
--     (fixed once journals exist), fiscal year, the chart template and version applied, tax point and VAT region.
--   * books_accounts, books_account_roles, books_payment_accounts, books_tax_codes: the company's chart, which
--     account plays each posting role, where money comes in and goes out by method, and its tax codes with the
--     return boxes they feed. Configuration: kept by a go-live reset.
--   * books_journals and books_journal_lines: immutable. One journal per source event (UNIQUE source key), numbered
--     gap-free from the company's JOURNAL sequence; every journal balances (Σdebit = Σcredit = total), checked by
--     a deferred trigger at commit; every line is a debit or a credit, never both.
--   * books_posting_issues: why a source event could not post yet (missing rate, account, tax code...).
--   * books_manual_journals and lines: drafts a preparer submits and someone else approves before they post.
--   * books_bill_captures: a photographed or uploaded supplier bill, its AI reading (an immutable snapshot) and
--     the draft bill a person confirms.
--   * Supplier bill lines gain a tax code and an account; supplier payments gain the account they were paid from.
-- Every table has workspace_id, forced RLS with tenant_isolation and composite foreign keys with workspace_id.
-- Never disables RLS.

-- 1. Settings, one row per company.
CREATE TABLE books_settings (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  legal_entity_id uuid NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  start_date date NOT NULL,
  lock_date date,
  functional_currency char(3) NOT NULL CHECK (functional_currency ~ '^[A-Z]{3}$'),
  fiscal_year_start_month smallint NOT NULL DEFAULT 1 CHECK (fiscal_year_start_month BETWEEN 1 AND 12),
  template_code varchar(40),
  template_version integer CHECK (template_version IS NULL OR template_version > 0),
  revenue_recognition varchar(20) NOT NULL DEFAULT 'invoice' CHECK (revenue_recognition IN ('invoice')),
  tax_point_on_payment boolean NOT NULL DEFAULT false,
  vat_region varchar(40) CHECK (vat_region IS NULL OR vat_region ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$'),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, legal_entity_id),
  FOREIGN KEY (workspace_id, legal_entity_id) REFERENCES legal_entities (workspace_id, id),
  CHECK ((template_code IS NULL) = (template_version IS NULL))
);
--> statement-breakpoint
CREATE INDEX books_settings_enabled_idx ON books_settings (workspace_id) WHERE enabled;
--> statement-breakpoint
-- 2. The chart of accounts. Codes are unique per company; an account that has been used is archived, never deleted
--    (the journal lines' foreign key refuses the delete).
CREATE TABLE books_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  legal_entity_id uuid NOT NULL,
  code varchar(20) NOT NULL CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$'),
  name varchar(160) NOT NULL CHECK (length(btrim(name)) > 0),
  type varchar(10) NOT NULL CHECK (type IN ('asset', 'liability', 'equity', 'income', 'expense')),
  subtype varchar(40) NOT NULL DEFAULT '' CHECK (subtype ~ '^[a-z0-9_]{0,40}$'),
  parent_id uuid,
  is_control boolean NOT NULL DEFAULT false,
  currency char(3) CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  allow_manual boolean NOT NULL DEFAULT true,
  template_key varchar(60) CHECK (template_key IS NULL OR template_key ~ '^[a-z][a-z0-9_]{0,59}$'),
  archived_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid REFERENCES users (id),
  updated_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, legal_entity_id, id),
  UNIQUE (workspace_id, legal_entity_id, code),
  FOREIGN KEY (workspace_id, legal_entity_id) REFERENCES books_settings (workspace_id, legal_entity_id),
  FOREIGN KEY (workspace_id, legal_entity_id, parent_id) REFERENCES books_accounts (workspace_id, legal_entity_id, id),
  CHECK (parent_id IS NULL OR parent_id <> id),
  -- A control account (receivables, payables) is posted only by its sub-ledger, never by hand.
  CHECK (NOT (is_control AND allow_manual))
);
--> statement-breakpoint
CREATE UNIQUE INDEX books_accounts_template_key_uidx ON books_accounts (workspace_id, legal_entity_id, template_key) WHERE template_key IS NOT NULL;
--> statement-breakpoint
-- 3. Which account plays each posting role (AccountRole in packages/contracts/src/books.ts).
CREATE TABLE books_account_roles (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  legal_entity_id uuid NOT NULL,
  role varchar(40) NOT NULL CHECK (role IN (
    'ar_control', 'ap_control', 'client_advances', 'vat_output', 'vat_input', 'vat_advance_contra', 'grni', 'inventory',
    'stock_in_transit', 'stock_adjustments', 'employee_claims_payable', 'revenue_project', 'revenue_other', 'cost_materials',
    'cost_subcontract', 'cost_labour', 'cost_site_expenses', 'cost_price_variance', 'cost_other', 'cogs_goods', 'general_expense',
    'labour_absorbed', 'fx_gain_loss', 'rounding', 'retained_earnings', 'opening_balance_equity')),
  account_id uuid NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid REFERENCES users (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, legal_entity_id, role),
  FOREIGN KEY (workspace_id, legal_entity_id) REFERENCES books_settings (workspace_id, legal_entity_id),
  FOREIGN KEY (workspace_id, legal_entity_id, account_id) REFERENCES books_accounts (workspace_id, legal_entity_id, id)
);
--> statement-breakpoint
-- 4. Where money comes in (receipts) and goes out (payments) by method.
CREATE TABLE books_payment_accounts (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  legal_entity_id uuid NOT NULL,
  direction varchar(3) NOT NULL CHECK (direction IN ('in', 'out')),
  method varchar(10) NOT NULL CHECK (method IN ('bank', 'cheque', 'cash', 'card', 'other', 'provider')),
  account_id uuid NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid REFERENCES users (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, legal_entity_id, direction, method),
  FOREIGN KEY (workspace_id, legal_entity_id) REFERENCES books_settings (workspace_id, legal_entity_id),
  FOREIGN KEY (workspace_id, legal_entity_id, account_id) REFERENCES books_accounts (workspace_id, legal_entity_id, id)
);
--> statement-breakpoint
-- 5. Tax codes: one row per code, direction (sales or purchases) and effective period. The boxes name the tax
--    return boxes (from the template's report layout) the base and the tax feed; reverse charge and imports also
--    feed an output box. A sales box the layout splits by region (UAE box 1 by emirate) is resolved from the
--    line's tax region.
CREATE TABLE books_tax_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  legal_entity_id uuid NOT NULL,
  code varchar(20) NOT NULL CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$'),
  name varchar(160) NOT NULL CHECK (length(btrim(name)) > 0),
  rate numeric(7, 4) NOT NULL CHECK (rate >= 0 AND rate <= 100),
  treatment varchar(24) NOT NULL CHECK (treatment IN ('standard', 'zero', 'exempt', 'out_of_scope', 'reverse_charge', 'import_reverse_charge')),
  direction varchar(10) NOT NULL CHECK (direction IN ('sales', 'purchases')),
  recoverable boolean NOT NULL DEFAULT false,
  base_box varchar(10) CHECK (base_box IS NULL OR base_box ~ '^[0-9]{1,3}[a-z]?$'),
  tax_box varchar(10) CHECK (tax_box IS NULL OR tax_box ~ '^[0-9]{1,3}[a-z]?$'),
  rc_output_box varchar(10) CHECK (rc_output_box IS NULL OR rc_output_box ~ '^[0-9]{1,3}[a-z]?$'),
  effective_from date NOT NULL,
  effective_to date,
  archived_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, legal_entity_id, id),
  UNIQUE (workspace_id, legal_entity_id, code, direction, effective_from),
  FOREIGN KEY (workspace_id, legal_entity_id) REFERENCES books_settings (workspace_id, legal_entity_id),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  -- Only purchases recover tax; reverse charge and imports post both sides.
  CHECK (NOT recoverable OR direction = 'purchases'),
  CHECK (rc_output_box IS NULL OR treatment IN ('reverse_charge', 'import_reverse_charge')),
  CHECK (treatment NOT IN ('reverse_charge', 'import_reverse_charge') OR direction = 'purchases')
);
--> statement-breakpoint
-- 6. Journals: immutable, one per source event, numbered gap-free from the company's JOURNAL sequence.
CREATE TABLE books_journals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  legal_entity_id uuid NOT NULL,
  number varchar(80) NOT NULL CHECK (length(btrim(number)) > 0),
  journal_date date NOT NULL,
  event_date date NOT NULL,
  -- The event fell on or before the lock date: posted on the first open day instead.
  late boolean NOT NULL DEFAULT false,
  kind varchar(10) NOT NULL CHECK (kind IN ('auto', 'manual', 'opening', 'reversal')),
  source_type varchar(40) NOT NULL CHECK (source_type ~ '^[a-z][a-z0-9_]{0,39}$'),
  source_id varchar(160) NOT NULL CHECK (length(source_id) > 0),
  source_event varchar(40) NOT NULL CHECK (source_event ~ '^[a-z][a-z0-9_]{0,39}$'),
  source_label varchar(240) NOT NULL DEFAULT '',
  source_href varchar(500) NOT NULL DEFAULT '' CHECK (source_href = '' OR source_href ~ '^/'),
  description varchar(500) NOT NULL DEFAULT '',
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  functional_currency char(3) NOT NULL CHECK (functional_currency ~ '^[A-Z]{3}$'),
  rate numeric(24, 12) NOT NULL DEFAULT 1 CHECK (rate > 0),
  -- Σdebit = Σcredit in the functional currency.
  total numeric(20, 4) NOT NULL CHECK (total > 0),
  reverses_journal_id uuid,
  posted_by uuid REFERENCES users (id),
  posted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, legal_entity_id, id),
  CONSTRAINT books_journals_source_key UNIQUE (workspace_id, source_type, source_id, source_event),
  CONSTRAINT books_journals_number_key UNIQUE (workspace_id, legal_entity_id, number),
  FOREIGN KEY (workspace_id, legal_entity_id) REFERENCES books_settings (workspace_id, legal_entity_id),
  FOREIGN KEY (workspace_id, legal_entity_id, reverses_journal_id) REFERENCES books_journals (workspace_id, legal_entity_id, id),
  CHECK ((kind = 'reversal') = (reverses_journal_id IS NOT NULL)),
  CHECK (NOT late OR journal_date > event_date),
  CHECK (currency <> functional_currency OR rate = 1)
);
--> statement-breakpoint
-- A journal is reversed at most once.
CREATE UNIQUE INDEX books_journals_reversal_uidx ON books_journals (workspace_id, reverses_journal_id) WHERE reverses_journal_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX books_journals_date_idx ON books_journals (workspace_id, legal_entity_id, journal_date);
--> statement-breakpoint
-- 7. Journal lines: amounts in the functional currency; the document currency amount beside them.
CREATE TABLE books_journal_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  legal_entity_id uuid NOT NULL,
  journal_id uuid NOT NULL,
  position smallint NOT NULL CHECK (position >= 0),
  account_id uuid NOT NULL,
  debit numeric(20, 4) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit numeric(20, 4) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  doc_amount numeric(20, 4) CHECK (doc_amount IS NULL OR doc_amount >= 0),
  description varchar(500) NOT NULL DEFAULT '',
  -- Dimensions.
  project_id uuid,
  case_id uuid,
  business_unit_id uuid,
  party_type varchar(10) CHECK (party_type IS NULL OR party_type IN ('client', 'vendor', 'employee', 'team')),
  party_id uuid,
  -- Tax: the code, the base it was charged on (functional currency) and the region of supply.
  tax_code_id uuid,
  tax_base numeric(20, 4),
  tax_region varchar(40) CHECK (tax_region IS NULL OR tax_region ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$'),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, journal_id, position),
  FOREIGN KEY (workspace_id, legal_entity_id, journal_id) REFERENCES books_journals (workspace_id, legal_entity_id, id),
  -- The account and tax code belong to the journal's company.
  FOREIGN KEY (workspace_id, legal_entity_id, account_id) REFERENCES books_accounts (workspace_id, legal_entity_id, id),
  FOREIGN KEY (workspace_id, legal_entity_id, tax_code_id) REFERENCES books_tax_codes (workspace_id, legal_entity_id, id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects (workspace_id, id),
  CONSTRAINT books_journal_lines_one_side CHECK ((debit > 0) <> (credit > 0)),
  CHECK ((party_type IS NULL) = (party_id IS NULL))
);
--> statement-breakpoint
CREATE INDEX books_journal_lines_journal_idx ON books_journal_lines (workspace_id, journal_id);
--> statement-breakpoint
CREATE INDEX books_journal_lines_account_idx ON books_journal_lines (workspace_id, account_id);
--> statement-breakpoint
CREATE INDEX books_journal_lines_project_idx ON books_journal_lines (workspace_id, project_id) WHERE project_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX books_journal_lines_party_idx ON books_journal_lines (workspace_id, party_type, party_id) WHERE party_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX books_journal_lines_tax_idx ON books_journal_lines (workspace_id, tax_code_id) WHERE tax_code_id IS NOT NULL;
--> statement-breakpoint
-- Posted journals never change: corrections are reversals.
CREATE FUNCTION books_journal_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'posted % rows never change; post a reversal instead', TG_TABLE_NAME USING ERRCODE = '55000';
END $$;
--> statement-breakpoint
CREATE TRIGGER books_journals_immutable BEFORE UPDATE OR DELETE ON books_journals FOR EACH ROW EXECUTE FUNCTION books_journal_immutable();
--> statement-breakpoint
CREATE TRIGGER books_journal_lines_immutable BEFORE UPDATE OR DELETE ON books_journal_lines FOR EACH ROW EXECUTE FUNCTION books_journal_immutable();
--> statement-breakpoint
-- Every journal balances at commit: at least two lines, Σdebit = Σcredit = the journal's total.
CREATE FUNCTION books_journal_balance_check() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_journal uuid;
  v_total numeric;
  v_debit numeric;
  v_credit numeric;
  v_lines integer;
BEGIN
  IF TG_TABLE_NAME = 'books_journals' THEN
    v_journal := NEW.id;
  ELSE
    v_journal := NEW.journal_id;
  END IF;
  SELECT journal.total INTO v_total FROM books_journals journal WHERE journal.workspace_id = NEW.workspace_id AND journal.id = v_journal;
  SELECT coalesce(sum(line.debit), 0), coalesce(sum(line.credit), 0), count(*) INTO v_debit, v_credit, v_lines
    FROM books_journal_lines line WHERE line.workspace_id = NEW.workspace_id AND line.journal_id = v_journal;
  IF v_lines < 2 OR v_debit <> v_credit OR v_debit <> v_total THEN
    RAISE EXCEPTION 'journal % does not balance (debit %, credit %, total %, lines %)', v_journal, v_debit, v_credit, v_total, v_lines
      USING ERRCODE = '23514', CONSTRAINT = 'books_journal_balanced';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER books_journals_balanced AFTER INSERT ON books_journals
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION books_journal_balance_check();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER books_journal_lines_balanced AFTER INSERT ON books_journal_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION books_journal_balance_check();
--> statement-breakpoint
-- The functional currency is fixed once the company has journals.
CREATE FUNCTION books_settings_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.functional_currency IS DISTINCT FROM OLD.functional_currency AND EXISTS (
    SELECT 1 FROM books_journals journal WHERE journal.workspace_id = OLD.workspace_id AND journal.legal_entity_id = OLD.legal_entity_id) THEN
    RAISE EXCEPTION 'the functional currency is fixed once the company has journals' USING ERRCODE = '55000';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER books_settings_guard BEFORE UPDATE ON books_settings FOR EACH ROW EXECUTE FUNCTION books_settings_guard();
--> statement-breakpoint
-- 8. Posting issues: one open record per source event that could not post, retried by every sweep.
CREATE TABLE books_posting_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  legal_entity_id uuid,
  source_type varchar(40) NOT NULL CHECK (source_type ~ '^[a-z][a-z0-9_]{0,39}$'),
  source_id varchar(160) NOT NULL CHECK (length(source_id) > 0),
  source_event varchar(40) NOT NULL CHECK (source_event ~ '^[a-z][a-z0-9_]{0,39}$'),
  source_label varchar(240) NOT NULL DEFAULT '',
  source_href varchar(500) NOT NULL DEFAULT '' CHECK (source_href = '' OR source_href ~ '^/'),
  event_date date,
  code varchar(30) NOT NULL CHECK (code IN ('missing_rate', 'missing_account', 'unknown_tax', 'no_cost', 'no_entity', 'currency_mismatch',
    'external_invoice', 'entity_not_enabled')),
  detail varchar(1000) NOT NULL DEFAULT '',
  attempts integer NOT NULL DEFAULT 1 CHECK (attempts > 0),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  notified_at timestamptz,
  resolved_at timestamptz,
  UNIQUE (workspace_id, id),
  CONSTRAINT books_posting_issues_source_key UNIQUE (workspace_id, source_type, source_id, source_event),
  FOREIGN KEY (workspace_id, legal_entity_id) REFERENCES legal_entities (workspace_id, id)
);
--> statement-breakpoint
CREATE INDEX books_posting_issues_open_idx ON books_posting_issues (workspace_id, last_seen_at) WHERE resolved_at IS NULL;
--> statement-breakpoint
-- 9. Manual and opening journals: prepared, submitted, approved by someone else (E3), then posted.
CREATE TABLE books_manual_journals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  legal_entity_id uuid NOT NULL,
  reference varchar(40) NOT NULL CHECK (reference ~ '^MJ-[0-9]+$'),
  kind varchar(10) NOT NULL DEFAULT 'manual' CHECK (kind IN ('manual', 'opening')),
  journal_date date NOT NULL,
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  memo varchar(1000) NOT NULL DEFAULT '',
  status varchar(10) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'returned', 'approved', 'cancelled')),
  prepared_by uuid NOT NULL REFERENCES users (id),
  submitted_at timestamptz,
  approval_request_id uuid,
  returned_reason varchar(1000),
  approved_by uuid REFERENCES users (id),
  approved_at timestamptz,
  cancelled_at timestamptz,
  posted_journal_id uuid,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, legal_entity_id, id),
  UNIQUE (workspace_id, reference),
  FOREIGN KEY (workspace_id, legal_entity_id) REFERENCES books_settings (workspace_id, legal_entity_id),
  FOREIGN KEY (workspace_id, legal_entity_id, posted_journal_id) REFERENCES books_journals (workspace_id, legal_entity_id, id),
  -- Nobody approves their own journal.
  CONSTRAINT books_manual_journals_four_eyes CHECK (approved_by IS NULL OR approved_by <> prepared_by),
  CHECK ((status = 'approved') = (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  CHECK (posted_journal_id IS NULL OR status = 'approved')
);
--> statement-breakpoint
CREATE UNIQUE INDEX books_manual_journals_posted_uidx ON books_manual_journals (workspace_id, posted_journal_id) WHERE posted_journal_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE books_manual_journal_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  legal_entity_id uuid NOT NULL,
  manual_journal_id uuid NOT NULL,
  position smallint NOT NULL CHECK (position >= 0),
  account_id uuid NOT NULL,
  debit numeric(20, 4) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit numeric(20, 4) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  description varchar(500) NOT NULL DEFAULT '',
  project_id uuid,
  case_id uuid,
  business_unit_id uuid,
  party_type varchar(10) CHECK (party_type IS NULL OR party_type IN ('client', 'vendor', 'employee', 'team')),
  party_id uuid,
  tax_code_id uuid,
  tax_base numeric(20, 4),
  tax_region varchar(40) CHECK (tax_region IS NULL OR tax_region ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$'),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, manual_journal_id, position),
  FOREIGN KEY (workspace_id, legal_entity_id, manual_journal_id) REFERENCES books_manual_journals (workspace_id, legal_entity_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, legal_entity_id, account_id) REFERENCES books_accounts (workspace_id, legal_entity_id, id),
  FOREIGN KEY (workspace_id, legal_entity_id, tax_code_id) REFERENCES books_tax_codes (workspace_id, legal_entity_id, id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects (workspace_id, id),
  CHECK ((debit > 0) <> (credit > 0)),
  CHECK ((party_type IS NULL) = (party_id IS NULL))
);
--> statement-breakpoint
-- 10. Bill capture: the file, its AI reading (an immutable snapshot once read) and the draft bill it became.
CREATE TABLE books_bill_captures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  legal_entity_id uuid,
  storage_key varchar(1024) NOT NULL CHECK (length(storage_key) > 0),
  file_name varchar(255) NOT NULL DEFAULT '',
  content_type varchar(120) NOT NULL DEFAULT '',
  byte_size bigint CHECK (byte_size IS NULL OR byte_size >= 0),
  sha256 char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  status varchar(10) NOT NULL DEFAULT 'reading' CHECK (status IN ('reading', 'read', 'failed', 'drafted', 'discarded')),
  reading jsonb CHECK (reading IS NULL OR jsonb_typeof(reading) = 'object'),
  model varchar(120),
  confidence numeric(5, 4) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  error varchar(1000),
  matched_vendor_id uuid,
  matched_order_id uuid,
  supplier_invoice_id uuid,
  confirmed_by uuid REFERENCES users (id),
  confirmed_at timestamptz,
  created_by uuid NOT NULL REFERENCES users (id),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, legal_entity_id) REFERENCES legal_entities (workspace_id, id),
  FOREIGN KEY (workspace_id, matched_vendor_id) REFERENCES workspace_vendors (workspace_id, id),
  FOREIGN KEY (workspace_id, matched_order_id) REFERENCES purchase_orders (workspace_id, id),
  FOREIGN KEY (workspace_id, supplier_invoice_id) REFERENCES supplier_invoices (workspace_id, id),
  CHECK (status NOT IN ('read', 'drafted') OR reading IS NOT NULL),
  CHECK (status <> 'drafted' OR supplier_invoice_id IS NOT NULL)
);
--> statement-breakpoint
-- The same file is captured once while its capture is live.
CREATE UNIQUE INDEX books_bill_captures_file_uidx ON books_bill_captures (workspace_id, sha256) WHERE status NOT IN ('discarded', 'failed');
--> statement-breakpoint
CREATE FUNCTION books_bill_capture_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.storage_key IS DISTINCT FROM OLD.storage_key OR NEW.sha256 IS DISTINCT FROM OLD.sha256 OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'a captured file never changes' USING ERRCODE = '55000';
  END IF;
  IF OLD.reading IS NOT NULL AND NEW.reading IS DISTINCT FROM OLD.reading THEN
    RAISE EXCEPTION 'a bill reading is a snapshot and never changes' USING ERRCODE = '55000';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER books_bill_captures_guard BEFORE UPDATE ON books_bill_captures FOR EACH ROW EXECUTE FUNCTION books_bill_capture_guard();
--> statement-breakpoint
-- 11. Bill lines name their tax code and account; supplier payments the account they were paid from.
ALTER TABLE supplier_invoice_lines
  ADD COLUMN tax_code varchar(20) CHECK (tax_code IS NULL OR tax_code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$'),
  ADD COLUMN books_account_id uuid,
  ADD CONSTRAINT supplier_invoice_lines_books_account_fk FOREIGN KEY (workspace_id, books_account_id) REFERENCES books_accounts (workspace_id, id);
--> statement-breakpoint
ALTER TABLE supplier_payments
  ADD COLUMN paid_from_account_id uuid,
  ADD CONSTRAINT supplier_payments_paid_from_account_fk FOREIGN KEY (workspace_id, paid_from_account_id) REFERENCES books_accounts (workspace_id, id);
--> statement-breakpoint
-- 12. Row security, grants and the cross-tenant sweep's list of workspaces.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['books_settings', 'books_accounts', 'books_account_roles', 'books_payment_accounts', 'books_tax_codes', 'books_journals',
                           'books_journal_lines', 'books_posting_issues', 'books_manual_journals', 'books_manual_journal_lines', 'books_bill_captures'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($policy$CREATE POLICY tenant_isolation ON %I
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$, t);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON books_settings, books_accounts, books_account_roles, books_payment_accounts, books_tax_codes,
      books_posting_issues, books_manual_journals, books_bill_captures TO wodana_app;
    -- Unused mappings and draft lines can be removed; posted journals are append-only.
    GRANT DELETE ON books_account_roles, books_payment_accounts, books_manual_journal_lines TO wodana_app;
    GRANT SELECT, INSERT, UPDATE ON books_manual_journal_lines TO wodana_app;
    GRANT SELECT, INSERT ON books_journals, books_journal_lines TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
-- The posting sweep works across workspaces: it lists those with the Ledger on, then works inside each one.
CREATE FUNCTION list_books_workspaces() RETURNS TABLE (workspace_id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT DISTINCT settings.workspace_id FROM books_settings settings WHERE settings.enabled
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION list_books_workspaces() FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT EXECUTE ON FUNCTION list_books_workspaces() TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
-- 13. Templates are setup profiles of kind 'books' (0283).
ALTER TABLE tenant_setup_profiles DROP CONSTRAINT tenant_setup_profiles_kind_check;
--> statement-breakpoint
ALTER TABLE tenant_setup_profiles ADD CONSTRAINT tenant_setup_profiles_kind_check CHECK (kind IN ('region', 'firm_kit', 'plan', 'books'));
--> statement-breakpoint
-- 14. Permissions. Owners and administrators hold every permission; Finance views and posts; the finance approver
--     views and approves (manual journals).
INSERT INTO permissions (code, description) VALUES
  ('books.view', 'See the Ledger: journals, accounts and reports'),
  ('books.post', 'Prepare manual and opening journals and work the Ledger''s attention list'),
  ('books.approve', 'Approve manual and opening journals someone else prepared'),
  ('books.manage', 'Set up the Ledger: chart of accounts, roles, payment accounts, tax codes, start and lock dates')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (workspace_id, role_id, permission_id)
SELECT role.workspace_id, role.id, permission.id
  FROM roles role CROSS JOIN permissions permission
 WHERE role.is_system AND role.code IN ('owner', 'administrator') AND permission.code IN ('books.view', 'books.post', 'books.approve', 'books.manage')
ON CONFLICT (role_id, permission_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (workspace_id, role_id, permission_id)
SELECT role.workspace_id, role.id, permission.id
  FROM roles role CROSS JOIN permissions permission
 WHERE NOT role.is_system AND role.code = 'finance' AND permission.code IN ('books.view', 'books.post')
ON CONFLICT (role_id, permission_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (workspace_id, role_id, permission_id)
SELECT role.workspace_id, role.id, permission.id
  FROM roles role CROSS JOIN permissions permission
 WHERE NOT role.is_system AND role.code = 'finance_approver' AND permission.code IN ('books.view', 'books.approve')
ON CONFLICT (role_id, permission_id) DO NOTHING;
--> statement-breakpoint
-- 15. Go-live reset: configuration stays, journals and everything posted or captured is cleared.
INSERT INTO workspace_record_classification (table_name, disposition, clear_predicate, file_columns) VALUES
  ('books_settings', 'keep', NULL, '{}'),
  ('books_accounts', 'keep', NULL, '{}'),
  ('books_account_roles', 'keep', NULL, '{}'),
  ('books_payment_accounts', 'keep', NULL, '{}'),
  ('books_tax_codes', 'keep', NULL, '{}'),
  ('books_journals', 'clear', NULL, '{}'),
  ('books_journal_lines', 'clear', NULL, '{}'),
  ('books_posting_issues', 'clear', NULL, '{}'),
  ('books_manual_journals', 'clear', NULL, '{}'),
  ('books_manual_journal_lines', 'clear', NULL, '{}'),
  ('books_bill_captures', 'clear', NULL, ARRAY['storage_key'])
ON CONFLICT (table_name) DO UPDATE SET disposition = excluded.disposition,
  clear_predicate = excluded.clear_predicate, file_columns = excluded.file_columns;
