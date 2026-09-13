CREATE TABLE project_execution (
 project_id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id),
 revision integer NOT NULL DEFAULT 0, content jsonb NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,project_id) REFERENCES delivery_projects(workspace_id,id)
);
CREATE TABLE project_resources (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id),
 name varchar(160) NOT NULL, kind varchar(16) NOT NULL CHECK(kind IN ('crew','person','factory','vendor')),
 members uuid[] NOT NULL DEFAULT '{}', active boolean NOT NULL DEFAULT true, UNIQUE(workspace_id,id)
);
CREATE TABLE project_bookings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id),
 project_id uuid NOT NULL, task_id varchar(80) NOT NULL, resource_id uuid NOT NULL,
 starts_on date NOT NULL, ends_on date NOT NULL, status varchar(16) NOT NULL CHECK(status IN ('confirmed','cancelled')),
 acknowledgement text NOT NULL DEFAULT '', member_ids uuid[] NOT NULL DEFAULT '{}',
 CHECK(ends_on>=starts_on),
 FOREIGN KEY(workspace_id,project_id) REFERENCES delivery_projects(workspace_id,id),
 FOREIGN KEY(workspace_id,resource_id) REFERENCES project_resources(workspace_id,id)
);
CREATE INDEX project_bookings_dates ON project_bookings(workspace_id,starts_on,ends_on) WHERE status='confirmed';
CREATE UNIQUE INDEX project_bookings_task ON project_bookings(workspace_id,project_id,task_id) WHERE status='confirmed';
--> statement-breakpoint
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['project_execution','project_resources','project_bookings'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (workspace_id=NULLIF(current_setting(''app.current_workspace_id'',true),'''')::uuid) WITH CHECK (workspace_id=NULLIF(current_setting(''app.current_workspace_id'',true),'''')::uuid)',t);
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='wodana_app') THEN EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO wodana_app',t);END IF;
 END LOOP;
END $$;
INSERT INTO permissions(code,description) VALUES ('projects.report','Submit progress on assigned project work'),('projects.review','Review project reports, inspections and handovers'),('projects.buy','Manage project procurement') ON CONFLICT(code) DO NOTHING;
ALTER TABLE roles DISABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions DISABLE ROW LEVEL SECURITY;
INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT r.workspace_id,r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.is_system AND r.code IN ('owner','administrator') AND p.code IN ('projects.report','projects.review','projects.buy') ON CONFLICT(role_id,permission_id) DO NOTHING;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
