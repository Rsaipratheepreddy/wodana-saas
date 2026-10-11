-- Change requests on a project (plan §6.20, §6.10): a change raised on a started project is priced as a variation
-- quotation by the shared quotation engine, approved on E3, decided by the client, then applied in one command (the
-- contract value through a sealed VO-n, the variation's payment milestones, the stage dates and the handover, the live
-- scope, the material list, the factory and purchasing).
--   * change_requests: the project it is on, why it was raised, its variation quotation, the payment rule it was priced
--     under, the frozen schedule preview and hash it was sent with, and what applying did (an immutable snapshot).
--     Statuses add `pricing` (its variation quotation is being priced), `to_send` (approved inside the firm) and
--     `applied` (the project carries it).
--   * change_request_lines: a raised line can be a catalogue item or a line of the project's live scope (removed,
--     replaced or moved to another room); prices come from the variation quotation.
--   * change_request_stage_impacts: the working days the change adds to each affected stage (business truth, a table).
--   * change_request_files: photos and files that come with the change (site photos from the mobile app).
--   * workspace_project_settings: how a variation is paid (all before the work, or with the project's next milestone)
--     and after how many days the client and the project manager are reminded of a change waiting for the client.
--   * workspace_quotation_settings: whether variations follow the firm's QS rules, and the amount from which a
--     variation always goes to the QS.
-- Every new table has workspace_id, forced RLS and the tenant_isolation policy. Idempotent; never disables RLS.
ALTER TABLE change_requests ADD COLUMN IF NOT EXISTS project_id uuid;
--> statement-breakpoint
ALTER TABLE change_requests ADD COLUMN IF NOT EXISTS reason varchar(20) NOT NULL DEFAULT 'client_request';
--> statement-breakpoint
ALTER TABLE change_requests ADD COLUMN IF NOT EXISTS quote_id text;
--> statement-breakpoint
ALTER TABLE change_requests ADD COLUMN IF NOT EXISTS payment_rule varchar(16);
--> statement-breakpoint
ALTER TABLE change_requests ADD COLUMN IF NOT EXISTS schedule_snapshot jsonb;
--> statement-breakpoint
ALTER TABLE change_requests ADD COLUMN IF NOT EXISTS issued_hash char(64);
--> statement-breakpoint
ALTER TABLE change_requests ADD COLUMN IF NOT EXISTS applied_at timestamptz;
--> statement-breakpoint
ALTER TABLE change_requests ADD COLUMN IF NOT EXISTS applied_by uuid;
--> statement-breakpoint
ALTER TABLE change_requests ADD COLUMN IF NOT EXISTS applied_seal_id uuid;
--> statement-breakpoint
ALTER TABLE change_requests ADD COLUMN IF NOT EXISTS applied_schedule jsonb;
--> statement-breakpoint
ALTER TABLE change_requests ADD COLUMN IF NOT EXISTS apply_problem text;
--> statement-breakpoint
ALTER TABLE change_requests DROP CONSTRAINT IF EXISTS change_requests_status_check;
--> statement-breakpoint
ALTER TABLE change_requests ADD CONSTRAINT change_requests_status_check
  CHECK (status IN ('draft', 'pricing', 'pending_approval', 'to_send', 'with_client', 'approved', 'applied', 'declined', 'withdrawn'));
--> statement-breakpoint
ALTER TABLE change_requests DROP CONSTRAINT IF EXISTS change_requests_reason_check;
--> statement-breakpoint
ALTER TABLE change_requests ADD CONSTRAINT change_requests_reason_check CHECK (reason IN ('client_request', 'site_condition', 'design_change', 'error'));
--> statement-breakpoint
ALTER TABLE change_requests DROP CONSTRAINT IF EXISTS change_requests_payment_rule_check;
--> statement-breakpoint
ALTER TABLE change_requests ADD CONSTRAINT change_requests_payment_rule_check CHECK (payment_rule IS NULL OR payment_rule IN ('before_work', 'next_milestone'));
--> statement-breakpoint
ALTER TABLE change_requests DROP CONSTRAINT IF EXISTS change_requests_apply_problem_check;
--> statement-breakpoint
ALTER TABLE change_requests ADD CONSTRAINT change_requests_apply_problem_check CHECK (apply_problem IS NULL OR length(apply_problem) <= 2000);
--> statement-breakpoint
-- The project-only steps need the project; an applied change was decided by the client and records when it was applied.
ALTER TABLE change_requests DROP CONSTRAINT IF EXISTS change_requests_project_steps_check;
--> statement-breakpoint
ALTER TABLE change_requests ADD CONSTRAINT change_requests_project_steps_check CHECK (status NOT IN ('pricing', 'to_send', 'applied') OR project_id IS NOT NULL);
--> statement-breakpoint
ALTER TABLE change_requests DROP CONSTRAINT IF EXISTS change_requests_applied_check;
--> statement-breakpoint
ALTER TABLE change_requests ADD CONSTRAINT change_requests_applied_check
  CHECK (status <> 'applied' OR (applied_at IS NOT NULL AND decided_at IS NOT NULL AND decision_method IS NOT NULL AND applied_seal_id IS NOT NULL));
--> statement-breakpoint
ALTER TABLE change_requests DROP CONSTRAINT IF EXISTS change_requests_project_fkey;
--> statement-breakpoint
ALTER TABLE change_requests ADD CONSTRAINT change_requests_project_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects (workspace_id, id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS change_requests_project_idx ON change_requests (workspace_id, project_id, number DESC) WHERE project_id IS NOT NULL;
--> statement-breakpoint
-- One change per variation quotation.
CREATE UNIQUE INDEX IF NOT EXISTS change_requests_quote_key ON change_requests (workspace_id, case_id, quote_id) WHERE quote_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE change_request_events DROP CONSTRAINT IF EXISTS change_request_events_event_check;
--> statement-breakpoint
ALTER TABLE change_request_events ADD CONSTRAINT change_request_events_event_check CHECK (event IN ('raised', 'edited', 'priced', 'submitted', 'returned', 'rejected',
  'approved_internal', 'sent', 'approved', 'declined', 'withdrawn', 'applied', 'apply_blocked', 'reminded', 'file_added'));
--> statement-breakpoint
ALTER TABLE change_request_lines ADD COLUMN IF NOT EXISTS catalog_item_id uuid;
--> statement-breakpoint
ALTER TABLE change_request_lines ADD COLUMN IF NOT EXISTS boq_line_id uuid;
--> statement-breakpoint
ALTER TABLE change_request_lines ALTER COLUMN amount SET DEFAULT 0;
--> statement-breakpoint
ALTER TABLE change_request_lines DROP CONSTRAINT IF EXISTS change_request_lines_source_check;
--> statement-breakpoint
ALTER TABLE change_request_lines ADD CONSTRAINT change_request_lines_source_check CHECK (source IN ('quote_line', 'ledger', 'allowance', 'custom', 'catalog', 'boq_line'));
--> statement-breakpoint
ALTER TABLE change_request_lines DROP CONSTRAINT IF EXISTS change_request_lines_action_check;
--> statement-breakpoint
ALTER TABLE change_request_lines ADD CONSTRAINT change_request_lines_action_check CHECK (action IN ('add', 'omit', 'replace', 'draw', 'move'));
--> statement-breakpoint
ALTER TABLE change_request_lines DROP CONSTRAINT IF EXISTS change_request_lines_catalog_check;
--> statement-breakpoint
ALTER TABLE change_request_lines ADD CONSTRAINT change_request_lines_catalog_check CHECK ((source = 'catalog') = (catalog_item_id IS NOT NULL));
--> statement-breakpoint
ALTER TABLE change_request_lines DROP CONSTRAINT IF EXISTS change_request_lines_boq_check;
--> statement-breakpoint
-- A live-scope line is removed, replaced or moved; a move belongs to a live-scope line only.
ALTER TABLE change_request_lines ADD CONSTRAINT change_request_lines_boq_check
  CHECK ((source = 'boq_line') = (boq_line_id IS NOT NULL) AND (source <> 'boq_line' OR action IN ('omit', 'replace', 'move')) AND (action <> 'move' OR source = 'boq_line'));
--> statement-breakpoint
ALTER TABLE change_request_lines DROP CONSTRAINT IF EXISTS change_request_lines_catalog_item_fkey;
--> statement-breakpoint
ALTER TABLE change_request_lines ADD CONSTRAINT change_request_lines_catalog_item_fkey FOREIGN KEY (workspace_id, catalog_item_id) REFERENCES catalog_items (workspace_id, id);
--> statement-breakpoint
ALTER TABLE change_request_lines DROP CONSTRAINT IF EXISTS change_request_lines_boq_line_fkey;
--> statement-breakpoint
ALTER TABLE change_request_lines ADD CONSTRAINT change_request_lines_boq_line_fkey FOREIGN KEY (workspace_id, boq_line_id) REFERENCES project_boq_lines (workspace_id, id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS change_request_stage_impacts (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  change_request_id uuid NOT NULL,
  stage_id uuid NOT NULL,
  -- Working days the change adds to the stage (the work calendar's days, not calendar days).
  days integer NOT NULL CHECK (days BETWEEN 1 AND 365),
  PRIMARY KEY (workspace_id, change_request_id, stage_id),
  FOREIGN KEY (workspace_id, change_request_id) REFERENCES change_requests (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, stage_id) REFERENCES project_stages (workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS change_request_files (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  change_request_id uuid NOT NULL,
  original_name varchar(240) NOT NULL CHECK (length(btrim(original_name)) > 0),
  mime_type varchar(120) NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size > 0),
  object_key varchar(500) NOT NULL,
  preview_key varchar(500),
  sha256 char(64) NOT NULL,
  uploaded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, change_request_id) REFERENCES change_requests (workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS change_request_files_request_idx ON change_request_files (workspace_id, change_request_id, created_at);
--> statement-breakpoint
ALTER TABLE workspace_project_settings ADD COLUMN IF NOT EXISTS variation_payment_rule varchar(16) NOT NULL DEFAULT 'before_work';
--> statement-breakpoint
ALTER TABLE workspace_project_settings DROP CONSTRAINT IF EXISTS workspace_project_settings_variation_payment_rule_check;
--> statement-breakpoint
ALTER TABLE workspace_project_settings ADD CONSTRAINT workspace_project_settings_variation_payment_rule_check CHECK (variation_payment_rule IN ('before_work', 'next_milestone'));
--> statement-breakpoint
ALTER TABLE workspace_project_settings ADD COLUMN IF NOT EXISTS change_reminder_days smallint[] NOT NULL DEFAULT '{3,7}';
--> statement-breakpoint
ALTER TABLE workspace_project_settings DROP CONSTRAINT IF EXISTS workspace_project_settings_change_reminder_days_check;
--> statement-breakpoint
ALTER TABLE workspace_project_settings ADD CONSTRAINT workspace_project_settings_change_reminder_days_check
  CHECK (cardinality(change_reminder_days) <= 5 AND 1 <= ALL (change_reminder_days) AND 60 >= ALL (change_reminder_days));
--> statement-breakpoint
ALTER TABLE workspace_quotation_settings ADD COLUMN IF NOT EXISTS qs_variations varchar(8) NOT NULL DEFAULT 'rules';
--> statement-breakpoint
ALTER TABLE workspace_quotation_settings DROP CONSTRAINT IF EXISTS workspace_quotation_settings_qs_variations_check;
--> statement-breakpoint
ALTER TABLE workspace_quotation_settings ADD CONSTRAINT workspace_quotation_settings_qs_variations_check CHECK (qs_variations IN ('rules', 'never'));
--> statement-breakpoint
ALTER TABLE workspace_quotation_settings ADD COLUMN IF NOT EXISTS qs_variation_threshold numeric(18, 2);
--> statement-breakpoint
ALTER TABLE workspace_quotation_settings DROP CONSTRAINT IF EXISTS workspace_quotation_settings_qs_variation_threshold_check;
--> statement-breakpoint
ALTER TABLE workspace_quotation_settings ADD CONSTRAINT workspace_quotation_settings_qs_variation_threshold_check CHECK (qs_variation_threshold IS NULL OR qs_variation_threshold > 0);
--> statement-breakpoint
DO $$
DECLARE target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['change_request_stage_impacts', 'change_request_files'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', target);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = target AND policyname = 'tenant_isolation') THEN
      EXECUTE format($policy$CREATE POLICY tenant_isolation ON %I
        USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
        WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$, target);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    -- A change's days per stage are replaced while it is being priced; its files are only added.
    GRANT SELECT, INSERT, UPDATE, DELETE ON change_request_stage_impacts TO wodana_app;
    GRANT SELECT, INSERT ON change_request_files TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
-- Business records: a go-live reset clears them (a change's files with their stored objects).
INSERT INTO workspace_record_classification (table_name, disposition, clear_predicate, file_columns) VALUES
  ('change_request_stage_impacts', 'clear', NULL, '{}'),
  ('change_request_files', 'clear', NULL, ARRAY['object_key', 'preview_key'])
ON CONFLICT (table_name) DO UPDATE SET disposition = excluded.disposition,
  clear_predicate = excluded.clear_predicate, file_columns = excluded.file_columns;
