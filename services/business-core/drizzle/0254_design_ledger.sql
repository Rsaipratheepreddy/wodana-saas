-- The materials and decisions ledger (plan §6.7a, PLM-054, edge cases E5-1/E5-2/E5-4).
--   * design_ledger_entries: one row per material or design choice on a case (its room, its place in the list).
--   * design_ledger_versions: every change is a new immutable version with its source (portal, meeting, WhatsApp,
--     site…), when it was said, evidence, price and time impact (numeric money), and the client's confirmation
--     (who, when, how). Content columns never change after insert (trigger); only a proposed version's decision does.
--   * design_ledger_locks + design_ledger_lock_lines: the list is locked at design sign-off (exactly which version
--     of each entry); a later change is a new version and a new lock once approved. Procurement reads the latest lock
--     and is blocked until there is one.
-- Every table has workspace_id, forced RLS and the tenant_isolation policy. Idempotent; never disables RLS.
CREATE TABLE IF NOT EXISTS design_ledger_entries (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  case_id uuid NOT NULL,
  kind varchar(12) NOT NULL CHECK (kind IN ('material', 'design')),
  room_id uuid REFERENCES pre_project_rooms (id) ON DELETE SET NULL,
  position integer NOT NULL DEFAULT 0,
  current_number integer NOT NULL DEFAULT 1 CHECK (current_number > 0),
  archived_at timestamptz,
  archived_by uuid,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, case_id) REFERENCES pre_project_cases (workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS design_ledger_versions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  case_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  number integer NOT NULL CHECK (number > 0),
  title varchar(240) NOT NULL CHECK (length(trim(title)) > 0),
  specification text NOT NULL DEFAULT '' CHECK (length(specification) <= 2000),
  catalog_item_id uuid REFERENCES catalog_items (id) ON DELETE SET NULL,
  supplier varchar(200) NOT NULL DEFAULT '',
  quantity numeric(14, 4) CHECK (quantity IS NULL OR quantity > 0),
  unit varchar(40) NOT NULL DEFAULT '',
  unit_price numeric(14, 2) CHECK (unit_price IS NULL OR unit_price >= 0),
  currency char(3) CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  -- Against the version it replaces (zero for the first): what the change adds to the price and the programme.
  price_impact numeric(14, 2) NOT NULL DEFAULT 0,
  time_impact_days integer NOT NULL DEFAULT 0 CHECK (time_impact_days BETWEEN -365 AND 365),
  source varchar(20) NOT NULL CHECK (source IN ('portal', 'meeting', 'whatsapp', 'email', 'phone', 'site', 'showroom')),
  said_at timestamptz NOT NULL,
  evidence_asset_id uuid REFERENCES pre_project_brief_assets (id) ON DELETE SET NULL,
  evidence_note text NOT NULL DEFAULT '' CHECK (length(evidence_note) <= 2000),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
  after_lock boolean NOT NULL DEFAULT false,
  status varchar(12) NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'confirmed', 'declined', 'superseded')),
  confirmed_at timestamptz,
  confirmation_method varchar(20) CHECK (confirmation_method IS NULL OR confirmation_method IN ('portal', 'signed_document', 'email', 'in_person', 'phone', 'message')),
  confirmed_by_name varchar(200),
  confirmed_by_grant_id uuid,
  confirmation_recorded_by uuid,
  confirmation_note text CHECK (confirmation_note IS NULL OR length(confirmation_note) <= 2000),
  recorded_by uuid,
  recorded_by_grant_id uuid,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, entry_id, number),
  FOREIGN KEY (workspace_id, entry_id) REFERENCES design_ledger_entries (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, case_id, confirmed_by_grant_id) REFERENCES client_portal_grants (workspace_id, case_id, id),
  FOREIGN KEY (workspace_id, case_id, recorded_by_grant_id) REFERENCES client_portal_grants (workspace_id, case_id, id),
  CHECK ((recorded_by IS NULL) <> (recorded_by_grant_id IS NULL)),
  CHECK (status NOT IN ('confirmed', 'declined') OR (confirmed_at IS NOT NULL AND confirmation_method IS NOT NULL AND confirmed_by_name IS NOT NULL)),
  CHECK (confirmation_method IS DISTINCT FROM 'portal' OR confirmed_by_grant_id IS NOT NULL),
  CHECK (unit_price IS NULL OR currency IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS design_ledger_entries_case_idx ON design_ledger_entries (workspace_id, case_id, position);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS design_ledger_versions_entry_idx ON design_ledger_versions (workspace_id, entry_id, number DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS design_ledger_locks (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  case_id uuid NOT NULL,
  number integer NOT NULL CHECK (number > 0),
  reason varchar(20) NOT NULL CHECK (reason IN ('design_sign_off', 'change_approved')),
  note text CHECK (note IS NULL OR length(note) <= 2000),
  locked_by uuid NOT NULL,
  locked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, case_id, number),
  FOREIGN KEY (workspace_id, case_id) REFERENCES pre_project_cases (workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS design_ledger_lock_lines (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  lock_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  version_id uuid NOT NULL,
  PRIMARY KEY (workspace_id, lock_id, entry_id),
  FOREIGN KEY (workspace_id, lock_id) REFERENCES design_ledger_locks (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, entry_id) REFERENCES design_ledger_entries (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, version_id) REFERENCES design_ledger_versions (workspace_id, id)
);
--> statement-breakpoint
-- A version's content is history: only its decision (proposed → confirmed/declined/superseded) may be written.
CREATE OR REPLACE FUNCTION design_ledger_versions_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.workspace_id, NEW.case_id, NEW.entry_id, NEW.number, NEW.title, NEW.specification, NEW.catalog_item_id, NEW.supplier, NEW.quantity, NEW.unit,
      NEW.unit_price, NEW.currency, NEW.price_impact, NEW.time_impact_days, NEW.source, NEW.said_at, NEW.evidence_note, NEW.note, NEW.after_lock,
      NEW.recorded_by, NEW.recorded_by_grant_id, NEW.recorded_at)
     IS DISTINCT FROM
     (OLD.workspace_id, OLD.case_id, OLD.entry_id, OLD.number, OLD.title, OLD.specification, OLD.catalog_item_id, OLD.supplier, OLD.quantity, OLD.unit,
      OLD.unit_price, OLD.currency, OLD.price_impact, OLD.time_impact_days, OLD.source, OLD.said_at, OLD.evidence_note, OLD.note, OLD.after_lock,
      OLD.recorded_by, OLD.recorded_by_grant_id, OLD.recorded_at) THEN
    RAISE EXCEPTION 'A ledger version is never edited; record a new version' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('confirmed', 'declined') AND NEW.status IS DISTINCT FROM OLD.status AND NEW.status <> 'superseded' THEN
    RAISE EXCEPTION 'The client''s decision on a ledger version is final' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('confirmed', 'declined') AND (NEW.confirmed_at, NEW.confirmation_method, NEW.confirmed_by_name, NEW.confirmed_by_grant_id, NEW.confirmation_recorded_by, NEW.confirmation_note)
     IS DISTINCT FROM (OLD.confirmed_at, OLD.confirmation_method, OLD.confirmed_by_name, OLD.confirmed_by_grant_id, OLD.confirmation_recorded_by, OLD.confirmation_note) THEN
    RAISE EXCEPTION 'The client''s decision on a ledger version is final' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS design_ledger_versions_immutable ON design_ledger_versions;
--> statement-breakpoint
CREATE TRIGGER design_ledger_versions_immutable BEFORE UPDATE ON design_ledger_versions FOR EACH ROW EXECUTE FUNCTION design_ledger_versions_immutable();
--> statement-breakpoint
DO $$
DECLARE target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['design_ledger_entries', 'design_ledger_versions', 'design_ledger_locks', 'design_ledger_lock_lines'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', target);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = target AND policyname = 'tenant_isolation') THEN
      EXECUTE format($policy$CREATE POLICY tenant_isolation ON %I
        USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
        WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$, target);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    -- History is never deleted: entries are archived, versions superseded, locks only added.
    GRANT SELECT, INSERT, UPDATE ON design_ledger_entries TO wodana_app;
    GRANT SELECT, INSERT, UPDATE ON design_ledger_versions TO wodana_app;
    GRANT SELECT, INSERT ON design_ledger_locks TO wodana_app;
    GRANT SELECT, INSERT ON design_ledger_lock_lines TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('design.ledger_confirmed', 'in_app', '{{clientName}} confirmed {{title}}', '{{note}}', '["clientName","title","note"]'),
  ('design.ledger_changed', 'in_app', 'Change after sign-off · {{clientName}}', '{{title}}: {{impact}}. Procurement keeps the signed-off version until the change is approved.', '["clientName","title","impact"]'),
  ('design.ledger_changed', 'email', 'Change after sign-off: {{clientName}}', E'{{title}} changed after the material list was signed off.\n\nImpact: {{impact}}\n\nProcurement keeps the signed-off version until the change is approved.', '["clientName","title","impact"]')
) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
