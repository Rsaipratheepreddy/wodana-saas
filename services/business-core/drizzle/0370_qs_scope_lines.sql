-- QS review scope "lines" (PLM-082/083/084, Palm's third round: "QS only for joinery, bespoke and Proposal 2 with joinery").
-- Settings › Quotations › "Quotations the QS prices" gains a third choice next to "every quotation" and "only where the
-- rules apply": only quotations with lines the rules name, in a work package marked for QS review or of a catalogue kind
-- marked for QS review. Under it a deal or path that needs a BOQ (kept for the material sign-off before ordering) no
-- longer sends a quotation to the QS on its own. Design Fee proposals still skip the QS; variations follow the same rules.
--
-- The column's CHECK came in with the column (0276), so it carries PostgreSQL's own name. Idempotent: every check on
-- qs_review_scope is dropped by its name, then the one check is added back under its standard name.
DO $$
DECLARE
  found text;
BEGIN
  FOR found IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'workspace_quotation_settings'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%qs_review_scope%'
  LOOP
    EXECUTE format('ALTER TABLE workspace_quotation_settings DROP CONSTRAINT %I', found);
  END LOOP;
END $$;
--> statement-breakpoint
ALTER TABLE workspace_quotation_settings
  ADD CONSTRAINT workspace_quotation_settings_qs_review_scope_check CHECK (qs_review_scope IN ('all', 'rules', 'lines'));
