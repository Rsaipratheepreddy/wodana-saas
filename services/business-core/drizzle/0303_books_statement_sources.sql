-- Company statements (plan §6.21b): where each company's P&L and cash flow come from.
--   * books_statement_sources: one row per company (legal entity) once someone chooses — Wodana Ledger, Zoho Books,
--     QuickBooks or operational cash (Wodana's receipts, bills and payments without full books). Without a row the
--     Ledger is used when it is on for the company, else operational cash. Version-checked, audited, configuration
--     (kept by the go-live clear).
--   * Region packs gain fiscalYearStartMonth (the month a financial year starts in that country), read by statements
--     for companies whose books are not in the Ledger.
-- Never disables RLS.

CREATE TABLE IF NOT EXISTS books_statement_sources (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  legal_entity_id uuid NOT NULL,
  source varchar(20) NOT NULL CHECK (source IN ('ledger', 'zoho_books', 'quickbooks', 'operational_cash')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, legal_entity_id),
  FOREIGN KEY (workspace_id, legal_entity_id) REFERENCES legal_entities (workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE books_statement_sources ENABLE ROW LEVEL SECURITY;
  ALTER TABLE books_statement_sources FORCE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'books_statement_sources' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON books_statement_sources
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON books_statement_sources TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO workspace_record_classification (table_name, disposition, clear_predicate, file_columns) VALUES
  ('books_statement_sources', 'keep', NULL, '{}')
ON CONFLICT (table_name) DO UPDATE SET disposition = excluded.disposition,
  clear_predicate = excluded.clear_predicate, file_columns = excluded.file_columns;
--> statement-breakpoint
-- The month each country's financial year usually starts (a company changes its own in Settings › Ledger).
UPDATE tenant_setup_profiles profile
   SET configuration = profile.configuration || jsonb_build_object('fiscalYearStartMonth', months.start_month)
  FROM (VALUES ('AE', 1), ('AU', 7), ('BH', 1), ('GB', 4), ('IN', 4), ('KW', 1), ('OM', 1), ('QA', 1), ('SA', 1), ('SG', 1), ('US', 1)) AS months(code, start_month)
 WHERE profile.kind = 'region' AND profile.code = months.code AND NOT (profile.configuration ? 'fiscalYearStartMonth');
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('books.statement_source_changed', 'in_app', '{{company}} · statements from {{source}}', '{{actor}} changed where statements come from. It was {{previous}}.',
    '["company","source","previous","actor"]'),
  ('books.statement_source_changed', 'email', '{{company}} · statements from {{source}}',
    E'{{actor}} changed where the profit and loss and cash flow of {{company}} come from: {{source}}. It was {{previous}}.',
    '["company","source","previous","actor"]')
) AS template(code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
