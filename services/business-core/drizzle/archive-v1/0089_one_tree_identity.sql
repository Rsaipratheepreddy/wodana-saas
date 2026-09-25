-- P03.1: additive Job tree identity. Business facts remain in their source tables.
-- No automatic backfill runs in this migration.
CREATE TABLE one_tree_nodes (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  job_id uuid NOT NULL,
  case_id uuid NOT NULL,
  parent_id uuid,
  kind varchar(12) NOT NULL CHECK (kind IN ('site','room','zone','item')),
  source_type varchar(20) NOT NULL CHECK (source_type IN ('case','room','brief_entry','manual')),
  source_id uuid NOT NULL,
  status varchar(12) NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  replaces_node_id uuid,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, case_id, source_type, source_id),
  FOREIGN KEY (workspace_id, job_id) REFERENCES job_identities(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, case_id) REFERENCES pre_project_cases(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, parent_id) REFERENCES one_tree_nodes(workspace_id, id),
  FOREIGN KEY (workspace_id, replaces_node_id) REFERENCES one_tree_nodes(workspace_id, id),
  CHECK ((kind='site' AND parent_id IS NULL) OR (kind<>'site' AND parent_id IS NOT NULL)),
  CHECK ((kind='site' AND source_type IN ('case','manual')) OR
         (kind='room' AND source_type='room') OR
         (kind='zone' AND source_type='manual') OR
         (kind='item' AND source_type='brief_entry')),
  CHECK ((status='active' AND archived_at IS NULL) OR (status='archived' AND archived_at IS NOT NULL)),
  CHECK (replaces_node_id IS NULL OR replaces_node_id <> id)
);
CREATE INDEX one_tree_nodes_job_idx ON one_tree_nodes(workspace_id,job_id,kind,status,created_at,id);
CREATE INDEX one_tree_nodes_case_idx ON one_tree_nodes(workspace_id,case_id,parent_id,kind,status);

CREATE TABLE one_tree_node_revisions (
  workspace_id uuid NOT NULL,
  node_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  source_version integer NOT NULL CHECK (source_version >= 0),
  source_hash varchar(64) NOT NULL CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  label varchar(240) NOT NULL CHECK (length(trim(label)) > 0),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot)='object'),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id,node_id,revision),
  UNIQUE (workspace_id,node_id,source_hash),
  FOREIGN KEY (workspace_id,node_id) REFERENCES one_tree_nodes(workspace_id,id) ON DELETE CASCADE
);
CREATE INDEX one_tree_node_revisions_latest_idx ON one_tree_node_revisions(workspace_id,node_id,revision DESC);

ALTER TABLE pre_project_site_records ADD COLUMN site_id uuid;
ALTER TABLE pre_project_site_records
  ADD CONSTRAINT pre_project_site_records_tree_site_fk
  FOREIGN KEY (workspace_id,site_id) REFERENCES one_tree_nodes(workspace_id,id);
CREATE INDEX pre_project_site_records_tree_site_idx
  ON pre_project_site_records(workspace_id,case_id,site_id,kind,updated_at DESC);

ALTER TABLE one_tree_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE one_tree_nodes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON one_tree_nodes
  USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
ALTER TABLE one_tree_node_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE one_tree_node_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON one_tree_node_revisions
  USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON one_tree_nodes TO wodana_app;
    GRANT SELECT, INSERT ON one_tree_node_revisions TO wodana_app;
  END IF;
END $$;
