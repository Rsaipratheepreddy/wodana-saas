-- Labour and petty cash in a project's costs.
-- Site labour: the people per trade on an approved daily report, at the trade's day rate on the report's
-- day. Factory labour: the hours reported with approved output, at its workcenter's hourly rate on the day
-- it was reported. A rate applies from a date until the next one, so changing it never rewrites the days
-- before; work with no rate is counted as not costed, never as nothing.
-- Petty cash: what someone on a project's team spent for it, with a receipt (or why there's none),
-- approved by the project's manager — never the claimant — and reimbursed by the people who pay. It costs
-- the project once approved.
CREATE TABLE workspace_labour_rates (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  trade varchar(80) NOT NULL CHECK (length(btrim(trade)) > 0),
  effective_from date NOT NULL,
  day_rate numeric(18, 4) NOT NULL CHECK (day_rate >= 0),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  updated_by uuid NOT NULL REFERENCES users (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (workspace_id, id)
);
--> statement-breakpoint
-- One rate per trade (whatever its case) and day it applies from.
CREATE UNIQUE INDEX workspace_labour_rates_key ON workspace_labour_rates (workspace_id, lower(trade), effective_from);
--> statement-breakpoint
CREATE TABLE workcenter_rates (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  workcenter_id uuid NOT NULL,
  effective_from date NOT NULL,
  hourly_rate numeric(18, 4) NOT NULL CHECK (hourly_rate >= 0),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  updated_by uuid NOT NULL REFERENCES users (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, workcenter_id, effective_from),
  FOREIGN KEY (workspace_id, workcenter_id) REFERENCES workcenters (workspace_id, id)
);
--> statement-breakpoint
-- The hours output took, reported with it, and the workcenter it was made on (its work order's can change later).
ALTER TABLE work_order_reports
  ADD COLUMN hours numeric(8, 2),
  ADD COLUMN workcenter_id uuid,
  ADD CONSTRAINT work_order_reports_hours_check CHECK (hours IS NULL OR (hours > 0 AND hours <= 1000)),
  ADD CONSTRAINT work_order_reports_workcenter_fkey FOREIGN KEY (workspace_id, workcenter_id) REFERENCES workcenters (workspace_id, id);
--> statement-breakpoint
CREATE TABLE petty_cash_claims (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  number integer NOT NULL CHECK (number > 0),
  project_id uuid NOT NULL,
  package_id uuid,
  spent_on date NOT NULL,
  amount numeric(18, 4) NOT NULL CHECK (amount > 0),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  description varchar(500) NOT NULL CHECK (length(btrim(description)) > 0),
  category varchar(10) NOT NULL CHECK (category IN ('transport', 'food', 'materials', 'tools', 'fees', 'other')),
  receipt_name varchar(255),
  receipt_type varchar(100),
  receipt_key varchar(500),
  receipt_sha256 char(64),
  no_receipt_reason varchar(300) NOT NULL DEFAULT '',
  status varchar(10) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'reimbursed')),
  claimed_by uuid NOT NULL REFERENCES users (id),
  submitted_at timestamptz,
  decided_by uuid REFERENCES users (id),
  decided_at timestamptz,
  decision_note varchar(500) NOT NULL DEFAULT '',
  reimbursed_by uuid REFERENCES users (id),
  reimbursed_at timestamptz,
  reimbursement_reference varchar(120) NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, number),
  FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects (workspace_id, id),
  FOREIGN KEY (workspace_id, package_id) REFERENCES project_packages (workspace_id, id) ON DELETE SET NULL (package_id),
  CHECK ((receipt_key IS NULL) = (receipt_sha256 IS NULL)),
  -- Submitted with its receipt, or why there's none.
  CHECK (status = 'draft' OR (submitted_at IS NOT NULL AND (receipt_key IS NOT NULL OR length(btrim(no_receipt_reason)) > 0))),
  -- Decided by someone other than who claimed it; a rejection says why.
  CHECK ((status IN ('approved', 'rejected', 'reimbursed')) = (decided_at IS NOT NULL)),
  CHECK (decided_at IS NULL OR (decided_by IS NOT NULL AND decided_by <> claimed_by)),
  CHECK (status <> 'rejected' OR length(btrim(decision_note)) > 0),
  CHECK ((status = 'reimbursed') = (reimbursed_at IS NOT NULL AND reimbursed_by IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX petty_cash_claims_project_idx ON petty_cash_claims (workspace_id, project_id, spent_on DESC);
--> statement-breakpoint
CREATE INDEX petty_cash_claims_to_reimburse_idx ON petty_cash_claims (workspace_id, decided_at) WHERE status = 'approved';
--> statement-breakpoint
CREATE TABLE petty_cash_commands (
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
  FOREACH t IN ARRAY ARRAY['workspace_labour_rates', 'workcenter_rates', 'petty_cash_claims', 'petty_cash_commands'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($policy$CREATE POLICY tenant_isolation ON %I
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$, t);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON workspace_labour_rates TO wodana_app;
    GRANT SELECT, INSERT, UPDATE ON workcenter_rates, petty_cash_claims TO wodana_app;
    GRANT SELECT, INSERT ON petty_cash_commands TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, 'in_app', 'en', 1, 'approved', template.subject, template.body, '["claim", "project", "amount", "actor", "note"]'::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('petty_cash.submitted', 'Petty cash to approve: {{claim}}', '{{actor}} claimed {{amount}} on {{project}}: {{note}}'),
  ('petty_cash.approved', 'Petty cash {{claim}} approved', '{{actor}} approved {{amount}} on {{project}}.'),
  ('petty_cash.rejected', 'Petty cash {{claim}} rejected', '{{actor}}: {{note}}'),
  ('petty_cash.to_reimburse', 'Petty cash to reimburse: {{claim}}', '{{actor}} approved {{amount}} for {{note}} on {{project}}.'),
  ('petty_cash.reimbursed', 'Petty cash {{claim}} reimbursed', '{{actor}} reimbursed {{amount}} on {{project}}.')
) AS template (code, subject, body)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
