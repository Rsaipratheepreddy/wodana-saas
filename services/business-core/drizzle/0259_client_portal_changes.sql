-- P4 batch 2 — client surfaces (plan §6.7a batch 2, §6.20, §6.22, §0.7 R1, R2, R11, AI2; edge cases E5-1, E5-4, M-5, M-7).
--   * change_requests + change_request_lines: a change raised by the client or the team, its impact on design, price
--     (lines from the quote, the materials ledger, an allowance draw-down or new work) and the handover date; decided
--     internally on E3 (kind change_request) and by the client in the portal or by a signed link (e-sign, no login).
--   * change_request_events: the change's history, append-only. change_request_po_impacts: the open purchase orders an
--     approved change touches (M-5), listed when it is approved and never edited.
--   * design_ledger_alternatives: up to three alternatives offered when the client declines a choice (R2); the
--     client's pick becomes a new ledger version.
--   * client_portal_visits: when each client contact last looked, for "what changed since you last looked" (AI2).
--   * quote_documents may hold a change request's document (its PDF and signed copy) beside proposals.
-- Every table has workspace_id, forced RLS and the tenant_isolation policy. Idempotent; never disables RLS.
CREATE TABLE IF NOT EXISTS change_requests (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  case_id uuid NOT NULL,
  number integer NOT NULL CHECK (number > 0),
  kind varchar(20) NOT NULL DEFAULT 'addition' CHECK (kind IN ('addition', 'deduction', 'replacement', 'move', 'schedule', 'price_correction')),
  title varchar(240) NOT NULL CHECK (length(btrim(title)) > 0),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 4000),
  design_impact text NOT NULL DEFAULT '' CHECK (length(design_impact) <= 2000),
  status varchar(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_approval', 'with_client', 'approved', 'declined', 'withdrawn')),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  price_impact numeric(18, 2) NOT NULL DEFAULT 0,
  time_impact_days integer NOT NULL DEFAULT 0 CHECK (time_impact_days BETWEEN -365 AND 365),
  handover_before date,
  handover_after date,
  raised_by uuid,
  raised_by_grant_id uuid,
  submitted_by uuid,
  submitted_at timestamptz,
  sent_by uuid,
  sent_at timestamptz,
  document_id uuid,
  esign_request_id uuid,
  decided_at timestamptz,
  decided_by_name varchar(200),
  decided_by_grant_id uuid,
  decision_method varchar(16) CHECK (decision_method IS NULL OR decision_method IN ('portal', 'signed_link')),
  decline_note text CHECK (decline_note IS NULL OR length(decline_note) <= 2000),
  lock_number integer,
  withdrawn_at timestamptz,
  withdraw_reason text CHECK (withdraw_reason IS NULL OR length(withdraw_reason) <= 2000),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, case_id, number),
  FOREIGN KEY (workspace_id, case_id) REFERENCES pre_project_cases (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, case_id, raised_by_grant_id) REFERENCES client_portal_grants (workspace_id, case_id, id),
  FOREIGN KEY (workspace_id, case_id, decided_by_grant_id) REFERENCES client_portal_grants (workspace_id, case_id, id),
  CHECK ((raised_by IS NULL) <> (raised_by_grant_id IS NULL)),
  CHECK (status <> 'approved' OR (decided_at IS NOT NULL AND decision_method IS NOT NULL AND decided_by_name IS NOT NULL)),
  CHECK (status <> 'declined' OR (decided_at IS NOT NULL AND decline_note IS NOT NULL)),
  CHECK (status <> 'withdrawn' OR withdrawn_at IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS change_requests_case_idx ON change_requests (workspace_id, case_id, number DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS change_request_lines (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  change_request_id uuid NOT NULL,
  position integer NOT NULL DEFAULT 0,
  -- quote_line: changes a line of the accepted quote; ledger: a material/design choice changed after sign-off (its
  -- proposed version); allowance: spends part of an allowance line; custom: new work.
  source varchar(12) NOT NULL CHECK (source IN ('quote_line', 'ledger', 'allowance', 'custom')),
  action varchar(8) NOT NULL CHECK (action IN ('add', 'omit', 'replace', 'draw')),
  quote_id text,
  quote_line_id text,
  ledger_entry_id uuid,
  ledger_version_id uuid,
  room_id uuid REFERENCES pre_project_rooms (id) ON DELETE SET NULL,
  title varchar(240) NOT NULL CHECK (length(btrim(title)) > 0),
  quantity numeric(14, 4) CHECK (quantity IS NULL OR quantity > 0),
  unit varchar(40) NOT NULL DEFAULT '',
  unit_price numeric(14, 2) CHECK (unit_price IS NULL OR unit_price >= 0),
  -- What the line adds to (or, for an omission, takes off) the client's price; numeric, never a float.
  amount numeric(18, 2) NOT NULL,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, change_request_id) REFERENCES change_requests (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, ledger_entry_id) REFERENCES design_ledger_entries (workspace_id, id),
  FOREIGN KEY (workspace_id, ledger_version_id) REFERENCES design_ledger_versions (workspace_id, id),
  CHECK ((source = 'ledger') = (ledger_entry_id IS NOT NULL)),
  CHECK ((source = 'allowance') = (action = 'draw')),
  CHECK (source NOT IN ('quote_line', 'allowance') OR (quote_id IS NOT NULL AND quote_line_id IS NOT NULL)),
  CHECK (action <> 'omit' OR amount <= 0),
  CHECK (action NOT IN ('add', 'draw') OR amount >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS change_request_lines_request_idx ON change_request_lines (workspace_id, change_request_id, position);
--> statement-breakpoint
-- The lines are the change's terms: they change only while the change is a draft.
CREATE OR REPLACE FUNCTION change_request_lines_draft_only() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_status text;
BEGIN
  SELECT status INTO parent_status FROM change_requests
   WHERE workspace_id = COALESCE(NEW.workspace_id, OLD.workspace_id) AND id = COALESCE(NEW.change_request_id, OLD.change_request_id);
  IF parent_status IS NOT NULL AND parent_status <> 'draft' THEN
    RAISE EXCEPTION 'A change request''s lines change only while it is a draft' USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS change_request_lines_draft_only ON change_request_lines;
--> statement-breakpoint
CREATE TRIGGER change_request_lines_draft_only BEFORE INSERT OR UPDATE OR DELETE ON change_request_lines FOR EACH ROW EXECUTE FUNCTION change_request_lines_draft_only();
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS change_request_events (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  change_request_id uuid NOT NULL,
  event varchar(24) NOT NULL CHECK (event IN ('raised', 'edited', 'submitted', 'returned', 'rejected', 'approved_internal', 'sent', 'approved', 'declined', 'withdrawn')),
  actor_user_id uuid,
  actor_grant_id uuid,
  note text CHECK (note IS NULL OR length(note) <= 2000),
  at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (workspace_id, change_request_id) REFERENCES change_requests (workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS change_request_events_request_idx ON change_request_events (workspace_id, change_request_id, at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS change_request_po_impacts (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  change_request_id uuid NOT NULL,
  purchase_order_id uuid NOT NULL,
  number varchar(60) NOT NULL,
  status varchar(20) NOT NULL,
  matched_on varchar(240) NOT NULL,
  listed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, change_request_id, purchase_order_id),
  FOREIGN KEY (workspace_id, change_request_id) REFERENCES change_requests (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, purchase_order_id) REFERENCES purchase_orders (workspace_id, id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS design_ledger_alternatives (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  case_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  declined_version_id uuid NOT NULL,
  rank smallint NOT NULL CHECK (rank BETWEEN 1 AND 3),
  catalog_item_id uuid NOT NULL,
  source varchar(10) NOT NULL CHECK (source IN ('catalog', 'past_job')),
  title varchar(240) NOT NULL CHECK (length(btrim(title)) > 0),
  unit varchar(40) NOT NULL DEFAULT '',
  unit_price numeric(14, 2) CHECK (unit_price IS NULL OR unit_price >= 0),
  currency char(3) CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  line_total numeric(18, 2),
  in_stock boolean NOT NULL DEFAULT false,
  in_budget boolean NOT NULL DEFAULT false,
  offered_at timestamptz NOT NULL DEFAULT now(),
  chosen_at timestamptz,
  chosen_by_grant_id uuid,
  chosen_version_id uuid,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, declined_version_id, rank),
  UNIQUE (workspace_id, declined_version_id, catalog_item_id),
  FOREIGN KEY (workspace_id, entry_id) REFERENCES design_ledger_entries (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, declined_version_id) REFERENCES design_ledger_versions (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, catalog_item_id) REFERENCES catalog_items (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, case_id, chosen_by_grant_id) REFERENCES client_portal_grants (workspace_id, case_id, id),
  FOREIGN KEY (workspace_id, chosen_version_id) REFERENCES design_ledger_versions (workspace_id, id),
  CHECK ((chosen_at IS NULL) = (chosen_version_id IS NULL))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS design_ledger_alternatives_case_idx ON design_ledger_alternatives (workspace_id, case_id, entry_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS client_portal_visits (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  grant_id uuid NOT NULL,
  -- This visit and the one before it: "since you last looked" counts from the visit before.
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  previous_seen_at timestamptz,
  PRIMARY KEY (workspace_id, grant_id),
  FOREIGN KEY (grant_id) REFERENCES client_portal_grants (id) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE quote_documents DROP CONSTRAINT IF EXISTS quote_documents_kind_check;
--> statement-breakpoint
ALTER TABLE quote_documents ADD CONSTRAINT quote_documents_kind_check CHECK (kind IN ('proposal', 'external_quotation', 'change_request'));
--> statement-breakpoint
DO $$
DECLARE target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['change_requests', 'change_request_lines', 'change_request_events', 'change_request_po_impacts', 'design_ledger_alternatives', 'client_portal_visits'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', target);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = target AND policyname = 'tenant_isolation') THEN
      EXECUTE format($policy$CREATE POLICY tenant_isolation ON %I
        USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
        WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$, target);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    -- A change request is never deleted (withdrawn instead); its draft lines are replaced; history and impacts are only added.
    GRANT SELECT, INSERT, UPDATE ON change_requests TO wodana_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON change_request_lines TO wodana_app;
    GRANT SELECT, INSERT ON change_request_events TO wodana_app;
    GRANT SELECT, INSERT ON change_request_po_impacts TO wodana_app;
    GRANT SELECT, INSERT, UPDATE ON design_ledger_alternatives TO wodana_app;
    GRANT SELECT, INSERT, UPDATE ON client_portal_visits TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('change_request.raised', 'in_app', 'Change requested · {{clientName}}', '{{reference}} {{title}}: {{note}}', '["clientName","reference","title","note"]'),
  ('change_request.raised', 'email', 'Change requested: {{clientName}}', E'{{clientName}} asked for a change.\n\n{{reference}} {{title}}\n{{note}}\n\nAssess its impact and send it for approval.', '["clientName","reference","title","note"]'),
  ('change_request.decided', 'in_app', '{{reference}} {{decision}} · {{clientName}}', '{{title}}: {{note}}', '["clientName","reference","title","decision","note"]'),
  ('change_request.decided', 'email', '{{reference}} {{decision}}: {{clientName}}', E'{{clientName}} {{decision}} {{reference}} {{title}}.\n\n{{note}}', '["clientName","reference","title","decision","note"]'),
  ('ledger.alternative_chosen', 'in_app', '{{clientName}} chose an alternative', '{{title}} instead of {{previous}}.', '["clientName","title","previous"]')
) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
