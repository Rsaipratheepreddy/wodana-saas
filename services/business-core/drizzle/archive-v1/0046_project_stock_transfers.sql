CREATE TABLE project_warehouse_stock (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES workspaces(id),
 location varchar(160) NOT NULL,catalog_id uuid NOT NULL,catalog_version integer NOT NULL,title varchar(240) NOT NULL,unit varchar(40) NOT NULL,
 quantity numeric(18,4) NOT NULL CHECK(quantity>=0),reserved numeric(18,4) NOT NULL DEFAULT 0 CHECK(reserved>=0 AND reserved<=quantity),
 opening_reference text NOT NULL,UNIQUE(workspace_id,id)
);
CREATE TABLE project_stock_transfers (
 id uuid PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES workspaces(id),project_id uuid NOT NULL,
 content jsonb NOT NULL,version integer NOT NULL DEFAULT 1,
 FOREIGN KEY(workspace_id,project_id) REFERENCES delivery_projects(workspace_id,id),UNIQUE(workspace_id,id)
);
CREATE TABLE project_stock_commands (
 workspace_id uuid NOT NULL REFERENCES workspaces(id),request_id uuid NOT NULL,payload_hash varchar(64) NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,request_id)
);
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['project_warehouse_stock','project_stock_transfers','project_stock_commands'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (workspace_id=NULLIF(current_setting(''app.current_workspace_id'',true),'''')::uuid) WITH CHECK (workspace_id=NULLIF(current_setting(''app.current_workspace_id'',true),'''')::uuid)',t);
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='wodana_app')THEN EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO wodana_app',t);END IF;
 END LOOP; END $$;
