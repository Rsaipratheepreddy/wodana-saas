CREATE TABLE workspace_team_roles (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES workspace_teams(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(team_id,role_id)
);
CREATE INDEX workspace_team_roles_role_idx ON workspace_team_roles(workspace_id,role_id);
CREATE TRIGGER workspace_team_roles_team_workspace_guard BEFORE INSERT OR UPDATE ON workspace_team_roles
  FOR EACH ROW EXECUTE FUNCTION enforce_same_workspace_reference('workspace_teams','team_id');
CREATE TRIGGER workspace_team_roles_role_workspace_guard BEFORE INSERT OR UPDATE ON workspace_team_roles
  FOR EACH ROW EXECUTE FUNCTION enforce_same_workspace_reference('roles','role_id');
ALTER TABLE workspace_team_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_team_roles FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workspace_team_roles
  USING(workspace_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid)
  WITH CHECK(workspace_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid);
--> statement-breakpoint
CREATE TABLE workspace_team_queue_settings (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES workspace_teams(id) ON DELETE CASCADE,
  queue_id uuid NOT NULL REFERENCES crm_queues(id) ON DELETE CASCADE,
  capacity integer NOT NULL DEFAULT 25 CHECK(capacity BETWEEN 1 AND 10000),
  weight integer NOT NULL DEFAULT 1 CHECK(weight BETWEEN 1 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(team_id,queue_id)
);
CREATE INDEX workspace_team_queue_settings_queue_idx ON workspace_team_queue_settings(workspace_id,queue_id);
CREATE TRIGGER workspace_team_queue_settings_team_workspace_guard BEFORE INSERT OR UPDATE ON workspace_team_queue_settings
  FOR EACH ROW EXECUTE FUNCTION enforce_same_workspace_reference('workspace_teams','team_id');
CREATE TRIGGER workspace_team_queue_settings_queue_workspace_guard BEFORE INSERT OR UPDATE ON workspace_team_queue_settings
  FOR EACH ROW EXECUTE FUNCTION enforce_same_workspace_reference('crm_queues','queue_id');
ALTER TABLE workspace_team_queue_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_team_queue_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workspace_team_queue_settings
  USING(workspace_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid)
  WITH CHECK(workspace_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid);
--> statement-breakpoint
CREATE TABLE invitation_teams (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  invitation_id uuid NOT NULL REFERENCES workspace_invitations(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES workspace_teams(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(invitation_id,team_id)
);
CREATE TRIGGER invitation_teams_invitation_workspace_guard BEFORE INSERT OR UPDATE ON invitation_teams
  FOR EACH ROW EXECUTE FUNCTION enforce_same_workspace_reference('workspace_invitations','invitation_id');
CREATE TRIGGER invitation_teams_team_workspace_guard BEFORE INSERT OR UPDATE ON invitation_teams
  FOR EACH ROW EXECUTE FUNCTION enforce_same_workspace_reference('workspace_teams','team_id');
ALTER TABLE invitation_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitation_teams FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON invitation_teams
  USING(workspace_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid)
  WITH CHECK(workspace_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid);
--> statement-breakpoint
CREATE VIEW effective_member_roles WITH (security_invoker=true) AS
  SELECT workspace_id,membership_id,role_id,created_at,NULL::uuid AS team_id FROM member_roles
  UNION ALL
  SELECT grants.workspace_id,members.membership_id,grants.role_id,grants.created_at,grants.team_id
  FROM workspace_team_roles grants
  JOIN workspace_teams team ON team.id=grants.team_id AND team.workspace_id=grants.workspace_id AND team.status='active'
  JOIN workspace_team_members members ON members.team_id=team.id AND members.workspace_id=team.workspace_id;
--> statement-breakpoint
CREATE VIEW crm_effective_queue_members WITH (security_invoker=true) AS
  SELECT DISTINCT ON (candidate.workspace_id,candidate.queue_id,candidate.membership_id)
    candidate.workspace_id,candidate.queue_id,candidate.membership_id,
    candidate.capacity,candidate.weight,candidate.is_available,candidate.skills,
    candidate.languages,candidate.territories,candidate.unavailable_until,candidate.team_id
  FROM (
    SELECT direct.workspace_id,direct.queue_id,direct.membership_id,direct.capacity,direct.weight,
      direct.is_available,direct.skills,direct.languages,direct.territories,direct.unavailable_until,
      NULL::uuid AS team_id,0 AS precedence
    FROM crm_queue_members direct
    UNION ALL
    SELECT settings.workspace_id,settings.queue_id,members.membership_id,settings.capacity,settings.weight,
      true,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,NULL::timestamptz,settings.team_id,1
    FROM workspace_team_queue_settings settings
    JOIN workspace_teams team ON team.id=settings.team_id AND team.workspace_id=settings.workspace_id AND team.status='active'
    JOIN workspace_team_members members ON members.team_id=team.id AND members.workspace_id=team.workspace_id
    JOIN crm_queues queue ON queue.id=settings.queue_id AND queue.workspace_id=settings.workspace_id AND queue.status='active'
  ) candidate
  ORDER BY candidate.workspace_id,candidate.queue_id,candidate.membership_id,candidate.precedence,candidate.team_id;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='wodana_app') THEN
    GRANT SELECT,INSERT,UPDATE,DELETE ON workspace_team_roles,workspace_team_queue_settings,invitation_teams TO wodana_app;
    GRANT SELECT ON effective_member_roles,crm_effective_queue_members TO wodana_app;
  END IF;
END $$;
