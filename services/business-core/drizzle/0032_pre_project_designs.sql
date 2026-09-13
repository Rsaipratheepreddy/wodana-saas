-- Some early installations applied the reserved brief migration before its tables were added.
DO $brief$ BEGIN IF to_regclass('public.pre_project_briefs') IS NULL THEN
CREATE UNIQUE INDEX IF NOT EXISTS pre_project_cases_workspace_id_id_key ON pre_project_cases(workspace_id, id);
CREATE TABLE pre_project_briefs (
  case_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid NOT NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, case_id) REFERENCES pre_project_cases(workspace_id, id)
);
CREATE TABLE pre_project_rooms (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  case_id uuid NOT NULL,
  name varchar(120) NOT NULL CHECK (length(trim(name)) > 0),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, case_id, id),
  FOREIGN KEY (workspace_id, case_id) REFERENCES pre_project_cases(workspace_id, id)
);
CREATE UNIQUE INDEX pre_project_rooms_name_key ON pre_project_rooms(workspace_id, case_id, lower(name));
CREATE TABLE pre_project_brief_entries (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  case_id uuid NOT NULL,
  room_id uuid,
  kind varchar(20) NOT NULL CHECK (kind IN ('requirement', 'note', 'inspiration', 'file')),
  title varchar(240) NOT NULL CHECK (length(trim(title)) > 0),
  note text NOT NULL DEFAULT '',
  category varchar(60) NOT NULL DEFAULT 'General',
  priority varchar(20) NOT NULL DEFAULT 'preferred' CHECK (priority IN ('must_have', 'preferred', 'optional')),
  scope_status varchar(20) NOT NULL DEFAULT 'undecided' CHECK (scope_status IN ('included', 'excluded', 'undecided')),
  review_status varchar(20) NOT NULL DEFAULT 'captured' CHECK (review_status IN ('captured', 'reviewed', 'clarification')),
  quantity numeric(16,4) CHECK (quantity > 0),
  unit varchar(20) NOT NULL DEFAULT 'nos',
  reference_url varchar(2000) NOT NULL DEFAULT '',
  avoid text NOT NULL DEFAULT '',
  source varchar(20) NOT NULL DEFAULT 'team' CHECK (source IN ('team', 'client')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL REFERENCES users(id),
  updated_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  UNIQUE(workspace_id, case_id, id),
  FOREIGN KEY (workspace_id, case_id) REFERENCES pre_project_cases(workspace_id, id),
  FOREIGN KEY (workspace_id, case_id, room_id) REFERENCES pre_project_rooms(workspace_id, case_id, id)
);
CREATE INDEX pre_project_brief_entries_case_idx ON pre_project_brief_entries(workspace_id, case_id, updated_at DESC);
CREATE TABLE pre_project_brief_assets (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  case_id uuid NOT NULL,
  original_name varchar(240) NOT NULL,
  mime_type varchar(100) NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size > 0 AND byte_size <= 20971520),
  object_key text NOT NULL UNIQUE,
  preview_key text,
  sha256 varchar(64) NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, case_id, id),
  FOREIGN KEY (workspace_id, case_id) REFERENCES pre_project_cases(workspace_id, id)
);
CREATE TABLE pre_project_entry_assets (
  workspace_id uuid NOT NULL,
  case_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  PRIMARY KEY(entry_id, asset_id),
  FOREIGN KEY (workspace_id, case_id, entry_id) REFERENCES pre_project_brief_entries(workspace_id, case_id, id),
  FOREIGN KEY (workspace_id, case_id, asset_id) REFERENCES pre_project_brief_assets(workspace_id, case_id, id)
);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['pre_project_briefs','pre_project_rooms','pre_project_brief_entries','pre_project_brief_assets','pre_project_entry_assets'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (workspace_id = NULLIF(current_setting(''app.current_workspace_id'',true),'''')::uuid) WITH CHECK (workspace_id = NULLIF(current_setting(''app.current_workspace_id'',true),'''')::uuid)',t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='wodana_app') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO wodana_app',t);
    END IF;
  END LOOP;
END $$;

INSERT INTO permissions(code,description) VALUES ('pre_projects.edit','Edit pre-project briefs, rooms, requirements and reference files') ON CONFLICT(code) DO NOTHING;
ALTER TABLE roles DISABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions DISABLE ROW LEVEL SECURITY;
INSERT INTO role_permissions(workspace_id,role_id,permission_id)
SELECT r.workspace_id,r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.is_system=true AND r.code IN ('owner','administrator') AND p.code='pre_projects.edit'
ON CONFLICT(role_id,permission_id) DO NOTHING;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;

END IF; END $brief$;
--> statement-breakpoint
ALTER TABLE pre_project_rooms ADD COLUMN catalog_record_id uuid;
ALTER TABLE pre_project_rooms ADD COLUMN catalog_snapshot jsonb;
ALTER TABLE pre_project_rooms ADD CONSTRAINT pre_project_room_catalog_fk FOREIGN KEY(workspace_id,catalog_record_id) REFERENCES workspace_catalog_records(workspace_id,id);
CREATE TABLE pre_project_scope_links (
 workspace_id uuid NOT NULL, case_id uuid NOT NULL, entry_id uuid NOT NULL,
 role varchar(20) NOT NULL CHECK(role IN ('work','variant','material','brand','finish','unit','execution')),
 record_id uuid NOT NULL, snapshot jsonb NOT NULL,
 PRIMARY KEY(workspace_id,entry_id,role),
 FOREIGN KEY(workspace_id,case_id,entry_id) REFERENCES pre_project_brief_entries(workspace_id,case_id,id),
 FOREIGN KEY(workspace_id,record_id) REFERENCES workspace_catalog_records(workspace_id,id)
);
CREATE TABLE pre_project_designs (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, case_id uuid NOT NULL,
 room_id uuid, scope_entry_id uuid, title varchar(240) NOT NULL CHECK(length(trim(title))>0),
 document_type varchar(60) NOT NULL, description text NOT NULL DEFAULT '',
 version integer NOT NULL DEFAULT 1 CHECK(version>0), archived_at timestamptz,
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,case_id,id),
 FOREIGN KEY(workspace_id,case_id) REFERENCES pre_project_cases(workspace_id,id),
 FOREIGN KEY(workspace_id,case_id,room_id) REFERENCES pre_project_rooms(workspace_id,case_id,id),
 FOREIGN KEY(workspace_id,case_id,scope_entry_id) REFERENCES pre_project_brief_entries(workspace_id,case_id,id)
);
CREATE TABLE pre_project_design_versions (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, case_id uuid NOT NULL, design_id uuid NOT NULL,
 number integer NOT NULL CHECK(number>0), asset_id uuid NOT NULL, note text NOT NULL DEFAULT '',
 status varchar(30) NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','internal_review','internal_approved','client_review','approved','changes_requested')),
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,case_id,design_id,id), UNIQUE(design_id,number),
 FOREIGN KEY(workspace_id,case_id,design_id) REFERENCES pre_project_designs(workspace_id,case_id,id),
 FOREIGN KEY(workspace_id,case_id,asset_id) REFERENCES pre_project_brief_assets(workspace_id,case_id,id)
);
CREATE TABLE pre_project_design_activity (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, case_id uuid NOT NULL, design_id uuid NOT NULL, version_id uuid NOT NULL,
 action varchar(30) NOT NULL CHECK(action IN ('comment','internal_review','internal_approved','client_review','approved','changes_requested')),
 note text NOT NULL DEFAULT '', decision_by varchar(240) NOT NULL DEFAULT '',
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,case_id,design_id,version_id) REFERENCES pre_project_design_versions(workspace_id,case_id,design_id,id)
);
CREATE INDEX pre_project_designs_case_idx ON pre_project_designs(workspace_id,case_id,updated_at DESC);
CREATE INDEX pre_project_design_activity_idx ON pre_project_design_activity(workspace_id,case_id,design_id,created_at);
--> statement-breakpoint
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['pre_project_scope_links','pre_project_designs','pre_project_design_versions','pre_project_design_activity'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_isolation ON %I USING(workspace_id=NULLIF(current_setting(''app.current_workspace_id'',true),'''')::uuid) WITH CHECK(workspace_id=NULLIF(current_setting(''app.current_workspace_id'',true),'''')::uuid)',t);
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='wodana_app') THEN
   EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO wodana_app',t);
  END IF;
 END LOOP;
END $$;
