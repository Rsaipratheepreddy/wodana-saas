-- Moodboard: inspiration pins (images, links, notes) placed freely on a board, each optionally tied
-- to the requirements it informs. Layout is its own table so moving a pin never rewrites the record.
CREATE TABLE pre_project_moodboard_pins (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES pre_project_cases (id) ON DELETE CASCADE,
  entry_id uuid NOT NULL,
  x integer NOT NULL DEFAULT 0 CHECK (x BETWEEN -20000 AND 20000),
  y integer NOT NULL DEFAULT 0 CHECK (y BETWEEN -20000 AND 20000),
  width integer NOT NULL DEFAULT 240 CHECK (width BETWEEN 120 AND 960),
  z integer NOT NULL DEFAULT 0 CHECK (z BETWEEN 0 AND 100000),
  sentiment varchar(8) NOT NULL DEFAULT 'love' CHECK (sentiment IN ('love', 'avoid')),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, entry_id)
);
--> statement-breakpoint
CREATE TABLE pre_project_entry_requirement_links (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES pre_project_cases (id) ON DELETE CASCADE,
  entry_id uuid NOT NULL,
  requirement_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, entry_id, requirement_id),
  CHECK (entry_id <> requirement_id)
);
--> statement-breakpoint
CREATE INDEX pre_project_entry_requirement_links_requirement_idx ON pre_project_entry_requirement_links (workspace_id, requirement_id);
--> statement-breakpoint
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['pre_project_moodboard_pins', 'pre_project_entry_requirement_links'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$p$, table_name);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO wodana_app', table_name);
    END IF;
  END LOOP;
END $$;
