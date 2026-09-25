CREATE TABLE pre_project_design_folders (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, case_id uuid NOT NULL,
 name varchar(160) NOT NULL CHECK(length(trim(name))>0), description text NOT NULL DEFAULT '',
 room_id uuid, version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,case_id,id),
 FOREIGN KEY(workspace_id,case_id) REFERENCES pre_project_cases(workspace_id,id),
 FOREIGN KEY(workspace_id,case_id,room_id) REFERENCES pre_project_rooms(workspace_id,case_id,id)
);
CREATE UNIQUE INDEX pre_project_design_folders_name_key ON pre_project_design_folders(workspace_id,case_id,lower(name));
ALTER TABLE pre_project_design_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE pre_project_design_folders FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pre_project_design_folders USING(workspace_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid) WITH CHECK(workspace_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid);
ALTER TABLE pre_project_designs ADD COLUMN folder_id uuid;
ALTER TABLE pre_project_designs ADD CONSTRAINT pre_project_design_folder_fk FOREIGN KEY(workspace_id,case_id,folder_id) REFERENCES pre_project_design_folders(workspace_id,case_id,id);
ALTER TABLE pre_project_design_versions ADD COLUMN reviewer_id uuid REFERENCES users(id);
ALTER TABLE pre_project_design_activity ADD COLUMN reviewer_id uuid REFERENCES users(id);
ALTER TABLE pre_project_design_activity ADD COLUMN decision_source varchar(30);
ALTER TABLE pre_project_design_activity ADD COLUMN decision_at timestamptz;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='wodana_app') THEN
 GRANT SELECT,INSERT,UPDATE ON pre_project_design_folders TO wodana_app;
 REVOKE UPDATE,DELETE ON pre_project_design_activity FROM wodana_app;
 REVOKE DELETE ON pre_project_design_versions FROM wodana_app;
END IF; END $$;
INSERT INTO permissions(code,description) VALUES
 ('pre_projects.review_designs','Review assigned internal design revisions'),
 ('pre_projects.record_client_design_decisions','Record attributed client design decisions received outside the portal') ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(workspace_id,role_id,permission_id)
 SELECT r.workspace_id,r.id,p.id FROM roles r CROSS JOIN permissions p
 WHERE r.is_system=true AND r.code IN ('owner','administrator') AND p.code IN ('pre_projects.review_designs','pre_projects.record_client_design_decisions')
 ON CONFLICT(role_id,permission_id) DO NOTHING;
