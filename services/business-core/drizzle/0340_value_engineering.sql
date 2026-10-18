-- PLM-147 (updates PLM-045): value engineering led by the Lead Interior Designer with the QS.
--
-- 1. quote_value_engineering: one value engineering round on a job's estimate. It opens when the QS confirms a price
--    above the client's recorded budget (automatic) or when the QS (or a manager) starts it (manual). The job's lead
--    designer leads it, the QS is the second party, the Account Manager is copied. It holds the price and the budget
--    it started from, the savings the designer and the QS agreed, the value engineering meeting (a CRM meeting, so its
--    minutes work as on any client meeting) and how the client decided: a new estimate version sent, the price kept,
--    or the round withdrawn. One open round per job. A round past the firm's free rounds is flagged chargeable.
-- 2. workspace_quotation_settings.value_engineering_free_rounds: the free rounds per job (null: no limit).
-- 3. The go-live reset clears the rounds.
-- Workspace-scoped, forced RLS, tenant_isolation. Money is numeric. Idempotent; never disables RLS.
CREATE TABLE IF NOT EXISTS quote_value_engineering (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  case_id uuid NOT NULL,
  -- The estimate version priced over the budget, its family (the versions v1, v2...) and its number on the case.
  quote_id text NOT NULL,
  family_id text NOT NULL,
  quote_number integer NOT NULL CHECK (quote_number > 0),
  round smallint NOT NULL CHECK (round > 0),
  chargeable boolean NOT NULL DEFAULT false,
  origin varchar(16) NOT NULL CHECK (origin IN ('automatic', 'manual')),
  status varchar(16) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  currency varchar(3) NOT NULL,
  quoted_total numeric(18, 4) NOT NULL,
  -- The client's budget when the round started (null: none recorded, or recorded in another currency).
  budget_amount numeric(18, 4),
  -- Who leads: the lead designer, else the Account Manager when the job has no lead designer (lead_fallback).
  lead_membership_id uuid,
  lead_fallback boolean NOT NULL DEFAULT false,
  qs_user_id uuid REFERENCES users (id),
  note varchar(2000) NOT NULL DEFAULT '',
  options_note varchar(4000),
  options_agreed_at timestamptz,
  options_agreed_by uuid REFERENCES users (id),
  meeting_activity_id uuid,
  outcome varchar(16) CHECK (outcome IN ('new_version', 'kept_price', 'withdrawn')),
  outcome_quote_id text,
  outcome_note varchar(2000),
  closed_at timestamptz,
  closed_by uuid REFERENCES users (id),
  -- The last time the step moved (started, savings agreed, meeting booked): the idle reminder counts from it.
  last_moved_at timestamptz NOT NULL DEFAULT now(),
  started_by uuid REFERENCES users (id),
  started_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  CHECK ((status = 'open') = (outcome IS NULL)),
  CHECK (status = 'open' OR closed_at IS NOT NULL),
  FOREIGN KEY (workspace_id, case_id) REFERENCES pre_project_cases (workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS quote_value_engineering_one_open ON quote_value_engineering (workspace_id, case_id) WHERE status = 'open';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS quote_value_engineering_case_idx ON quote_value_engineering (workspace_id, case_id, started_at DESC);
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE quote_value_engineering ENABLE ROW LEVEL SECURITY;
  ALTER TABLE quote_value_engineering FORCE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'quote_value_engineering' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON quote_value_engineering
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    -- A round is never deleted: it closes with its outcome.
    GRANT SELECT, INSERT, UPDATE ON quote_value_engineering TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE workspace_quotation_settings ADD COLUMN IF NOT EXISTS value_engineering_free_rounds smallint;
--> statement-breakpoint
ALTER TABLE workspace_quotation_settings DROP CONSTRAINT IF EXISTS workspace_quotation_settings_value_engineering_free_rounds_check;
--> statement-breakpoint
ALTER TABLE workspace_quotation_settings ADD CONSTRAINT workspace_quotation_settings_value_engineering_free_rounds_check
  CHECK (value_engineering_free_rounds IS NULL OR value_engineering_free_rounds BETWEEN 0 AND 50);
--> statement-breakpoint
INSERT INTO workspace_record_classification (table_name, disposition, clear_predicate, file_columns) VALUES
  ('quote_value_engineering', 'clear', NULL, '{}')
ON CONFLICT (table_name) DO UPDATE SET disposition = excluded.disposition,
  clear_predicate = excluded.clear_predicate, file_columns = excluded.file_columns;
