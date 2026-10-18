-- The app role keeps exactly what the Ledger migrations grant. Databases set up with default table privileges
-- (infra/postgres/001-create-app-role.sh gives the app role SELECT, INSERT, UPDATE, DELETE on new tables) also
-- handed it UPDATE and DELETE on posted journals and DELETE on the chart. Take those back: posted journals and
-- commands are append-only, and accounts, tax codes and settings are archived, never deleted. RLS untouched. Idempotent.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    REVOKE UPDATE, DELETE ON books_journals, books_journal_lines, books_commands FROM wodana_app;
    REVOKE DELETE ON books_settings, books_accounts, books_tax_codes, books_posting_issues, books_manual_journals,
      books_bill_captures, books_statement_sources FROM wodana_app;
  END IF;
END $$;
