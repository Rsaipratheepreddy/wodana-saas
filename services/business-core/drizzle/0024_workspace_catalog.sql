CREATE TABLE workspace_catalog_records (
 workspace_id uuid NOT NULL REFERENCES workspaces(id),
 id uuid NOT NULL,
 kind varchar(24) NOT NULL CHECK (kind IN ('room','work','category','material','finish','brand','unit','service')),
 code varchar(80) NOT NULL,
 name varchar(180) NOT NULL CHECK (length(btrim(name)) > 0),
 content jsonb NOT NULL CHECK (jsonb_typeof(content) = 'object'),
 starter_version varchar(40),
 version integer NOT NULL DEFAULT 1 CHECK (version > 0),
 archived boolean NOT NULL DEFAULT false,
 created_by uuid NOT NULL REFERENCES users(id),
 updated_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,id),
 UNIQUE(workspace_id,kind,code)
);
CREATE UNIQUE INDEX workspace_catalog_name_idx ON workspace_catalog_records(workspace_id,kind,lower(name));
CREATE INDEX workspace_catalog_kind_idx ON workspace_catalog_records(workspace_id,kind,archived);
CREATE TABLE workspace_catalog_links (
 workspace_id uuid NOT NULL,
 record_id uuid NOT NULL,
 target_id uuid NOT NULL,
 relation varchar(24) NOT NULL CHECK (relation IN ('room','category','unit','brand','material','finish')),
 PRIMARY KEY(workspace_id,record_id,relation,target_id),
 FOREIGN KEY(workspace_id,record_id) REFERENCES workspace_catalog_records(workspace_id,id),
 FOREIGN KEY(workspace_id,target_id) REFERENCES workspace_catalog_records(workspace_id,id),
 CHECK(record_id <> target_id)
);
CREATE INDEX workspace_catalog_links_target_idx ON workspace_catalog_links(workspace_id,target_id);
--> statement-breakpoint
ALTER TABLE workspace_catalog_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_catalog_records FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workspace_catalog_records
 USING(workspace_id = NULLIF(current_setting('app.current_workspace_id',true),'')::uuid)
 WITH CHECK(workspace_id = NULLIF(current_setting('app.current_workspace_id',true),'')::uuid);
ALTER TABLE workspace_catalog_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_catalog_links FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workspace_catalog_links
 USING(workspace_id = NULLIF(current_setting('app.current_workspace_id',true),'')::uuid)
 WITH CHECK(workspace_id = NULLIF(current_setting('app.current_workspace_id',true),'')::uuid);
INSERT INTO permissions(code,description) VALUES
 ('catalog.view','View workspace catalog and use master data in operations'),
 ('catalog.manage','Manage workspace catalog, starter data and specifications') ON CONFLICT(code) DO NOTHING;
ALTER TABLE roles DISABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions DISABLE ROW LEVEL SECURITY;
INSERT INTO role_permissions(workspace_id,role_id,permission_id)
 SELECT r.workspace_id,r.id,p.id FROM roles r CROSS JOIN permissions p
 WHERE r.is_system=true AND ((r.code IN ('owner','administrator') AND p.code IN ('catalog.view','catalog.manage')) OR (r.code IN ('member','viewer') AND p.code='catalog.view'))
 ON CONFLICT(role_id,permission_id) DO NOTHING;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='wodana_app') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON workspace_catalog_records,workspace_catalog_links TO wodana_app;
 END IF;
END $$;
