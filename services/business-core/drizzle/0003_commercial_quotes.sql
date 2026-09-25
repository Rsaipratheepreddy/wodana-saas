-- v2 commercial: quotes and quote lines become relational rows instead of the quotes array
-- inside commercial_cases.content. CommercialRepository writes them in the same transaction
-- as the remaining case document; commercial_cases_view rebuilds the previous JSON shape so
-- existing readers keep working while they move to the tables. Money is numeric.
CREATE TABLE commercial_quotes (
  workspace_id uuid NOT NULL,
  case_id uuid NOT NULL,
  id text NOT NULL,
  sort_order integer NOT NULL,
  number integer NOT NULL CHECK (number > 0),
  kind text NOT NULL CHECK (kind IN ('quotation', 'variation')),
  round text CHECK (round IN ('design', 'main')),
  family_id text,
  direction text CHECK (direction IN ('addition', 'deduction')),
  baseline_id text,
  status text NOT NULL CHECK (status IN ('draft', 'internal_review', 'internal_approved', 'issued', 'accepted', 'changes_requested', 'declined', 'superseded', 'withdrawn')),
  title text NOT NULL,
  currency text NOT NULL,
  valid_until date,
  discount numeric NOT NULL DEFAULT 0 CHECK (discount >= 0),
  tax_rate numeric NOT NULL DEFAULT 0 CHECK (tax_rate >= 0),
  total numeric NOT NULL DEFAULT 0,
  hash text,
  -- Presentation, cover, terms, decisions and other fields not yet queried by value.
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (case_id, id),
  UNIQUE (workspace_id, case_id, id),
  UNIQUE (case_id, number),
  FOREIGN KEY (workspace_id, case_id) REFERENCES pre_project_cases (workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX commercial_quotes_workspace_status_idx ON commercial_quotes (workspace_id, status);
--> statement-breakpoint
CREATE TABLE commercial_quote_lines (
  workspace_id uuid NOT NULL,
  case_id uuid NOT NULL,
  quote_id text NOT NULL,
  id text NOT NULL,
  sort_order integer NOT NULL,
  room text NOT NULL DEFAULT '',
  title text NOT NULL,
  quantity numeric NOT NULL CHECK (quantity >= 0),
  unit text NOT NULL DEFAULT '',
  unit_cost numeric NOT NULL DEFAULT 0,
  rate numeric NOT NULL DEFAULT 0,
  optional boolean,
  scope_id text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (case_id, quote_id, id),
  FOREIGN KEY (workspace_id, case_id, quote_id) REFERENCES commercial_quotes (workspace_id, case_id, id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE INDEX commercial_quote_lines_scope_idx ON commercial_quote_lines (workspace_id, scope_id) WHERE scope_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE commercial_quotes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commercial_quotes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON commercial_quotes
  USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE commercial_quote_lines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commercial_quote_lines FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON commercial_quote_lines
  USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
--> statement-breakpoint
CREATE TRIGGER commercial_quotes_updated_at BEFORE UPDATE ON commercial_quotes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
-- The exact Quote JSON the application stores (see commercial-repository.ts).
CREATE FUNCTION commercial_quote_json(quote commercial_quotes)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT quote.detail
    || jsonb_build_object(
      'id', quote.id,
      'number', quote.number,
      'kind', quote.kind,
      'status', quote.status,
      'title', quote.title,
      'currency', quote.currency,
      'validUntil', coalesce(quote.valid_until::text, ''),
      'discount', quote.discount,
      'taxRate', quote.tax_rate,
      'total', quote.total,
      'lines', coalesce((
        SELECT jsonb_agg(
          line.detail || jsonb_build_object(
            'id', line.id, 'room', line.room, 'title', line.title, 'quantity', line.quantity,
            'unit', line.unit, 'unitCost', line.unit_cost, 'rate', line.rate
          ) || jsonb_strip_nulls(jsonb_build_object('optional', line.optional, 'scopeId', line.scope_id))
          ORDER BY line.sort_order)
        FROM commercial_quote_lines line
        WHERE line.case_id = quote.case_id AND line.quote_id = quote.id
      ), '[]'::jsonb)
    )
    || jsonb_strip_nulls(jsonb_build_object(
      'round', quote.round, 'familyId', quote.family_id, 'direction', quote.direction,
      'baselineId', quote.baseline_id, 'hash', quote.hash
    ));
$$;
--> statement-breakpoint
CREATE VIEW commercial_cases_view WITH (security_invoker = true) AS
  SELECT commercial.case_id, commercial.workspace_id, commercial.revision, commercial.updated_at,
    commercial.content || jsonb_build_object('quotes', coalesce((
      SELECT jsonb_agg(commercial_quote_json(quote) ORDER BY quote.sort_order)
      FROM commercial_quotes quote
      WHERE quote.workspace_id = commercial.workspace_id AND quote.case_id = commercial.case_id
    ), '[]'::jsonb)) AS content
  FROM commercial_cases commercial;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON commercial_quotes, commercial_quote_lines TO wodana_app;
    GRANT SELECT ON commercial_cases_view TO wodana_app;
    GRANT EXECUTE ON FUNCTION commercial_quote_json(commercial_quotes) TO wodana_app;
  END IF;
END $$;
