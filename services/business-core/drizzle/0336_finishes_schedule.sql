-- PLM-156, PLM-146, PLM-157: the finishes schedule, built on the materials and decisions ledger (one record).
--
-- 1. workspace_finish_settings: the firm's configuration. The finish categories (hard and soft finishes, whitegoods,
--    sanitary ware, lighting, sockets… each saying whether the client signs the physical sample or data sheet before
--    procurement, PLM-148), whether the final quotation waits for the final specification (PLM-146), the days the
--    designer has to mark the finishes and send them to QS, which design team parts may edit the quotation's material
--    column, and when the client's signature was first required (older procurement isn't blocked).
-- 2. design_ledger_entries: a material's finish category, where it goes in the room and the installation note (the
--    installation view). These are placement, not the client's choice: editing them doesn't touch the versions.
-- 3. design_ledger_versions: where the material comes from (own stock, a brand, or a local supplier, PLM-144/157), the
--    sample from the library it was chosen from and the sample's photo. Versions stay immutable (the trigger now
--    names these columns and the outsourced flag too).
-- 4. finish_snapshots: the designer's marking of a finish on a render snapshot (an uploaded crop with a marker and a
--    label, PLM-146). Archived, never deleted.
-- 5. finish_qs_handoffs + finish_qs_handoff_lines: "Send to QS": exactly which version of every finish went to the QS,
--    numbered per case. A finish changed since the latest hand-off is what makes the specification not final.
-- 6. finish_quote_links: a quotation line priced from a finish (by line id, which revisions keep), with the finish
--    version it was priced from. A finish changed since is the old price flagged on the line.
-- 7. quote_budget_ranges: a quotation sent as a budget range at the client's request (allowed before the final
--    specification; the final quotation waits for it).
-- 8. design_journey_tasks: the task 'finishes_to_qs' (mark the finishes and send them to QS, after the samples are
--    approved). The task list is extended, never rewritten.
-- Every new table: workspace_id, forced RLS, tenant_isolation. Idempotent; never disables RLS; nothing is backfilled.
CREATE TABLE IF NOT EXISTS workspace_finish_settings (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  -- Configuration: [{ "key": "sanitary_ware", "label": "Sanitary ware", "clientSignature": true }, …] in the firm's order.
  categories jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(categories) = 'array'),
  specification_gate boolean NOT NULL DEFAULT false,
  finishes_to_qs_days integer NOT NULL DEFAULT 3 CHECK (finishes_to_qs_days BETWEEN 1 AND 60),
  -- Design team parts (lead_designer, junior_designer, sales_admin…) that edit the quotation's material column; empty: whoever edits the quotation.
  material_editor_slots text[] NOT NULL DEFAULT '{}' CHECK (cardinality(material_editor_slots) <= 6),
  signature_required_since timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE design_ledger_entries
  ADD COLUMN IF NOT EXISTS category_key varchar(40) CHECK (category_key IS NULL OR category_key ~ '^[a-z][a-z0-9_]{0,39}$'),
  ADD COLUMN IF NOT EXISTS location varchar(200) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS install_note text NOT NULL DEFAULT '' CHECK (length(install_note) <= 2000);
--> statement-breakpoint
ALTER TABLE design_ledger_versions
  ADD COLUMN IF NOT EXISTS origin varchar(20) CHECK (origin IS NULL OR origin IN ('own_stock', 'brand', 'local_supplier')),
  ADD COLUMN IF NOT EXISTS sample_id uuid,
  ADD COLUMN IF NOT EXISTS sample_photo_asset_id uuid REFERENCES pre_project_brief_assets (id) ON DELETE SET NULL;
--> statement-breakpoint
-- A version's content is history: only its decision (proposed → confirmed/declined/superseded) may be written.
CREATE OR REPLACE FUNCTION design_ledger_versions_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.workspace_id, NEW.case_id, NEW.entry_id, NEW.number, NEW.title, NEW.specification, NEW.catalog_item_id, NEW.supplier, NEW.quantity, NEW.unit,
      NEW.unit_price, NEW.currency, NEW.price_impact, NEW.time_impact_days, NEW.source, NEW.said_at, NEW.evidence_note, NEW.note, NEW.after_lock,
      NEW.recorded_by, NEW.recorded_by_grant_id, NEW.recorded_at, NEW.outsourced, NEW.origin, NEW.sample_id)
     IS DISTINCT FROM
     (OLD.workspace_id, OLD.case_id, OLD.entry_id, OLD.number, OLD.title, OLD.specification, OLD.catalog_item_id, OLD.supplier, OLD.quantity, OLD.unit,
      OLD.unit_price, OLD.currency, OLD.price_impact, OLD.time_impact_days, OLD.source, OLD.said_at, OLD.evidence_note, OLD.note, OLD.after_lock,
      OLD.recorded_by, OLD.recorded_by_grant_id, OLD.recorded_at, OLD.outsourced, OLD.origin, OLD.sample_id) THEN
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
CREATE TABLE IF NOT EXISTS finish_snapshots (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  case_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  asset_id uuid NOT NULL REFERENCES pre_project_brief_assets (id),
  -- Where the marker sits on the snapshot, as a share of its width and height (0–100).
  marker_x numeric(5, 2) NOT NULL CHECK (marker_x BETWEEN 0 AND 100),
  marker_y numeric(5, 2) NOT NULL CHECK (marker_y BETWEEN 0 AND 100),
  label varchar(200) NOT NULL CHECK (length(btrim(label)) > 0),
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  archived_by uuid REFERENCES users (id),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, entry_id) REFERENCES design_ledger_entries (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, case_id) REFERENCES pre_project_cases (workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS finish_snapshots_entry_idx ON finish_snapshots (workspace_id, entry_id, created_at) WHERE archived_at IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS finish_qs_handoffs (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  case_id uuid NOT NULL,
  number integer NOT NULL CHECK (number > 0),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
  sent_by uuid NOT NULL REFERENCES users (id),
  sent_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, case_id, number),
  FOREIGN KEY (workspace_id, case_id) REFERENCES pre_project_cases (workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS finish_qs_handoff_lines (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  handoff_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  version_id uuid NOT NULL,
  PRIMARY KEY (workspace_id, handoff_id, entry_id),
  FOREIGN KEY (workspace_id, handoff_id) REFERENCES finish_qs_handoffs (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, entry_id) REFERENCES design_ledger_entries (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, version_id) REFERENCES design_ledger_versions (workspace_id, id)
);
--> statement-breakpoint
-- Quotation lines are rewritten by the commercial document's saves and keep their ids across revisions, so the link
-- names the line by id (no foreign key); a line that is gone simply isn't shown.
CREATE TABLE IF NOT EXISTS finish_quote_links (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  case_id uuid NOT NULL,
  line_id text NOT NULL CHECK (length(line_id) BETWEEN 1 AND 80),
  entry_id uuid NOT NULL,
  version_id uuid NOT NULL,
  linked_by uuid NOT NULL REFERENCES users (id),
  linked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, case_id, line_id),
  FOREIGN KEY (workspace_id, entry_id) REFERENCES design_ledger_entries (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, version_id) REFERENCES design_ledger_versions (workspace_id, id),
  FOREIGN KEY (workspace_id, case_id) REFERENCES pre_project_cases (workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS finish_quote_links_entry_idx ON finish_quote_links (workspace_id, entry_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS quote_budget_ranges (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  case_id uuid NOT NULL,
  quote_id text NOT NULL,
  -- What the client asked for (who and how), kept with the quotation.
  request_note text NOT NULL CHECK (length(btrim(request_note)) BETWEEN 1 AND 1000),
  marked_by uuid NOT NULL REFERENCES users (id),
  marked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, case_id, quote_id),
  FOREIGN KEY (workspace_id, case_id, quote_id) REFERENCES commercial_quotes (workspace_id, case_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
-- The work inside a step: 'finishes_to_qs' joins the task list (extended in place, so a task another release added stays).
--   -- adds to design_journey_tasks_task_check: 'finishes_to_qs'
DO $$
DECLARE
  definition text;
  allowed text[];
  existing text;
BEGIN
  SELECT conname, pg_get_constraintdef(oid) INTO existing, definition FROM pg_constraint
   WHERE conrelid = 'design_journey_tasks'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%team_allocation%' LIMIT 1;
  SELECT coalesce(array_agg(match[1] ORDER BY ordinality), '{}') INTO allowed
    FROM regexp_matches(coalesce(definition, ''), '''([a-z_]+)''', 'g') WITH ORDINALITY AS found (match, ordinality);
  IF NOT 'finishes_to_qs' = ANY (allowed) THEN
    allowed := allowed || ARRAY['finishes_to_qs'];
    IF existing IS NOT NULL THEN EXECUTE format('ALTER TABLE design_journey_tasks DROP CONSTRAINT %I', existing); END IF;
    EXECUTE format('ALTER TABLE design_journey_tasks ADD CONSTRAINT design_journey_tasks_task_check CHECK (task IN (%s))',
      (SELECT string_agg(quote_literal(task), ', ' ORDER BY position) FROM unnest(allowed) WITH ORDINALITY AS entry (task, position)));
  END IF;
END $$;
--> statement-breakpoint
DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['workspace_finish_settings', 'finish_snapshots', 'finish_qs_handoffs', 'finish_qs_handoff_lines', 'finish_quote_links', 'quote_budget_ranges'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = name AND policyname = 'tenant_isolation') THEN
      EXECUTE format($policy$CREATE POLICY tenant_isolation ON %I
        USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
        WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$, name);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON workspace_finish_settings, finish_snapshots TO wodana_app;
    -- A hand-off is what went to the QS: only added. A line's link moves to the finish's newer version, or is removed.
    GRANT SELECT, INSERT ON finish_qs_handoffs, finish_qs_handoff_lines TO wodana_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON finish_quote_links, quote_budget_ranges TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO workspace_record_classification (table_name, disposition, clear_predicate, file_columns) VALUES
  ('workspace_finish_settings', 'keep', NULL, '{}'),
  ('finish_snapshots', 'clear', NULL, '{}'),
  ('finish_qs_handoffs', 'clear', NULL, '{}'),
  ('finish_qs_handoff_lines', 'clear', NULL, '{}'),
  ('finish_quote_links', 'clear', NULL, '{}'),
  ('quote_budget_ranges', 'clear', NULL, '{}')
ON CONFLICT (table_name) DO UPDATE SET disposition = excluded.disposition,
  clear_predicate = excluded.clear_predicate, file_columns = excluded.file_columns;
