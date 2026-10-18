-- Linked spreadsheet imports (PLM-073 stock list, PLM-124 product catalogue). A firm keeps its stock list or its
-- product list in a spreadsheet; Wodana imports it (an uploaded file, or a linked Google Sheet refreshed on a
-- schedule) through the module's own commands, so every rule still applies.
--   * import_links: one source and how its columns map to Wodana fields (configuration), its target (stock at a
--     place, or one catalog), whether the sheet sets stock quantities, the schedule and its owner.
--   * import_link_records: which Wodana record each key (item code, and place for stock) became, the quantity
--     last taken from the sheet, and since when a key is no longer in the sheet (flagged, never deleted).
--   * import_runs: every apply (who or the schedule, when, the source's fingerprint, counts, and why it failed).
--   * import_run_rows: what each run did to a row that wasn't unchanged (added, changed, error, not in sheet).
-- A product's production time lives on the catalog item.
ALTER TABLE catalog_items ADD COLUMN production_days integer CHECK (production_days IS NULL OR production_days BETWEEN 0 AND 3650);
--> statement-breakpoint
CREATE TABLE import_links (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  target varchar(8) NOT NULL CHECK (target IN ('stock', 'catalog')),
  catalog_id uuid,
  -- Stock: where the sheet's quantities are (a row naming another place goes there).
  location_id uuid,
  -- Catalog: what a new item is, unless the sheet has a type column.
  item_type varchar(16) CHECK (item_type IS NULL OR item_type IN ('product', 'material', 'assembly', 'service', 'package', 'ready_made')),
  source varchar(12) NOT NULL CHECK (source IN ('upload', 'google_sheet')),
  name varchar(200) NOT NULL CHECK (length(btrim(name)) > 0),
  connection_id uuid REFERENCES integration_connections (id),
  spreadsheet_id varchar(200),
  -- One tab, or every tab when empty.
  sheet_name varchar(200),
  -- Configuration: {"columns": {"<column heading>": "<field>"}}.
  mapping jsonb NOT NULL CHECK (jsonb_typeof(mapping) = 'object'),
  sets_stock boolean NOT NULL DEFAULT true,
  schedule varchar(8) NOT NULL DEFAULT 'hourly' CHECK (schedule IN ('off', 'hourly', 'daily')),
  next_run_at timestamptz,
  claimed_until timestamptz,
  owner_id uuid NOT NULL REFERENCES users (id),
  status varchar(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, catalog_id) REFERENCES catalogs (workspace_id, id),
  FOREIGN KEY (workspace_id, location_id) REFERENCES stock_locations (workspace_id, id),
  CHECK ((target = 'catalog') = (catalog_id IS NOT NULL)),
  CHECK (target <> 'stock' OR location_id IS NOT NULL),
  CHECK ((source = 'google_sheet') = (connection_id IS NOT NULL AND spreadsheet_id IS NOT NULL)),
  -- Only a linked sheet refreshes by itself.
  CHECK (source = 'google_sheet' OR schedule = 'off')
);
--> statement-breakpoint
CREATE INDEX import_links_target_idx ON import_links (workspace_id, target, status);
--> statement-breakpoint
CREATE INDEX import_links_due_idx ON import_links (next_run_at) WHERE status = 'active' AND schedule <> 'off';
--> statement-breakpoint
CREATE TRIGGER import_links_connection_id_workspace_guard BEFORE INSERT OR UPDATE ON import_links
  FOR EACH ROW EXECUTE FUNCTION enforce_same_workspace_reference('integration_connections', 'connection_id');
--> statement-breakpoint
CREATE TABLE import_link_records (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  link_id uuid NOT NULL,
  key_value varchar(200) NOT NULL CHECK (length(btrim(key_value)) > 0),
  location_id uuid,
  -- The stock item or catalog item the key became.
  record_id uuid NOT NULL,
  last_quantity numeric(18, 4) CHECK (last_quantity IS NULL OR last_quantity >= 0),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  missing_since timestamptz,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, link_id) REFERENCES import_links (workspace_id, id),
  FOREIGN KEY (workspace_id, location_id) REFERENCES stock_locations (workspace_id, id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX import_link_records_key ON import_link_records (workspace_id, link_id, lower(key_value), coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid));
--> statement-breakpoint
CREATE TABLE import_runs (
  id uuid PRIMARY KEY,
  -- The order runs happened in.
  seq bigint GENERATED ALWAYS AS IDENTITY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  link_id uuid NOT NULL,
  trigger varchar(10) NOT NULL CHECK (trigger IN ('manual', 'schedule')),
  started_by uuid REFERENCES users (id),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz NOT NULL DEFAULT now(),
  status varchar(10) NOT NULL CHECK (status IN ('applied', 'partial', 'failed')),
  fingerprint char(64),
  added integer NOT NULL DEFAULT 0 CHECK (added >= 0),
  changed integer NOT NULL DEFAULT 0 CHECK (changed >= 0),
  unchanged integer NOT NULL DEFAULT 0 CHECK (unchanged >= 0),
  errors integer NOT NULL DEFAULT 0 CHECK (errors >= 0),
  missing integer NOT NULL DEFAULT 0 CHECK (missing >= 0),
  -- What the bad rows were, so the owner hears once per new set of problems.
  error_digest char(64),
  message varchar(500) NOT NULL DEFAULT '',
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, link_id) REFERENCES import_links (workspace_id, id),
  CHECK (trigger = 'schedule' OR started_by IS NOT NULL),
  CHECK (status <> 'failed' OR length(btrim(message)) > 0)
);
--> statement-breakpoint
CREATE INDEX import_runs_link_idx ON import_runs (workspace_id, link_id, seq DESC);
--> statement-breakpoint
CREATE TABLE import_run_rows (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  run_id uuid NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  sheet varchar(200) NOT NULL DEFAULT '',
  line integer CHECK (line IS NULL OR line > 0),
  key_value varchar(200) NOT NULL DEFAULT '',
  name varchar(240) NOT NULL DEFAULT '',
  outcome varchar(10) NOT NULL CHECK (outcome IN ('added', 'changed', 'error', 'missing')),
  message varchar(1000) NOT NULL DEFAULT '',
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, run_id, position),
  FOREIGN KEY (workspace_id, run_id) REFERENCES import_runs (workspace_id, id)
);
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['import_links', 'import_link_records', 'import_runs', 'import_run_rows'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($policy$CREATE POLICY tenant_isolation ON %I
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$, t);
  END LOOP;
END $$;
--> statement-breakpoint
-- The schedule: workspaces with a linked sheet due for its refresh (and not already being refreshed). Each is
-- then refreshed in its own tenant transaction.
CREATE OR REPLACE FUNCTION public.list_import_link_workspaces_due() RETURNS TABLE(workspace_id uuid)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT DISTINCT link.workspace_id FROM import_links link
   WHERE link.status = 'active' AND link.schedule <> 'off' AND link.source = 'google_sheet'
     AND (link.next_run_at IS NULL OR link.next_run_at <= now())
     AND (link.claimed_until IS NULL OR link.claimed_until < now());
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.list_import_link_workspaces_due() FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON import_links, import_link_records TO wodana_app;
    GRANT SELECT, INSERT ON import_runs, import_run_rows TO wodana_app;
    GRANT EXECUTE ON FUNCTION public.list_import_link_workspaces_due() TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
-- The link's owner hears when a refresh fails or leaves rows it couldn't import.
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, '["name", "note"]'::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('linked_import.failed', 'in_app', '{{name}} didn''t refresh', '{{note}}'),
  ('linked_import.failed', 'email', '{{name}} didn''t refresh', '{{note}}

Open the import to check the link.'),
  ('linked_import.row_errors', 'in_app', '{{name}}: some rows weren''t imported', '{{note}}')
) AS template (code, channel, subject, body)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
