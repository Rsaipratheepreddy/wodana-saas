-- v2 commercial money: payment requests, receipts, allocations and the current Deal File become
-- relational rows with numeric amounts and database-enforced links. commercial_case_save() and
-- commercial_cases_view are extended; the document may no longer hold these keys.
CREATE TABLE commercial_payments (
  workspace_id uuid NOT NULL,
  case_id uuid NOT NULL,
  id text NOT NULL,
  sort_order integer NOT NULL,
  title text NOT NULL,
  amount numeric NOT NULL CHECK (amount >= 0),
  currency text,
  due_date date,
  status text NOT NULL CHECK (status IN ('pending', 'proof_submitted', 'verified')),
  required_for_release boolean NOT NULL DEFAULT false,
  required_for_production boolean,
  source_quote_id text,
  legal_entity_id text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (case_id, id),
  UNIQUE (workspace_id, case_id, id),
  FOREIGN KEY (workspace_id, case_id) REFERENCES pre_project_cases (workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE commercial_receipts (
  workspace_id uuid NOT NULL,
  case_id uuid NOT NULL,
  id text NOT NULL,
  sort_order integer NOT NULL,
  payment_id text NOT NULL,
  legal_entity_id text NOT NULL,
  currency text NOT NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  source text NOT NULL CHECK (source IN ('provider', 'manual')),
  status text NOT NULL CHECK (status IN ('reported', 'provider_confirmed', 'finance_verified', 'rejected')),
  reference text NOT NULL DEFAULT '',
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (case_id, id),
  UNIQUE (workspace_id, case_id, id),
  FOREIGN KEY (workspace_id, case_id, payment_id) REFERENCES commercial_payments (workspace_id, case_id, id) DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE INDEX commercial_receipts_workspace_status_idx ON commercial_receipts (workspace_id, status);
--> statement-breakpoint
CREATE TABLE commercial_allocations (
  workspace_id uuid NOT NULL,
  case_id uuid NOT NULL,
  id text NOT NULL,
  sort_order integer NOT NULL,
  receipt_id text NOT NULL,
  payment_id text NOT NULL,
  legal_entity_id text NOT NULL,
  currency text NOT NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (case_id, id),
  FOREIGN KEY (workspace_id, case_id, receipt_id) REFERENCES commercial_receipts (workspace_id, case_id, id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (workspace_id, case_id, payment_id) REFERENCES commercial_payments (workspace_id, case_id, id) DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
-- The current Deal File of a case. One per case; a reference and revision are unique per workspace.
CREATE TABLE commercial_deal_files (
  workspace_id uuid NOT NULL,
  case_id uuid NOT NULL PRIMARY KEY,
  id text NOT NULL,
  reference text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  quote_id text NOT NULL,
  quote_hash text NOT NULL,
  value numeric NOT NULL,
  cost numeric NOT NULL,
  margin numeric NOT NULL,
  commission numeric NOT NULL DEFAULT 0,
  status text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (workspace_id, reference, revision),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, case_id) REFERENCES pre_project_cases (workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE commercial_payments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commercial_payments FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON commercial_payments
  USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE commercial_receipts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commercial_receipts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON commercial_receipts
  USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE commercial_allocations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commercial_allocations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON commercial_allocations
  USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE commercial_deal_files ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commercial_deal_files FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON commercial_deal_files
  USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
--> statement-breakpoint
CREATE FUNCTION commercial_money_json(p_workspace_id uuid, p_case_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'payments', coalesce((SELECT jsonb_agg(payment.detail || jsonb_build_object(
        'id', payment.id, 'title', payment.title, 'amount', payment.amount,
        'dueDate', coalesce(payment.due_date::text, ''), 'status', payment.status,
        'requiredForRelease', payment.required_for_release)
        || jsonb_strip_nulls(jsonb_build_object('currency', payment.currency, 'requiredForProduction', payment.required_for_production,
          'sourceQuoteId', payment.source_quote_id, 'legalEntityId', payment.legal_entity_id))
        ORDER BY payment.sort_order)
      FROM commercial_payments payment WHERE payment.workspace_id = p_workspace_id AND payment.case_id = p_case_id), '[]'::jsonb),
    'receipts', coalesce((SELECT jsonb_agg(receipt.detail || jsonb_build_object(
        'id', receipt.id, 'paymentId', receipt.payment_id, 'legalEntityId', receipt.legal_entity_id,
        'currency', receipt.currency, 'amount', receipt.amount, 'source', receipt.source,
        'status', receipt.status, 'reference', receipt.reference)
        ORDER BY receipt.sort_order)
      FROM commercial_receipts receipt WHERE receipt.workspace_id = p_workspace_id AND receipt.case_id = p_case_id), '[]'::jsonb),
    'allocations', coalesce((SELECT jsonb_agg(allocation.detail || jsonb_build_object(
        'id', allocation.id, 'receiptId', allocation.receipt_id, 'paymentId', allocation.payment_id,
        'legalEntityId', allocation.legal_entity_id, 'currency', allocation.currency, 'amount', allocation.amount)
        ORDER BY allocation.sort_order)
      FROM commercial_allocations allocation WHERE allocation.workspace_id = p_workspace_id AND allocation.case_id = p_case_id), '[]'::jsonb),
    'dealFile', (SELECT deal.detail || jsonb_build_object(
        'id', deal.id, 'reference', deal.reference, 'revision', deal.revision, 'quoteId', deal.quote_id,
        'quoteHash', deal.quote_hash, 'value', deal.value, 'cost', deal.cost, 'margin', deal.margin,
        'commission', deal.commission, 'status', deal.status)
      FROM commercial_deal_files deal WHERE deal.workspace_id = p_workspace_id AND deal.case_id = p_case_id)
  );
$$;
--> statement-breakpoint
CREATE OR REPLACE VIEW commercial_cases_view WITH (security_invoker = true) AS
  SELECT commercial.case_id, commercial.workspace_id, commercial.revision, commercial.updated_at,
    commercial.content || jsonb_build_object('quotes', coalesce((
      SELECT jsonb_agg(commercial_quote_json(quote) ORDER BY quote.sort_order)
      FROM commercial_quotes quote
      WHERE quote.workspace_id = commercial.workspace_id AND quote.case_id = commercial.case_id
    ), '[]'::jsonb)) || commercial_money_json(commercial.workspace_id, commercial.case_id) AS content
  FROM commercial_cases commercial;
--> statement-breakpoint
CREATE FUNCTION commercial_money_save(p_workspace_id uuid, p_case_id uuid, p_content jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM commercial_allocations WHERE workspace_id = p_workspace_id AND case_id = p_case_id;
  DELETE FROM commercial_receipts WHERE workspace_id = p_workspace_id AND case_id = p_case_id;
  DELETE FROM commercial_payments WHERE workspace_id = p_workspace_id AND case_id = p_case_id;
  DELETE FROM commercial_deal_files WHERE workspace_id = p_workspace_id AND case_id = p_case_id;

  INSERT INTO commercial_payments(workspace_id, case_id, id, sort_order, title, amount, currency, due_date, status,
    required_for_release, required_for_production, source_quote_id, legal_entity_id, detail)
  SELECT p_workspace_id, p_case_id, payment->>'id', (ordinal - 1)::int, payment->>'title',
    coalesce((payment->>'amount')::numeric, 0), payment->>'currency', nullif(payment->>'dueDate', '')::date,
    payment->>'status', coalesce((payment->>'requiredForRelease')::boolean, false),
    (payment->>'requiredForProduction')::boolean, payment->>'sourceQuoteId', payment->>'legalEntityId',
    payment - ARRAY['id','title','amount','currency','dueDate','status','requiredForRelease','requiredForProduction','sourceQuoteId','legalEntityId']
  FROM jsonb_array_elements(coalesce(p_content->'payments', '[]'::jsonb)) WITH ORDINALITY AS item(payment, ordinal);

  INSERT INTO commercial_receipts(workspace_id, case_id, id, sort_order, payment_id, legal_entity_id, currency, amount,
    source, status, reference, detail)
  SELECT p_workspace_id, p_case_id, receipt->>'id', (ordinal - 1)::int, receipt->>'paymentId', receipt->>'legalEntityId',
    receipt->>'currency', (receipt->>'amount')::numeric, receipt->>'source', receipt->>'status',
    coalesce(receipt->>'reference', ''),
    receipt - ARRAY['id','paymentId','legalEntityId','currency','amount','source','status','reference']
  FROM jsonb_array_elements(coalesce(p_content->'receipts', '[]'::jsonb)) WITH ORDINALITY AS item(receipt, ordinal);

  INSERT INTO commercial_allocations(workspace_id, case_id, id, sort_order, receipt_id, payment_id, legal_entity_id,
    currency, amount, detail)
  SELECT p_workspace_id, p_case_id, allocation->>'id', (ordinal - 1)::int, allocation->>'receiptId',
    allocation->>'paymentId', allocation->>'legalEntityId', allocation->>'currency', (allocation->>'amount')::numeric,
    allocation - ARRAY['id','receiptId','paymentId','legalEntityId','currency','amount']
  FROM jsonb_array_elements(coalesce(p_content->'allocations', '[]'::jsonb)) WITH ORDINALITY AS item(allocation, ordinal);

  IF jsonb_typeof(p_content->'dealFile') = 'object' THEN
    INSERT INTO commercial_deal_files(workspace_id, case_id, id, reference, revision, quote_id, quote_hash, value, cost,
      margin, commission, status, detail)
    SELECT p_workspace_id, p_case_id, deal->>'id', deal->>'reference', (deal->>'revision')::int, deal->>'quoteId',
      deal->>'quoteHash', (deal->>'value')::numeric, (deal->>'cost')::numeric, (deal->>'margin')::numeric,
      coalesce((deal->>'commission')::numeric, 0), deal->>'status',
      deal - ARRAY['id','reference','revision','quoteId','quoteHash','value','cost','margin','commission','status']
    FROM (SELECT p_content->'dealFile' AS deal) source;
  END IF;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION commercial_case_save(p_workspace_id uuid, p_case_id uuid, p_revision integer, p_content jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  quotes jsonb := coalesce(p_content->'quotes', '[]'::jsonb);
  quote_keys text[] := ARRAY['id','number','kind','round','familyId','direction','baselineId','status','title',
    'currency','validUntil','discount','taxRate','total','hash','lines'];
  line_keys text[] := ARRAY['id','room','title','quantity','unit','unitCost','rate','optional','scopeId'];
BEGIN
  INSERT INTO commercial_cases(workspace_id, case_id, revision, content)
  VALUES (p_workspace_id, p_case_id, p_revision, p_content - ARRAY['quotes','payments','receipts','allocations','dealFile'])
  ON CONFLICT (case_id) DO UPDATE SET revision = excluded.revision, content = excluded.content, updated_at = now()
  WHERE commercial_cases.workspace_id = p_workspace_id;

  DELETE FROM commercial_quotes quote WHERE quote.workspace_id = p_workspace_id AND quote.case_id = p_case_id
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(quotes) item WHERE item->>'id' = quote.id);

  INSERT INTO commercial_quotes(
    workspace_id, case_id, id, sort_order, number, kind, round, family_id, direction, baseline_id, status, title,
    currency, valid_until, discount, tax_rate, total, hash, detail)
  SELECT p_workspace_id, p_case_id, quote->>'id', (ordinal - 1)::int, (quote->>'number')::int, quote->>'kind',
    quote->>'round', quote->>'familyId', quote->>'direction', quote->>'baselineId', quote->>'status', quote->>'title',
    quote->>'currency', nullif(quote->>'validUntil', '')::date,
    coalesce((quote->>'discount')::numeric, 0), coalesce((quote->>'taxRate')::numeric, 0),
    coalesce((quote->>'total')::numeric, 0), quote->>'hash', quote - quote_keys
  FROM jsonb_array_elements(quotes) WITH ORDINALITY AS item(quote, ordinal)
  ON CONFLICT (case_id, id) DO UPDATE SET
    sort_order = excluded.sort_order, number = excluded.number, kind = excluded.kind, round = excluded.round,
    family_id = excluded.family_id, direction = excluded.direction, baseline_id = excluded.baseline_id,
    status = excluded.status, title = excluded.title, currency = excluded.currency, valid_until = excluded.valid_until,
    discount = excluded.discount, tax_rate = excluded.tax_rate, total = excluded.total, hash = excluded.hash,
    detail = excluded.detail
  WHERE commercial_quotes.workspace_id = p_workspace_id;

  DELETE FROM commercial_quote_lines WHERE workspace_id = p_workspace_id AND case_id = p_case_id;
  INSERT INTO commercial_quote_lines(
    workspace_id, case_id, quote_id, id, sort_order, room, title, quantity, unit, unit_cost, rate, optional, scope_id, detail)
  SELECT p_workspace_id, p_case_id, quote->>'id', line->>'id', (line_ordinal - 1)::int, coalesce(line->>'room', ''),
    line->>'title', coalesce((line->>'quantity')::numeric, 0), coalesce(line->>'unit', ''),
    coalesce((line->>'unitCost')::numeric, 0), coalesce((line->>'rate')::numeric, 0),
    (line->>'optional')::boolean, line->>'scopeId', line - line_keys
  FROM jsonb_array_elements(quotes) AS item(quote)
  CROSS JOIN LATERAL jsonb_array_elements(coalesce(quote->'lines', '[]'::jsonb)) WITH ORDINALITY AS entry(line, line_ordinal);

  PERFORM commercial_money_save(p_workspace_id, p_case_id, p_content);
END;
$$;
--> statement-breakpoint
ALTER TABLE commercial_cases DROP CONSTRAINT commercial_cases_quotes_are_rows;
--> statement-breakpoint
ALTER TABLE commercial_cases ADD CONSTRAINT commercial_cases_rows_not_embedded
  CHECK (NOT (content ?| ARRAY['quotes', 'payments', 'receipts', 'allocations', 'dealFile']));
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON commercial_payments, commercial_receipts, commercial_allocations, commercial_deal_files TO wodana_app;
    GRANT EXECUTE ON FUNCTION commercial_money_json(uuid, uuid) TO wodana_app;
    GRANT EXECUTE ON FUNCTION commercial_money_save(uuid, uuid, jsonb) TO wodana_app;
  END IF;
END $$;
