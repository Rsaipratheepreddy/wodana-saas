CREATE TABLE project_factory_batches (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id),
 resource_id uuid NOT NULL, owner_id uuid NOT NULL,
 content jsonb NOT NULL, version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id,id),
 FOREIGN KEY(workspace_id,resource_id) REFERENCES project_resources(workspace_id,id),
 FOREIGN KEY(workspace_id,owner_id) REFERENCES workspace_memberships(workspace_id,id)
);
CREATE TABLE project_factory_allocations (
 workspace_id uuid NOT NULL, batch_id uuid NOT NULL, project_id uuid NOT NULL,
 task_id varchar(80) NOT NULL, snapshot jsonb NOT NULL, active boolean NOT NULL DEFAULT true,
 PRIMARY KEY(workspace_id,batch_id,project_id,task_id),
 FOREIGN KEY(workspace_id,batch_id) REFERENCES project_factory_batches(workspace_id,id),
 FOREIGN KEY(workspace_id,project_id) REFERENCES delivery_projects(workspace_id,id)
);
CREATE UNIQUE INDEX project_factory_task_allocation ON project_factory_allocations(workspace_id,project_id,task_id) WHERE active;
CREATE TABLE project_factory_commands (
 workspace_id uuid NOT NULL REFERENCES workspaces(id), request_id uuid NOT NULL,
 payload_hash varchar(64) NOT NULL, batch_id uuid NOT NULL,
 PRIMARY KEY(workspace_id,request_id),
 FOREIGN KEY(workspace_id,batch_id) REFERENCES project_factory_batches(workspace_id,id)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['project_factory_batches','project_factory_allocations','project_factory_commands'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (workspace_id=NULLIF(current_setting(''app.current_workspace_id'',true),'''')::uuid) WITH CHECK (workspace_id=NULLIF(current_setting(''app.current_workspace_id'',true),'''')::uuid)',t);
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='wodana_app') THEN EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO wodana_app',t); END IF;
 END LOOP;
END $$;
