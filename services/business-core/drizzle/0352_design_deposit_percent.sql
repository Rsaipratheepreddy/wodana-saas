-- The minimum design deposit as a share of the design fee (Palm: the whole fee before design starts).
--   workspace_design_settings.minimum_design_deposit_percent: the share of the job's design fee (its accepted design
--   quotation) that must be received before the design starts and the deal is approved; more than 0 and at most 100.
--   A workspace sets an amount (minimum_design_deposit and currency) or a percentage, never both; neither means no minimum.
-- Existing amounts stay as they are. RLS untouched. Idempotent.
ALTER TABLE workspace_design_settings
  ADD COLUMN IF NOT EXISTS minimum_design_deposit_percent numeric(5, 2);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_design_settings_deposit_percent_check') THEN
    ALTER TABLE workspace_design_settings ADD CONSTRAINT workspace_design_settings_deposit_percent_check
      CHECK (minimum_design_deposit_percent IS NULL OR (minimum_design_deposit_percent > 0 AND minimum_design_deposit_percent <= 100));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_design_settings_deposit_kind_check') THEN
    ALTER TABLE workspace_design_settings ADD CONSTRAINT workspace_design_settings_deposit_kind_check
      CHECK (minimum_design_deposit_percent IS NULL OR minimum_design_deposit IS NULL);
  END IF;
END $$;
