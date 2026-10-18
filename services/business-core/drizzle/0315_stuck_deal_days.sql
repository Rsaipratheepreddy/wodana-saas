-- Stuck deals (Reports › Sales and marketing, Needs attention): an open opportunity whose stage hasn't changed for this
-- many days is stuck. A Sales rule on the workspace's existing settings row (14 days unless the firm changes it).
-- One column with a default and a check; RLS and grants on workspace_sales_settings are unchanged. Idempotent.
ALTER TABLE workspace_sales_settings ADD COLUMN IF NOT EXISTS stuck_deal_days integer NOT NULL DEFAULT 14;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_sales_settings_stuck_deal_days_check') THEN
    ALTER TABLE workspace_sales_settings ADD CONSTRAINT workspace_sales_settings_stuck_deal_days_check CHECK (stuck_deal_days BETWEEN 1 AND 365);
  END IF;
END $$;
