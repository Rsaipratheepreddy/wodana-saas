-- View as (VA-1 to VA-4): an owner or administrator sees the workspace the way one team member (or one role)
-- does, read-only, for at most 30 minutes (a role preview 15). The viewer's own sign-in session is untouched:
-- the view-as session is bound to it (viewer_session_id = the sign-in family) and ends on exit or expiry.
--
-- 1. `workspace.view_as`: owners and administrators get it like every permission.
-- 2. view_as_sessions: who viewed as whom, when and for how long. The subject's Security > Activity reads it;
--    there is no delete grant, so the record can't be switched off.
-- 3. view_as_session_views: the pages and API routes the viewer opened, one row per distinct route.
-- 4. workspace_view_as_settings: whether the subject gets an in-app notice afterwards (on without a row).
-- 5. view_as_open_session(): the per-request lookup of the viewer's open session, with the effective
--    permissions (the subject's, or the role's, intersected with the viewer's) and whether the viewer may still
--    view as someone.
INSERT INTO permissions (code, description) VALUES
  ('workspace.view_as', 'View the workspace as a team member or role, read-only')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (workspace_id, role_id, permission_id)
SELECT role.workspace_id, role.id, permission.id
  FROM roles role CROSS JOIN permissions permission
 WHERE role.is_system AND role.code IN ('owner', 'administrator') AND permission.code = 'workspace.view_as'
ON CONFLICT (role_id, permission_id) DO NOTHING;
--> statement-breakpoint
CREATE TABLE view_as_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  kind varchar(12) NOT NULL,
  viewer_user_id uuid NOT NULL REFERENCES users (id),
  viewer_membership_id uuid NOT NULL REFERENCES workspace_memberships (id) ON DELETE CASCADE,
  viewer_session_id uuid,
  subject_user_id uuid REFERENCES users (id),
  subject_membership_id uuid REFERENCES workspace_memberships (id) ON DELETE CASCADE,
  subject_role_id uuid REFERENCES roles (id) ON DELETE SET NULL,
  subject_name varchar(200) NOT NULL,
  subject_role_label varchar(200),
  access_level varchar(16) NOT NULL DEFAULT 'read_only',
  return_path varchar(512),
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  ended_at timestamptz,
  end_reason varchar(16),
  subject_notified_at timestamptz,
  idempotency_key varchar(160) NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT view_as_sessions_workspace_id_key UNIQUE (workspace_id, id),
  CONSTRAINT view_as_sessions_idempotency_key UNIQUE (workspace_id, viewer_user_id, idempotency_key),
  CONSTRAINT view_as_sessions_kind_check CHECK (
    (kind = 'person' AND subject_user_id IS NOT NULL AND subject_membership_id IS NOT NULL AND subject_role_id IS NULL)
    OR (kind = 'role' AND subject_user_id IS NULL AND subject_membership_id IS NULL)),
  CONSTRAINT view_as_sessions_not_self_check CHECK (subject_user_id IS DISTINCT FROM viewer_user_id),
  CONSTRAINT view_as_sessions_read_only_check CHECK (access_level = 'read_only'),
  CONSTRAINT view_as_sessions_window_check CHECK (expires_at > started_at AND expires_at <= started_at + interval '30 minutes'),
  CONSTRAINT view_as_sessions_end_check CHECK (
    (ended_at IS NULL) = (end_reason IS NULL)
    AND (end_reason IS NULL OR end_reason IN ('exited', 'expired', 'replaced', 'revoked'))
    AND (ended_at IS NULL OR ended_at >= started_at)),
  CONSTRAINT view_as_sessions_return_path_check CHECK (return_path IS NULL OR return_path LIKE '/workspace%'),
  CONSTRAINT view_as_sessions_version_check CHECK (version > 0)
);
--> statement-breakpoint
-- One open view per viewer in a workspace; the per-request lookup reads the open ones only.
CREATE UNIQUE INDEX view_as_sessions_one_open_uidx ON view_as_sessions (workspace_id, viewer_user_id) WHERE ended_at IS NULL;
--> statement-breakpoint
CREATE INDEX view_as_sessions_viewer_open_idx ON view_as_sessions (viewer_user_id) WHERE ended_at IS NULL;
--> statement-breakpoint
CREATE INDEX view_as_sessions_subject_idx ON view_as_sessions (workspace_id, subject_user_id, started_at DESC);
--> statement-breakpoint
CREATE TABLE view_as_session_views (
  workspace_id uuid NOT NULL,
  session_id uuid NOT NULL,
  route varchar(300) NOT NULL,
  first_opened_at timestamptz NOT NULL DEFAULT now(),
  last_opened_at timestamptz NOT NULL DEFAULT now(),
  open_count integer NOT NULL DEFAULT 1,
  PRIMARY KEY (session_id, route),
  FOREIGN KEY (workspace_id, session_id) REFERENCES view_as_sessions (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT view_as_session_views_count_check CHECK (open_count > 0)
);
--> statement-breakpoint
CREATE TABLE workspace_view_as_settings (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  notify_subject boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  updated_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_view_as_settings_version_check CHECK (version > 0)
);
--> statement-breakpoint
ALTER TABLE view_as_sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE view_as_sessions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON view_as_sessions
  USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE view_as_session_views ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE view_as_session_views FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON view_as_session_views
  USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE workspace_view_as_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE workspace_view_as_settings FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON workspace_view_as_settings
  USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
--> statement-breakpoint
-- Every signed-in request asks once whether its sign-in session is viewing as someone. The newest open session
-- of the viewer bound to this sign-in session (or, for a provider without session ids, to none) is returned with
-- its effective permissions; an expired one comes back marked so the caller ends it.
CREATE FUNCTION view_as_open_session(p_provider text, p_subject text, p_session_id uuid)
RETURNS TABLE (
  id uuid, workspace_id uuid, kind varchar, viewer_user_id uuid, viewer_membership_id uuid,
  subject_user_id uuid, subject_membership_id uuid, subject_role_id uuid, subject_name varchar,
  subject_role_label varchar, return_path varchar, started_at timestamptz, expires_at timestamptz,
  expired boolean, viewer_allowed boolean, permissions text[]
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH open_session AS (
    SELECT session.*
      FROM user_identities identity
      JOIN view_as_sessions session ON session.viewer_user_id = identity.user_id AND session.ended_at IS NULL
       AND session.viewer_session_id IS NOT DISTINCT FROM p_session_id
     WHERE identity.provider = p_provider AND identity.provider_subject = p_subject
     ORDER BY session.started_at DESC
     LIMIT 1
  ), viewer_grants AS (
    SELECT DISTINCT permission.code
      FROM open_session session
      JOIN workspace_memberships membership ON membership.id = session.viewer_membership_id
       AND membership.workspace_id = session.workspace_id AND membership.status = 'active'
      JOIN effective_member_roles assigned ON assigned.membership_id = membership.id AND assigned.workspace_id = session.workspace_id
      JOIN role_permissions granted ON granted.role_id = assigned.role_id AND granted.workspace_id = session.workspace_id
      JOIN permissions permission ON permission.id = granted.permission_id
  ), subject_grants AS (
    SELECT DISTINCT permission.code
      FROM open_session session
      JOIN workspace_memberships membership ON membership.id = session.subject_membership_id
       AND membership.workspace_id = session.workspace_id AND membership.status = 'active'
      JOIN effective_member_roles assigned ON assigned.membership_id = membership.id AND assigned.workspace_id = session.workspace_id
      JOIN role_permissions granted ON granted.role_id = assigned.role_id AND granted.workspace_id = session.workspace_id
      JOIN permissions permission ON permission.id = granted.permission_id
     WHERE session.kind = 'person'
    UNION
    SELECT permission.code
      FROM open_session session
      JOIN role_permissions granted ON granted.role_id = session.subject_role_id AND granted.workspace_id = session.workspace_id
      JOIN permissions permission ON permission.id = granted.permission_id
     WHERE session.kind = 'role'
  )
  SELECT session.id, session.workspace_id, session.kind, session.viewer_user_id, session.viewer_membership_id,
         session.subject_user_id, session.subject_membership_id, session.subject_role_id, session.subject_name,
         session.subject_role_label, session.return_path, session.started_at, session.expires_at,
         session.expires_at <= now() AS expired,
         EXISTS (SELECT 1 FROM viewer_grants WHERE code = 'workspace.view_as') AS viewer_allowed,
         ARRAY(SELECT code FROM subject_grants INTERSECT SELECT code FROM viewer_grants ORDER BY 1) AS permissions
    FROM open_session session
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION view_as_open_session(text, text, uuid) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON view_as_sessions TO wodana_app;
    GRANT SELECT, INSERT, UPDATE ON view_as_session_views TO wodana_app;
    GRANT SELECT, INSERT, UPDATE ON workspace_view_as_settings TO wodana_app;
    GRANT EXECUTE ON FUNCTION view_as_open_session(text, text, uuid) TO wodana_app;
  END IF;
END $$;
