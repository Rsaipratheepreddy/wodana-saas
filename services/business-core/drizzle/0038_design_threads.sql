CREATE TABLE pre_project_design_threads (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, case_id uuid NOT NULL, design_id uuid NOT NULL, version_id uuid NOT NULL,
 title varchar(240) NOT NULL CHECK(length(trim(title))>0), blocking boolean NOT NULL DEFAULT false,
 status varchar(12) NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')), version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 resolved_by uuid REFERENCES users(id), resolved_at timestamptz,
 UNIQUE(workspace_id,case_id,design_id,id),
 FOREIGN KEY(workspace_id,case_id,design_id,version_id) REFERENCES pre_project_design_versions(workspace_id,case_id,design_id,id)
);
CREATE TABLE pre_project_design_messages (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, case_id uuid NOT NULL, design_id uuid NOT NULL, thread_id uuid NOT NULL,
 body text NOT NULL CHECK(length(trim(body))>0 AND length(body)<=5000),
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,case_id,design_id,thread_id) REFERENCES pre_project_design_threads(workspace_id,case_id,design_id,id)
);
CREATE INDEX pre_project_design_threads_revision_idx ON pre_project_design_threads(workspace_id,case_id,design_id,version_id);
CREATE INDEX pre_project_design_messages_thread_idx ON pre_project_design_messages(workspace_id,thread_id,created_at);
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['pre_project_design_threads','pre_project_design_messages'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY tenant_isolation ON %I USING(workspace_id=NULLIF(current_setting(''app.current_workspace_id'',true),'''')::uuid) WITH CHECK(workspace_id=NULLIF(current_setting(''app.current_workspace_id'',true),'''')::uuid)',t);
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='wodana_app') THEN EXECUTE format('GRANT SELECT,INSERT ON %I TO wodana_app',t);END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='wodana_app') THEN GRANT UPDATE ON pre_project_design_threads TO wodana_app;END IF;
END $$;
