CREATE TABLE pre_project_site_records (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, case_id uuid NOT NULL,
 kind varchar(20) NOT NULL CHECK(kind IN ('visit','measurement','observation')),
 room_id uuid, entry_id uuid, visit_id uuid,
 title varchar(240) NOT NULL CHECK(length(trim(title))>0),
 status varchar(24) NOT NULL, version integer NOT NULL CHECK(version>0), content jsonb NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid NOT NULL REFERENCES users(id), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,case_id,id),
 FOREIGN KEY(workspace_id,case_id) REFERENCES pre_project_cases(workspace_id,id),
 FOREIGN KEY(workspace_id,case_id,room_id) REFERENCES pre_project_rooms(workspace_id,case_id,id),
 FOREIGN KEY(workspace_id,case_id,entry_id) REFERENCES pre_project_brief_entries(workspace_id,case_id,id),
 FOREIGN KEY(workspace_id,case_id,visit_id) REFERENCES pre_project_site_records(workspace_id,case_id,id),
 CHECK((kind='visit' AND status IN ('planned','completed','cancelled') AND room_id IS NULL AND entry_id IS NULL AND visit_id IS NULL)
 OR (kind='measurement' AND status IN ('incomplete','measured','verified','recheck') AND (room_id IS NOT NULL OR entry_id IS NOT NULL))
 OR (kind='observation' AND status IN ('open','resolved')))
);
CREATE INDEX pre_project_site_case_idx ON pre_project_site_records(workspace_id,case_id,kind,updated_at DESC);
CREATE UNIQUE INDEX pre_project_site_item_measurement_key ON pre_project_site_records(workspace_id,case_id,entry_id) WHERE kind='measurement' AND entry_id IS NOT NULL;
CREATE TABLE pre_project_site_revisions (
 workspace_id uuid NOT NULL, case_id uuid NOT NULL, record_id uuid NOT NULL, version integer NOT NULL CHECK(version>0),
 content jsonb NOT NULL, created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,case_id,record_id,version),
 FOREIGN KEY(workspace_id,case_id,record_id) REFERENCES pre_project_site_records(workspace_id,case_id,id)
);
CREATE TABLE pre_project_site_assets (
 workspace_id uuid NOT NULL, case_id uuid NOT NULL, record_id uuid NOT NULL, version integer NOT NULL, asset_id uuid NOT NULL,
 PRIMARY KEY(workspace_id,case_id,record_id,version,asset_id),
 FOREIGN KEY(workspace_id,case_id,record_id,version) REFERENCES pre_project_site_revisions(workspace_id,case_id,record_id,version),
 FOREIGN KEY(workspace_id,case_id,asset_id) REFERENCES pre_project_brief_assets(workspace_id,case_id,id)
);
CREATE TABLE pre_project_site_specification_refs (
 workspace_id uuid NOT NULL, case_id uuid NOT NULL, record_id uuid NOT NULL, version integer NOT NULL, entry_id uuid NOT NULL, specification_version integer NOT NULL,
 PRIMARY KEY(workspace_id,case_id,record_id,version),
 FOREIGN KEY(workspace_id,case_id,record_id,version) REFERENCES pre_project_site_revisions(workspace_id,case_id,record_id,version),
 FOREIGN KEY(workspace_id,case_id,entry_id,specification_version) REFERENCES pre_project_item_specifications(workspace_id,case_id,entry_id,version)
);
--> statement-breakpoint
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['pre_project_site_records','pre_project_site_revisions','pre_project_site_assets','pre_project_site_specification_refs'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_isolation ON %I USING(workspace_id=NULLIF(current_setting(''app.current_workspace_id'',true),'''')::uuid) WITH CHECK(workspace_id=NULLIF(current_setting(''app.current_workspace_id'',true),'''')::uuid)',t);
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='wodana_app') THEN
   EXECUTE format('GRANT SELECT,INSERT ON %I TO wodana_app',t);
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='wodana_app') THEN GRANT UPDATE ON pre_project_site_records TO wodana_app; END IF;
END $$;
INSERT INTO permissions(code,description) VALUES('pre_projects.verify_measurements','Verify site measurements and request a recheck') ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(workspace_id,role_id,permission_id)
SELECT r.workspace_id,r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.is_system=true AND r.code IN ('owner','administrator') AND p.code='pre_projects.verify_measurements'
ON CONFLICT(role_id,permission_id) DO NOTHING;
