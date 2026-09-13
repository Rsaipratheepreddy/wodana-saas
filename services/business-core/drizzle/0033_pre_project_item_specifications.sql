CREATE TABLE pre_project_item_specifications (
 workspace_id uuid NOT NULL, case_id uuid NOT NULL, entry_id uuid NOT NULL, version integer NOT NULL CHECK(version>0),
 content jsonb NOT NULL, created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,case_id,entry_id,version),
 FOREIGN KEY(workspace_id,case_id,entry_id) REFERENCES pre_project_brief_entries(workspace_id,case_id,id)
);
CREATE TABLE pre_project_specification_catalog_refs (
 workspace_id uuid NOT NULL, case_id uuid NOT NULL, entry_id uuid NOT NULL, version integer NOT NULL, record_id uuid NOT NULL,
 PRIMARY KEY(workspace_id,case_id,entry_id,version,record_id),
 FOREIGN KEY(workspace_id,case_id,entry_id,version) REFERENCES pre_project_item_specifications(workspace_id,case_id,entry_id,version),
 FOREIGN KEY(workspace_id,record_id) REFERENCES workspace_catalog_records(workspace_id,id)
);
CREATE UNIQUE INDEX pre_project_design_versions_case_id_key ON pre_project_design_versions(workspace_id,case_id,id);
CREATE TABLE pre_project_item_design_refs (
 workspace_id uuid NOT NULL, case_id uuid NOT NULL, entry_id uuid NOT NULL, version integer NOT NULL,
 design_version_id uuid NOT NULL, usage varchar(10) NOT NULL CHECK(usage IN ('2d','3d','reference')), sheet varchar(120) NOT NULL DEFAULT '',
 PRIMARY KEY(workspace_id,case_id,entry_id,version,design_version_id),
 FOREIGN KEY(workspace_id,case_id,entry_id,version) REFERENCES pre_project_item_specifications(workspace_id,case_id,entry_id,version),
 FOREIGN KEY(workspace_id,case_id,design_version_id) REFERENCES pre_project_design_versions(workspace_id,case_id,id)
);
--> statement-breakpoint
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['pre_project_item_specifications','pre_project_specification_catalog_refs','pre_project_item_design_refs'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_isolation ON %I USING(workspace_id=NULLIF(current_setting(''app.current_workspace_id'',true),'''')::uuid) WITH CHECK(workspace_id=NULLIF(current_setting(''app.current_workspace_id'',true),'''')::uuid)',t);
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='wodana_app')THEN EXECUTE format('GRANT SELECT,INSERT ON %I TO wodana_app',t);END IF;
 END LOOP;
END $$;
